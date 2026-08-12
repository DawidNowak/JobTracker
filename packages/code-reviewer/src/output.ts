import { appendFileSync, readFileSync } from "node:fs";
import { CRITERIA } from "./criteria.ts";
import { upsertPrComment } from "./github.ts";
import type { Finding, ReviewOutput, Verdict } from "./schema.ts";

export interface ReportMeta {
  branch: string;
  base: string;
  fileCount: number;
  diffUnavailable: boolean;
  diffTruncated: boolean;
  diffTotalLines: number;
  diffIncludedLines: number;
}

const CRITERION_LABELS: Record<string, string> = Object.fromEntries(CRITERIA.map((criterion) => [criterion.id, criterion.title]));

function formatCriteriaTable(criteria: ReviewOutput["criteria"]): string {
  const rows = criteria.map((result) => `| ${CRITERION_LABELS[result.id]} | ${result.status} | ${result.rationale} |`);
  return ["| Criterion | Status | Notes |", "| --- | --- | --- |", ...rows].join("\n");
}

function formatFinding(finding: Finding): string {
  const confidenceLabel = finding.confidence === "CERTAIN" ? "Certain" : "Possible";
  return [
    `- **${finding.file}:${finding.line}** — ${finding.severity} · ${confidenceLabel} (\`${CRITERION_LABELS[finding.criterion]}\`)`,
    `  - What: ${finding.what}`,
    `  - Why: ${finding.why}`,
    `  - Fix: ${finding.fix}`,
  ].join("\n");
}

/** `BLOCKING` findings first, in the order the model returned them within each group. */
function formatFindings(findings: ReviewOutput["findings"]): string {
  if (findings.length === 0) return "No findings.";
  const blocking = findings.filter((finding) => finding.severity === "BLOCKING");
  const advisory = findings.filter((finding) => finding.severity === "ADVISORY");
  return [...blocking, ...advisory].map(formatFinding).join("\n\n");
}

/**
 * Assembles the comment from the structured fields rather than pasting one blob of model
 * markdown, so the verdict, summary, criteria table and findings have a fixed shape the model
 * cannot reformat or duplicate.
 */
export function formatReport(output: ReviewOutput, verdict: Verdict, meta: ReportMeta): string {
  const truncationNote = meta.diffUnavailable
    ? [`> **Diff could not be fetched (likely exceeds the size limit) — review is based on the file list only.**`, ""]
    : meta.diffTruncated
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

  const body = [
    `**Verdict: ${verdict}**`,
    "",
    output.summary,
    "",
    formatCriteriaTable(output.criteria),
    "",
    "## Findings",
    "",
    formatFindings(output.findings),
  ].join("\n");

  return header + body + "\n";
}

/**
 * Writes the verdict to the runner's step-output file so the composite action can map it to
 * an action output. Only ever the four/five-character verdict — never the report.
 */
export function emitVerdict(verdict: Verdict): void {
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
export async function deliverReport(output: ReviewOutput, verdict: Verdict, meta: ReportMeta): Promise<void> {
  const report = formatReport(output, verdict, meta);
  const prContext = resolvePullRequestContext();

  if (prContext) {
    await upsertPrComment(prContext.repo, prContext.prNumber, prContext.token, report);
    console.log(`Posted review comment on ${prContext.repo}#${prContext.prNumber}`);
    return;
  }

  console.log(`\n=== Review ===\n\n${report}`);
}
