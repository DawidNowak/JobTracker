import { readFileSync } from "node:fs";
import { upsertPrComment } from "./github.ts";

export interface ReportMeta {
  branch: string;
  base: string;
  fileCount: number;
}

export function formatReport(body: string, meta: ReportMeta): string {
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
  return header + body + "\n";
}

interface PullRequestContext {
  repo: string;
  prNumber: number;
  token: string;
}

/**
 * Resolves PR number and repo from the environment GitHub Actions itself sets on a
 * `pull_request` event — GITHUB_EVENT_PATH points at the full event payload — so the
 * workflow only needs to pass a token, not thread the PR number through as well.
 */
function resolvePullRequestContext(): PullRequestContext | null {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_EVENT_NAME !== "pull_request") {
    return null;
  }

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repo || !eventPath) return null;

  const event = JSON.parse(readFileSync(eventPath, "utf8")) as { pull_request?: { number?: number } };
  const prNumber = event.pull_request?.number;
  if (!prNumber) return null;

  return { repo, prNumber, token };
}

/**
 * Locally: print the review to the console. In CI on a pull_request run: post it as a PR
 * comment instead, updating a prior run's comment rather than piling up duplicates.
 */
export async function deliverReport(body: string, meta: ReportMeta): Promise<void> {
  const report = formatReport(body, meta);
  const prContext = resolvePullRequestContext();

  if (prContext) {
    await upsertPrComment(prContext.repo, prContext.prNumber, prContext.token, report);
    console.log(`Posted review comment on ${prContext.repo}#${prContext.prNumber}`);
    return;
  }

  console.log(`\n=== Review ===\n\n${report}`);
}
