/**
 * Turns one persisted eval run plus its fixture's expectation into a single categorical
 * outcome, with no partial credit and no weighting. Pure and exported so it stays testable
 * without a model call: the negative-control check (Phase 3 automated criterion 3.5) replays a
 * stored JSONL run through this function directly.
 */

import type { ReviewRun } from "../index.ts";
import type { Fixture } from "./fixtures.ts";

export type RunOutcome =
  | "caught"
  | "missed"
  | "misattributed"
  | "false_positive"
  | "clean_pass"
  | "errored"
  | "rate_limited";

/**
 * Synthetic `resultSubtype` the sweep driver (`run.ts`) writes when `runReview()` threw and the
 * thrown error's text looks like a subscription usage-limit rejection rather than a model-side
 * failure. The SDK itself never produces this string — `runReview()`'s real subtypes are
 * `"success"`, `"no_changes"`, or one of the four `error_*` values documented on
 * `SDKResultMessage`. Kept here (not in `run.ts`) so the sentinel and the code that interprets
 * it cannot drift apart.
 */
export const RATE_LIMITED_SUBTYPE = "error_rate_limited";

/** Windows worktree paths use `\`; `expect.files` is always POSIX. */
function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

/**
 * `expect.files` holds repo-relative POSIX paths, but the model's `finding.file` may be an
 * absolute path into an OS temp worktree (`prompt.ts:78` only describes `file` as "the location
 * you verified the finding against"). Match on a normalized path *suffix*, never on string
 * equality — an equality check here would be silently and uniformly wrong, scoring every cell as
 * `missed` rather than surfacing that the scorer, not the models, is broken.
 */
function matchesExpectedFile(findingFile: string, expectedFile: string): boolean {
  const finding = normalizePath(findingFile);
  const expected = normalizePath(expectedFile);
  return finding === expected || finding.endsWith(`/${expected}`);
}

function hasBlockingFindingOnExpectedFile(
  output: NonNullable<ReviewRun["output"]>,
  criterionId: string,
  files: readonly string[],
): boolean {
  return output.findings.some(
    (finding) =>
      finding.criterion === criterionId &&
      finding.severity === "BLOCKING" &&
      files.some((file) => matchesExpectedFile(finding.file, file)),
  );
}

export function scoreRun(fixture: Fixture, run: ReviewRun): RunOutcome {
  if (run.resultSubtype === RATE_LIMITED_SUBTYPE) return "rate_limited";

  if (run.output === null || run.consistencyViolations.length > 0 || run.resultSubtype !== "success") {
    return "errored";
  }

  const { output } = run;

  if (fixture.expect.kind === "clean") {
    return run.verdict === "PASS" ? "clean_pass" : "false_positive";
  }

  const { criterion, files } = fixture.expect;

  const expectedCriterionResult = output.criteria.find((result) => result.id === criterion);
  const caught =
    expectedCriterionResult?.status === "FAIL" && hasBlockingFindingOnExpectedFile(output, criterion, files);
  if (caught) return "caught";

  const misattributed = output.criteria.some(
    (result) =>
      result.id !== criterion && result.status === "FAIL" && hasBlockingFindingOnExpectedFile(output, result.id, files),
  );

  return misattributed ? "misattributed" : "missed";
}
