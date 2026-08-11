import { appendFileSync, readFileSync } from "node:fs";
import { upsertPrComment } from "./github.ts";
import type { ReviewOutput } from "./schema.ts";

export interface ReportMeta {
  branch: string;
  base: string;
  fileCount: number;
  diffTruncated: boolean;
  diffTotalLines: number;
  diffIncludedLines: number;
}

const DIMENSION_LABELS: Record<keyof ReviewOutput["scores"], string> = {
  correctness: "Correctness",
  idiomatic_style: "Idiomatic style",
  complexity: "Complexity",
  test_coverage: "Test coverage",
  security: "Security",
};

function formatScoresTable(scores: ReviewOutput["scores"]): string {
  const rows = Object.entries(scores).map(
    ([dimension, score]) => `| ${DIMENSION_LABELS[dimension as keyof ReviewOutput["scores"]]} | ${score} |`,
  );
  return ["| Dimension | Score |", "| --- | --- |", ...rows].join("\n");
}

/**
 * The model is told `report_markdown` is the findings section alone and that the "## Findings"
 * heading below is added for it, but it sometimes writes one anyway. Strip a leading one rather
 * than trust prompt compliance, so the comment never renders the heading twice.
 */
function stripLeadingFindingsHeading(markdown: string): string {
  return markdown.replace(/^#{1,6}\s*findings\s*\n+/i, "");
}

function formatFindings(reportMarkdown: string): string {
  const trimmed = stripLeadingFindingsHeading(reportMarkdown.trim());
  return trimmed === "" ? "No findings." : trimmed;
}

/**
 * Assembles the comment from the structured fields rather than pasting one blob of model
 * markdown, so the verdict, summary and scorecard have a fixed shape the model cannot
 * reformat or duplicate.
 */
export function formatReport(output: ReviewOutput, meta: ReportMeta): string {
  const truncationNote = meta.diffTruncated
    ? [`> **Truncated to the first ${meta.diffIncludedLines} of ${meta.diffTotalLines} diff lines — review is partial.**`, ""]
    : [];

  const header = [
    `# Code review — \`${meta.branch}\``,
    "",
    ...truncationNote,
    `- Branch: \`${meta.branch}\``,
    `- Merge-base: \`${meta.base}\``,
    `- Changed files: ${meta.fileCount}`,
    `- Generated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ].join("\n");

  const findings = formatFindings(output.report_markdown);

  const body = [
    `**Verdict: ${output.verdict}**`,
    "",
    output.summary,
    "",
    formatScoresTable(output.scores),
    "",
    "## Findings",
    "",
    findings,
  ].join("\n");

  return header + body + "\n";
}

/**
 * Writes the verdict to the runner's step-output file so the composite action can map it to
 * an action output. Only ever the four/five-character verdict — never the report.
 */
export function emitVerdict(verdict: ReviewOutput["verdict"]): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(outputFile, `verdict=${verdict}\n`);
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
export async function deliverReport(output: ReviewOutput, meta: ReportMeta): Promise<void> {
  const report = formatReport(output, meta);
  const prContext = resolvePullRequestContext();

  if (prContext) {
    await upsertPrComment(prContext.repo, prContext.prNumber, prContext.token, report);
    console.log(`Posted review comment on ${prContext.repo}#${prContext.prNumber}`);
    return;
  }

  console.log(`\n=== Review ===\n\n${report}`);
}
