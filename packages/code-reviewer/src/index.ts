import { query, type EffortLevel, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EMPTY_DIFF,
  getChangedFiles,
  getCurrentBranch,
  getDiff,
  getDiffStat,
  getMergeBase,
  getRepoRoot,
  truncateDiff,
} from "./git.ts";
import { deliverReport, emitVerdict, type ReportMeta } from "./output.ts";
import { buildTaskPrompt, REVIEWER_APPEND } from "./prompt.ts";
import {
  checkConsistency,
  deriveVerdict,
  parseReviewOutput,
  REVIEW_SCHEMA,
  type ReviewOutput,
  type Verdict,
} from "./schema.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The SDK reads credentials from the process environment and does not load .env itself.
// Anchor to the package rather than cwd, so running this from the repo root does not
// silently pick up the app's .env instead.
config({ path: path.join(PACKAGE_ROOT, ".env") });

const MODEL = "claude-sonnet-5";
const DEFAULT_EFFORT: EffortLevel = "high";

/**
 * Tools auto-approved without prompting. Paired with permissionMode "dontAsk", anything
 * outside this list is denied rather than prompting — a headless run has nobody to answer.
 */
const ALLOWED_TOOLS = ["Read", "Grep", "Glob"];

/**
 * allowedTools only *approves*; it does not remove anything. Bare-name deny rules do remove
 * the tool from the model's context, so the read-only property is structural here rather
 * than resting solely on permissionMode. The path-scoped Read rules anchor at the session
 * cwd (the repo root) and keep the reviewer out of local secret files. Claude Code only
 * consults `Read(path)` rules for filesystem access — a `Grep(path)` or `Glob(path)` rule is
 * accepted but never checked (and warns at startup) — so the node_modules rule below is a
 * single `Read` entry, applied best-effort to all three read-only tools by the SDK itself. It
 * keeps the reviewer out of dependency source and type declarations entirely: nothing in this
 * repo's own conventions turns on verifying a third-party package's internals, and a model that
 * starts second-guessing SDK typings against its `.d.ts` files burns turns (and cost) with no
 * bearing on the diff being reviewed.
 */
const DISALLOWED_TOOLS = [
  "Bash",
  "Edit",
  "Write",
  "NotebookEdit",
  "Read(/.env*)",
  "Read(/.dev.vars*)",
  "Read(/auth.json)",
  "Read(**/node_modules/**)",
];

