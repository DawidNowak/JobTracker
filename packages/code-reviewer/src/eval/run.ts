/**
 * Executes cells × fixtures × `RUNS_PER_FIXTURE` in cheapest-first order, enforces the run-count
 * ceiling before dispatch, and appends each completed run to a JSONL file as it finishes so an
 * abort or crash never loses already-finished work.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runReview, type ReviewRun } from "../index.ts";
import type { ReportMeta } from "../output.ts";
import { CELLS, type Cell } from "./cells.ts";
import { loadFixtures, type Fixture } from "./fixtures.ts";
import { RATE_LIMITED_SUBTYPE, scoreRun, type RunOutcome } from "./score.ts";
import { withFixtureWorktree } from "./worktree.ts";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Exported so `report.ts` reads the same file without importing this module's `main()`. */
export const RESULTS_PATH = path.join(PACKAGE_ROOT, "eval-results", "runs.jsonl");

/** Two runs per fixture — repeats exist to separate a systematic miss from a flaky one. */
export const RUNS_PER_FIXTURE = 2;

/**
 * A quota stop cannot be aligned to a cell boundary (unlike the ceiling), so it is detected by a
 * streak instead: a single rate-limited run could be transient, but this many in a row means the
 * subscription's usage limit is spent, not that one call happened to fail.
 */
const QUOTA_STOP_STREAK = 3;

export interface EvalRunRecord {
  cellId: string;
  fixtureId: string;
  runIndex: number;
  timestamp: string;
  run: ReviewRun;
  outcome: RunOutcome;
  errorMessage?: string;
}

interface SweepArgs {
  maxRuns: number;
  cellFilter: Set<string> | null;
  fixtureFilter: Set<string> | null;
}

function parseArgs(argv: string[]): SweepArgs {
  let maxRuns = CELLS.length * RUNS_PER_FIXTURE * 6; // full matrix: 4 cells × 6 fixtures × 2 runs = 48
  let cellFilter: Set<string> | null = null;
  let fixtureFilter: Set<string> | null = null;

  let i = 0;
  const takeValue = (flag: string): string => {
    i += 1;
    const value = argv[i];
    if (value === undefined) throw new Error(`${flag} requires a value.`);
    return value;
  };

  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--max-runs") {
      const raw = takeValue("--max-runs");
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0)
        throw new Error(`--max-runs must be a non-negative number, got "${raw}".`);
      maxRuns = value;
    } else if (arg === "--cells") {
      cellFilter = new Set(takeValue("--cells").split(","));
    } else if (arg === "--fixtures") {
      fixtureFilter = new Set(takeValue("--fixtures").split(","));
    } else {
      throw new Error(`Unknown argument "${arg}".`);
    }
  }

  return { maxRuns, cellFilter, fixtureFilter };
}

/**
 * `runReview()` throwing means the SDK rejected before ever yielding a `result` message — the
 * only case a rate limit can look different from every other failure, since a failure that
 * *does* yield a `result` message only ever carries one of the SDK's own `error_*` subtypes,
 * none of which distinguish a quota rejection from a genuine bug (`schema.ts`'s `ReviewRun`
 * contract does not expose the underlying error text for that path).
 */
function classifyThrownError(err: unknown): { resultSubtype: string; errorMessage: string } {
  const message = err instanceof Error ? err.message : String(err);
  // The subscription usage-limit rejection observed in practice reads "You've hit your limit ·
  // resets <time>" — it never says "rate limit" or "quota", so the phrase-based patterns below
  // exist specifically to catch it alongside the more conventional API-style wording.
  const looksLikeUsageLimit =
    /rate.?limit|usage.?limit|quota|too many requests|\b429\b|blocking_limit|rapid_refill_breaker|hit\s+(your|the|its)\s+(usage\s+)?limit|reached\s+(your|the)\s+(usage\s+)?limit/i.test(
      message,
    );
  return {
    resultSubtype: looksLikeUsageLimit ? RATE_LIMITED_SUBTYPE : "error_during_execution",
    errorMessage: message,
  };
}

