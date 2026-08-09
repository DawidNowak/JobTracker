import { query } from "@anthropic-ai/claude-agent-sdk";
import { config } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getChangedFiles, getCurrentBranch, getDiffStat, getFullDiff, getMergeBase, getRepoRoot } from "./git.ts";
import { buildTaskPrompt, REVIEWER_APPEND } from "./prompt.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORTS_DIR = path.join(PACKAGE_ROOT, "reports");

// The SDK reads credentials from the process environment and does not load .env itself.
// Anchor to the package rather than cwd, so running this from the repo root does not
// silently pick up the app's .env instead.
config({ path: path.join(PACKAGE_ROOT, ".env") });

const MODEL = "claude-haiku-4-5";

/**
 * Tools auto-approved without prompting. Paired with permissionMode "dontAsk", anything
 * outside this list is denied rather than prompting — a headless run has nobody to answer.
 */
const ALLOWED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash(git diff:*)",
  "Bash(git show:*)",
  "Bash(git log:*)",
  "Bash(git status:*)",
];

/**
 * allowedTools only *approves*; it does not remove anything. Bare-name deny rules do remove
 * the tool from the model's context, so the read-only property is structural here rather
 * than resting solely on permissionMode. The path-scoped Read rules anchor at the session
 * cwd (the repo root) and keep the reviewer out of local secret files.
 */
const DISALLOWED_TOOLS = [
  "Edit",
  "Write",
  "NotebookEdit",
  "Read(/.env*)",
  "Read(/.dev.vars*)",
  "Read(/auth.json)",
];

/**
 * The SDK resolves credentials itself, in this order: ANTHROPIC_API_KEY, then
 * CLAUDE_CODE_OAUTH_TOKEN, then whatever the local Claude Code install is logged in as.
 * We only report which one is in play — failing here on an empty environment would reject
 * a perfectly good interactive login.
 */
function reportCredentialSource(): void {
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("Auth: ANTHROPIC_API_KEY (billed to your Anthropic Console account)");
  } else if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log("Auth: CLAUDE_CODE_OAUTH_TOKEN (billed to your Claude subscription)");
  } else {
    console.log("Auth: falling back to the local Claude Code login (billed to your Claude subscription)");
  }
}

async function writeReport(body: string, meta: { branch: string; base: string; fileCount: number }): Promise<string> {
  await mkdir(REPORTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORTS_DIR, `review-${stamp}.md`);
  const header = [
    `# Code review — \`${meta.branch}\``,
    "",
    `- Branch: \`${meta.branch}\``,
    `- Merge-base: \`${meta.base}\``,
    `- Changed files: ${meta.fileCount}`,
    `- Generated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ].join("\n");
  await writeFile(reportPath, header + body + "\n", "utf8");
  return reportPath;
}

async function main(): Promise<void> {
  reportCredentialSource();

  const repoRoot = getRepoRoot();
  const branch = getCurrentBranch(repoRoot);
  const base = getMergeBase(repoRoot);
  const changedFiles = getChangedFiles(base, repoRoot);

  if (changedFiles.length === 0) {
    console.log(`No changes on \`${branch}\` against \`${base}\` — nothing to review.`);
    return;
  }

  const diffStat = getDiffStat(base, repoRoot);
  const diff = getFullDiff(base, repoRoot);

  console.log(`Reviewing ${changedFiles.length} changed file(s) on \`${branch}\` against \`${base}\`...\n`);

  let finalReport: string | null = null;
  let failed = false;

  for await (const message of query({
    prompt: buildTaskPrompt({ base, branch, changedFiles, diffStat, diff }),
    options: {
      cwd: repoRoot,
      model: MODEL,
      // The preset gives us Claude Code's tool guidance and safety rules; the append layers
      // the reviewer role on top without replacing any of it.
      systemPrompt: { type: "preset", preset: "claude_code", append: REVIEWER_APPEND },
      // Loads CLAUDE.md (which @-includes AGENTS.md) and .claude/rules from the repo root,
      // so project conventions do not have to be duplicated in the reviewer prompt.
      settingSources: ["project"],
      // The repo ships 33 skills; none of them are review inputs, and advertising all of
      // them costs context on every run.
      skills: [],
      allowedTools: ALLOWED_TOOLS,
      disallowedTools: DISALLOWED_TOOLS,
      permissionMode: "dontAsk",
      maxTurns: 15,
      effort: "high",
    },
  })) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "text") {
          console.log(block.text);
        } else if (block.type === "tool_use") {
          console.log(`  [tool] ${block.name}`);
        }
      }
    } else if (message.type === "result") {
      if (message.subtype === "success") {
        finalReport = message.result;
      } else {
        failed = true;
        console.error(`\nRun ended without a review: ${message.subtype}`);
      }
      console.log(`\nTurns: ${message.num_turns}  Cost: $${(message.total_cost_usd ?? 0).toFixed(4)}`);
    }
  }

  if (finalReport !== null) {
    const reportPath = await writeReport(finalReport, { branch, base, fileCount: changedFiles.length });
    console.log(`Report written to ${reportPath}`);
  }

  if (failed) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