// Strips control characters (newlines, ANSI escapes, etc.) so a value drawn from model tool
// calls — themselves influenced by the diff text — cannot inject fake log lines or terminal
// escape sequences into CI console output.
function sanitizeForLog(value: string): string {
  return value.replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Console tool-call logging should show what was actually read or searched, not just the bare
 * tool name — `Read` gets its `file_path`, `Grep`/`Glob` get their `pattern` (plus `path` when
 * scoped to a subdirectory). `input` is `unknown` on the SDK's `ToolUseBlock`, so every field
 * access is guarded rather than cast.
 */
function describeToolUse(name: string, input: unknown): string {
  const record = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

  if (name === "Read") {
    return typeof record.file_path === "string" ? sanitizeForLog(record.file_path) : "";
  }

  if (name === "Grep" || name === "Glob") {
    const parts: string[] = [];
    if (typeof record.pattern === "string") parts.push(sanitizeForLog(record.pattern));
    if (typeof record.path === "string") parts.push(sanitizeForLog(record.path));
    return parts.join(" ");
  }

  return "";
}

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

export interface RunReviewOptions {
  repoRoot: string;
  base: string;
  branch: string;
  prTitle: string;
  prBody: string;
  model?: string;
  effort?: EffortLevel;
  /** Appended to the `claude_code` system prompt preset. Defaults to `REVIEWER_APPEND` — the
   * promptfoo rig overrides this to score a prompt variant against the same production path. */
  reviewerAppend?: string;
  /** Called for every SDK message as it streams in. Omit to run silently (e.g. an eval sweep). */
  onMessage?: (message: SDKMessage) => void;
}

export interface ReviewRun {
  output: ReviewOutput | null;
  consistencyViolations: string[];
  verdict: Verdict | null;
  costUsd: number;
  numTurns: number;
  resultSubtype: string;
  durationMs: number;
  changedFileCount: number;
  meta: ReportMeta;
}

/**
 * Owns diff collection and the `query()` call; returns everything a caller needs to judge the
 * run. Delivers no report and emits no verdict — `deliverReport()` and `emitVerdict()` stay in
 * `main()` so an eval run in a GitHub-Actions context can never post a PR comment or overwrite
 * the real verdict output.
 */
export async function runReview(options: RunReviewOptions): Promise<ReviewRun> {
  const {
    repoRoot,
    base,
    branch,
    prTitle,
    prBody,
    model = MODEL,
    effort = DEFAULT_EFFORT,
    reviewerAppend = REVIEWER_APPEND,
    onMessage,
  } = options;

  const changedFiles = getChangedFiles(base, repoRoot);
  const emptyMeta: ReportMeta = {
    branch,
    base,
    fileCount: 0,
    diffUnavailable: false,
    diffTruncated: false,
    diffTotalLines: 0,
    diffIncludedLines: 0,
  };

  if (changedFiles.length === 0) {
    return {
      output: null,
      consistencyViolations: [],
      verdict: null,
      costUsd: 0,
      numTurns: 0,
      resultSubtype: "no_changes",
      durationMs: 0,
      changedFileCount: 0,
      meta: emptyMeta,
    };
  }

  const diffStat = getDiffStat(base, repoRoot);
  // A diff that overflows execFileSync's buffer throws before truncateDiff ever sees it —
  // catch that here so an oversized diff degrades to "diff unavailable" instead of crashing
  // the whole run, matching truncateDiff's own "always bounded" intent for the normal case.
  let diff = EMPTY_DIFF;
  let diffUnavailable = false;
  try {
    diff = truncateDiff(getDiff(base, repoRoot));
  } catch (err) {
    diffUnavailable = true;
    console.error(
      `Failed to fetch diff (likely exceeds the size limit): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(`Reviewing ${changedFiles.length} changed file(s) on \`${branch}\` against \`${base}\`...\n`);

  const meta: ReportMeta = {
    branch,
    base,
    fileCount: changedFiles.length,
    diffUnavailable,
    diffTruncated: diff.truncated,
    diffTotalLines: diff.totalLines,
    diffIncludedLines: diff.includedLines,
  };

  let reviewOutput: ReviewOutput | null = null;
  let costUsd = 0;
  let numTurns = 0;
  let resultSubtype = "";
  const startedAt = Date.now();

  for await (const message of query({
    prompt: buildTaskPrompt({
      base,
      branch,
      changedFiles,
      diffStat,
      diff: diff.text,
      diffUnavailable,
      diffTruncated: diff.truncated,
      diffTotalLines: diff.totalLines,
      diffIncludedLines: diff.includedLines,
      prTitle,
      prBody,
    }),
    options: {
      cwd: repoRoot,
      model,
      // The preset gives us Claude Code's tool guidance and safety rules; the append layers
      // the reviewer role on top without replacing any of it.
      systemPrompt: { type: "preset", preset: "claude_code", append: reviewerAppend },
      // Loads CLAUDE.md (which @-includes AGENTS.md) and .claude/rules from the repo root,
      // so project conventions do not have to be duplicated in the reviewer prompt.
      settingSources: ["project"],
      // The repo ships 33 skills; none of them are review inputs, and advertising all of
      // them costs context on every run.
      skills: [],
      allowedTools: ALLOWED_TOOLS,
      disallowedTools: DISALLOWED_TOOLS,
      permissionMode: "dontAsk",
      maxTurns: 20,
      effort,
      outputFormat: { type: "json_schema", schema: REVIEW_SCHEMA },
      // Roughly 20-30x the current per-run cost — only fires on a runaway.
      maxBudgetUsd: 2.0,
    },
  })) {
    onMessage?.(message);

    if (message.type === "result") {
      resultSubtype = message.subtype;
      numTurns = message.num_turns;
      costUsd = message.total_cost_usd ?? 0;

      if (message.subtype === "success") {
        reviewOutput = parseReviewOutput(message.structured_output);
        if (reviewOutput === null) {
          console.error("\nRun succeeded but returned no valid structured output. Raw result:\n");
          console.error(message.result);
        }
      } else {
        console.error(`\nRun ended without a review: ${message.subtype}`);
      }
      console.log(`\nTurns: ${numTurns}  Cost: $${costUsd.toFixed(4)}`);
    }
  }

  const consistencyViolations = reviewOutput !== null ? checkConsistency(reviewOutput) : [];
  const verdict = reviewOutput !== null && consistencyViolations.length === 0 ? deriveVerdict(reviewOutput) : null;

  return {
    output: reviewOutput,
    consistencyViolations,
    verdict,
    costUsd,
    numTurns,
    resultSubtype,
    durationMs: Date.now() - startedAt,
    changedFileCount: changedFiles.length,
    meta,
  };
}

async function main(): Promise<void> {
  reportCredentialSource();

  const repoRoot = getRepoRoot();
  // A CI checkout of a specific SHA leaves HEAD detached, where getCurrentBranch() returns
  // the literal string "HEAD" — the workflow knows the real branch name and passes it through.
  const branch = process.env.PR_HEAD_REF || getCurrentBranch(repoRoot);
  const prTitle = process.env.PR_TITLE ?? "";
  const prBody = process.env.PR_BODY ?? "";
  const base = getMergeBase(repoRoot);

  const run = await runReview({
    repoRoot,
    base,
    branch,
    prTitle,
    prBody,
    onMessage: (message) => {
      if (message.type !== "assistant") return;
      for (const block of message.message.content) {
        if (block.type === "text") {
          console.log(block.text);
        } else if (block.type === "tool_use") {
          const detail = describeToolUse(block.name, block.input);
          console.log(detail ? `  [tool] ${block.name} ${detail}` : `  [tool] ${block.name}`);
        }
      }
    },
  });

  if (run.changedFileCount === 0) {
    console.log(`No changes on \`${branch}\` against \`${base}\` — nothing to review.`);
    return;
  }

  const failed = run.output === null || run.consistencyViolations.length > 0;

  if (run.output !== null) {
    if (run.consistencyViolations.length > 0) {
      console.error("\nReview output is internally inconsistent — no verdict emitted, no comment posted:");
      for (const violation of run.consistencyViolations) console.error(`  - ${violation}`);
    } else if (run.verdict !== null) {
      emitVerdict(run.verdict);
      await deliverReport(run.output, run.verdict, run.meta);
    }
  }

  if (failed) process.exit(1);
}

// Importing this module (e.g. the eval sweep pulling in `runReview`) must not also trigger a
// real review as a side effect of module load — only running the file directly does.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