function buildThrownErrorRun(fixture: Fixture, resultSubtype: string, durationMs: number): ReviewRun {
  const meta: ReportMeta = {
    branch: fixture.branch,
    base: fixture.baseSha,
    fileCount: 0,
    diffUnavailable: false,
    diffTruncated: false,
    diffTotalLines: 0,
    diffIncludedLines: 0,
  };

  return {
    output: null,
    consistencyViolations: [],
    verdict: null,
    costUsd: 0,
    numTurns: 0,
    resultSubtype,
    durationMs,
    changedFileCount: 0,
    meta,
  };
}

interface RunOneResult {
  run: ReviewRun;
  /** Only set when `runReview()` threw — kept alongside the run so the JSONL record stays
   * auditable instead of the classification silently discarding the text it was decided on. */
  errorMessage?: string;
}

async function runOne(cell: Cell, fixture: Fixture): Promise<RunOneResult> {
  const startedAt = Date.now();
  try {
    const run = await withFixtureWorktree(fixture, (worktreePath) =>
      runReview({
        repoRoot: worktreePath,
        base: fixture.baseSha,
        branch: fixture.branch,
        prTitle: fixture.prTitle,
        prBody: fixture.prBody,
        model: cell.model,
        effort: cell.effort,
        // Silent: 48 runs of full assistant text is unreadable and is exactly the noise the
        // JSONL exists to replace.
      }),
    );
    return { run };
  } catch (err) {
    const { resultSubtype, errorMessage } = classifyThrownError(err);
    console.error(`  threw: ${errorMessage}`);
    return { run: buildThrownErrorRun(fixture, resultSubtype, Date.now() - startedAt), errorMessage };
  }
}

async function main(): Promise<void> {
  const { maxRuns, cellFilter, fixtureFilter } = parseArgs(process.argv.slice(2));

  const allFixtures = loadFixtures();
  const fixtures = fixtureFilter ? allFixtures.filter((fixture) => fixtureFilter.has(fixture.id)) : allFixtures;
  const cells = cellFilter ? CELLS.filter((cell) => cellFilter.has(cell.id)) : CELLS;

  if (fixtures.length === 0) throw new Error("No fixtures matched --fixtures.");
  if (cells.length === 0) throw new Error("No cells matched --cells.");

  mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });

  const cellSize = fixtures.length * RUNS_PER_FIXTURE;
  let completed = 0;
  let consecutiveRateLimited = 0;
  let quotaStopped = false;

  cellLoop: for (const cell of cells) {
    if (completed + cellSize > maxRuns) {
      const remaining = cells.slice(cells.indexOf(cell)).map((c) => c.id);
      console.log(`\nCeiling reached (${completed}/${maxRuns}) — not running: ${remaining.join(", ")}`);
      break;
    }

    console.log(
      `\n=== ${cell.id} (${cell.model} @ ${cell.effort}${cell.effortSupported ? "" : ", effort not supported"}) ===`,
    );

    for (const fixture of fixtures) {
      for (let runIndex = 0; runIndex < RUNS_PER_FIXTURE; runIndex++) {
        const { run, errorMessage } = await runOne(cell, fixture);
        const outcome = scoreRun(fixture, run);
        completed += 1;
        consecutiveRateLimited = outcome === "rate_limited" ? consecutiveRateLimited + 1 : 0;

        const record: EvalRunRecord = {
          cellId: cell.id,
          fixtureId: fixture.id,
          runIndex,
          timestamp: new Date().toISOString(),
          run,
          outcome,
          ...(errorMessage !== undefined ? { errorMessage } : {}),
        };
        appendFileSync(RESULTS_PATH, `${JSON.stringify(record)}\n`);
        console.log(`  [${completed}/${maxRuns}] ${cell.id} × ${fixture.id} #${runIndex + 1}: ${outcome}`);

        if (consecutiveRateLimited >= QUOTA_STOP_STREAK) {
          console.log(
            `\n${QUOTA_STOP_STREAK} consecutive rate-limited runs — stopping; the subscription's usage limit looks spent.`,
          );
          quotaStopped = true;
          break cellLoop;
        }
      }
    }
  }

  console.log(
    `\nSweep finished: ${completed} run(s) recorded to ${RESULTS_PATH}${quotaStopped ? " (quota stop)" : ""}`,
  );
}

// Importing this module for its exports (e.g. `RESULTS_PATH`) must not also start a sweep —
// only running the file directly does.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
