/**
 * Renders the sweep's JSONL results as a markdown matrix, applying the lexicographic decision
 * rule (correctness, then reliability, then efficiency) and showing its working. Run directly
 * (`tsx src/eval/report.ts`) to print the report to stdout.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CELLS, type Cell } from "./cells.ts";
import { loadFixtures, type Fixture } from "./fixtures.ts";
import { RESULTS_PATH, RUNS_PER_FIXTURE, type EvalRunRecord } from "./run.ts";
import { scoreRun } from "./score.ts";

function loadRecords(): EvalRunRecord[] {
  if (!existsSync(RESULTS_PATH)) return [];
  return readFileSync(RESULTS_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as EvalRunRecord);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const middle = sorted[mid];
  if (middle === undefined) return null; // unreachable given the length guard above
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] ?? middle) + middle) / 2 : middle;
}

interface CellSummary {
  cell: Cell;
  status: "not_run" | "partial" | "complete";
  violationScored: number;
  violationCaught: number;
  cleanScored: number;
  cleanPass: number;
  perFixtureCaught: number;
  perFixtureTotal: number;
  errored: number;
  inconsistent: number;
  rateLimited: number;
  medianTurns: number | null;
  medianDurationMs: number | null;
  costs: { median: number | null; min: number | null; max: number | null };
}

/**
 * The persisted `record.outcome` reflects whatever scorer wrote it at sweep time — for the 48
 * records already on disk, that is the pre-split scorer, which cannot tell "inconsistent" from
 * "errored". Re-derive the outcome from the current `scoreRun` instead of trusting the stored
 * value, so a scorer fix is visible in the report without re-running the sweep. Falls back to the
 * stored value if the record's fixture can't be resolved (a stale fixture id) or `scoreRun`
 * declines to score it (a `multi` fixture, which this report's tables don't cover).
 */
function resolveOutcome(record: EvalRunRecord, fixturesById: Map<string, Fixture>): EvalRunRecord["outcome"] {
  const fixture = fixturesById.get(record.fixtureId);
  if (fixture === undefined) return record.outcome;
  try {
    return scoreRun(fixture, record.run);
  } catch {
    return record.outcome;
  }
}

function summarizeCell(cell: Cell, allRecords: EvalRunRecord[], fixtures: Fixture[]): CellSummary {
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const records = allRecords
    .filter((record) => record.cellId === cell.id)
    .map((record) => ({ ...record, outcome: resolveOutcome(record, fixturesById) }));
  const violationFixtures = fixtures.filter((fixture) => fixture.expect.kind === "violation");
  const cleanFixtures = fixtures.filter((fixture) => fixture.expect.kind === "clean");
  const expectedRuns = fixtures.length * RUNS_PER_FIXTURE;

  const status: CellSummary["status"] =
    records.length === 0 ? "not_run" : records.length < expectedRuns ? "partial" : "complete";

  const violationIds = new Set(violationFixtures.map((fixture) => fixture.id));
  const cleanIds = new Set(cleanFixtures.map((fixture) => fixture.id));

  const violationRecords = records.filter((record) => violationIds.has(record.fixtureId));
  const cleanRecords = records.filter((record) => cleanIds.has(record.fixtureId));

  // Rate-limited runs are excluded from every per-cell denominator — a property of the quota,
  // not of the model.
  const scoredViolation = violationRecords.filter((record) => record.outcome !== "rate_limited");
  const scoredClean = cleanRecords.filter((record) => record.outcome !== "rate_limited");

  const violationCaught = scoredViolation.filter((record) => record.outcome === "caught").length;
  const cleanPass = scoredClean.filter((record) => record.outcome === "clean_pass").length;

  // Strict per-fixture column: a fixture counts as caught only when both of its runs caught it.
  let perFixtureCaught = 0;
  let perFixtureTotal = 0;
  for (const fixture of violationFixtures) {
    const runs = violationRecords.filter((record) => record.fixtureId === fixture.id);
    if (runs.length < RUNS_PER_FIXTURE) continue;
    perFixtureTotal += 1;
    if (runs.every((record) => record.outcome === "caught")) perFixtureCaught += 1;
  }

  const errored = records.filter((record) => record.outcome === "errored").length;
  const inconsistent = records.filter((record) => record.outcome === "inconsistent").length;
  const rateLimited = records.filter((record) => record.outcome === "rate_limited").length;

  // Turns/duration/cost are only meaningful for a run that actually completed a review.
  const successful = records.filter((record) => record.run.resultSubtype === "success");
  const turns = successful.map((record) => record.run.numTurns);
  const durations = successful.map((record) => record.run.durationMs);
  const costs = successful.map((record) => record.run.costUsd);

  return {
    cell,
    status,
    violationScored: scoredViolation.length,
    violationCaught,
    cleanScored: scoredClean.length,
    cleanPass,
    perFixtureCaught,
    perFixtureTotal,
    errored,
    inconsistent,
    rateLimited,
    medianTurns: median(turns),
    medianDurationMs: median(durations),
    costs: {
      median: median(costs),
      min: costs.length ? Math.min(...costs) : null,
      max: costs.length ? Math.max(...costs) : null,
    },
  };
}

function formatCellRow(summary: CellSummary): string {
  const { cell, status } = summary;
  const label = cell.effortSupported
    ? `${cell.model} @ ${cell.effort}`
    : `${cell.model} @ ${cell.effort} (effort not supported)`;
  const violationTally = summary.violationScored > 0 ? `${summary.violationCaught}/${summary.violationScored}` : "—";
  const cleanTally = summary.cleanScored > 0 ? `${summary.cleanPass}/${summary.cleanScored}` : "—";
  const perFixture = summary.perFixtureTotal > 0 ? `${summary.perFixtureCaught}/${summary.perFixtureTotal}` : "—";
  const turns = summary.medianTurns ?? "—";
  const duration = summary.medianDurationMs !== null ? `${(summary.medianDurationMs / 1000).toFixed(0)}s` : "—";
  const cost =
    summary.costs.median !== null
      ? `$${summary.costs.median.toFixed(4)} (min $${(summary.costs.min ?? 0).toFixed(4)}, max $${(summary.costs.max ?? 0).toFixed(4)})`
      : "—";

  return `| ${label} | ${status} | ${violationTally} | ${cleanTally} | ${perFixture} | ${summary.errored} | ${summary.inconsistent} | ${summary.rateLimited} | ${turns} | ${duration} | ${cost} |`;
}

interface RankingResult {
  order: CellSummary[];
  eliminated: Map<string, string>;
  decidingTier: 1 | 2 | 3 | null;
  tieNote: string | null;
}

/**
 * Tier 1: rank by catch rate; a cell is eliminated only if its catch rate falls more than one
 * fixture-run's worth below the best cell's, scaled to its own run count (a single flaky miss
 * never eliminates, a systematic gap always does). Tier 2 (fewer errored runs) and tier 3 (turns,
 * then latency) break ties left by
 * the tier before them — a single lexicographic sort, so a leader-only tie (e.g. two cells tied
 * at the top with a third cell behind both) is disambiguated by tier 2/3 exactly like a
 * cohort-wide tie is. Requiring *every* survivor to share the same catch rate before tier 2 could
 * even run would silently fall back to declaration order for the actual leaders whenever a
 * lower-ranked survivor's rate happened to differ — the exact "judgment call, not a stated tier"
 * outcome the plan's success criteria rule out.
 */
function rankCells(summaries: CellSummary[]): RankingResult {
  const ranked = summaries.filter((summary) => summary.violationScored > 0);
  const eliminated = new Map<string, string>();

  if (ranked.length === 0) {
    return { order: [], eliminated, decidingTier: null, tieNote: null };
  }

  const catchRate = (summary: CellSummary): number => summary.violationCaught / summary.violationScored;

  // Denominators can legitimately differ per cell (rate-limited runs are excluded per cell), so
  // the "more than one fixture-run below the best" margin is expressed in rate terms, then scaled
  // to this cell's own run count — comparing raw `violationCaught` counts across cells with
  // different denominators would unfairly penalize a quota-truncated cell with a perfect rate.
  const bestRate = Math.max(...ranked.map(catchRate));
  const survivors = ranked.filter((summary) => {
    const gap = (bestRate - catchRate(summary)) * summary.violationScored;
    if (gap > 1) {
      eliminated.set(
        summary.cell.id,
        `caught ${summary.violationCaught}/${summary.violationScored} violation runs — ${gap.toFixed(1)} runs below what the best cell's catch rate would imply over the same run count, a systematic gap rather than a single flaky miss.`,
      );
      return false;
    }
    return true;
  });
  // `survivors` always contains at least the cell that achieved `bestCaught` (gap 0), so `first`
  // below is never undefined despite `noUncheckedIndexedAccess`.
  const first = (list: CellSummary[]): CellSummary => {
    const head = list[0];
    if (head === undefined) throw new Error("rankCells: survivors unexpectedly empty");
    return head;
  };

  // "Reliability" folds inconsistent runs in alongside errored ones for tier 2 — both are a run
  // the cell failed to produce a usable result for, just for different reasons.
  const reliabilityGap = (summary: CellSummary): number => summary.errored + summary.inconsistent;

  const order = [...survivors].sort((a, b) => {
    const rateDiff = catchRate(b) - catchRate(a);
    if (rateDiff !== 0) return rateDiff;
    const reliabilityDiff = reliabilityGap(a) - reliabilityGap(b);
    if (reliabilityDiff !== 0) return reliabilityDiff;
    const turnsDiff = (a.medianTurns ?? Infinity) - (b.medianTurns ?? Infinity);
    if (turnsDiff !== 0) return turnsDiff;
    return (a.medianDurationMs ?? Infinity) - (b.medianDurationMs ?? Infinity);
  });

  const winner = first(order);
  const runnerUp = order[1];

  let decidingTier: 1 | 2 | 3 = 1;
  if (runnerUp !== undefined && catchRate(winner) === catchRate(runnerUp)) {
    decidingTier = reliabilityGap(winner) === reliabilityGap(runnerUp) ? 3 : 2;
  }

  const stillTied =
    runnerUp !== undefined &&
    catchRate(winner) === catchRate(runnerUp) &&
    reliabilityGap(winner) === reliabilityGap(runnerUp) &&
    winner.medianTurns === runnerUp.medianTurns &&
    winner.medianDurationMs === runnerUp.medianDurationMs;

  return {
    order,
    eliminated,
    decidingTier,
    tieNote: stillTied
      ? `\`${winner.cell.id}\` and \`${runnerUp.cell.id}\` remain tied after all three tiers — the incumbent is recommended.`
      : null,
  };
}

function renderRanking(summaries: CellSummary[]): string {
  const { order, eliminated, decidingTier, tieNote } = rankCells(summaries);
  const lines: string[] = ["## Ranking", ""];

  if (order.length === 0) {
    lines.push("No cell has scored data yet — run the sweep first.");
    return lines.join("\n");
  }

  const tierLabel =
    decidingTier === 1 ? "Tier 1 (correctness)" : decidingTier === 2 ? "Tier 2 (reliability)" : "Tier 3 (efficiency)";
  lines.push(`**${tierLabel} decided the ranking.**`, "");
  lines.push(
    ...order.map(
      (summary, index) =>
        `${index + 1}. \`${summary.cell.id}\` — ${summary.violationCaught}/${summary.violationScored} caught`,
    ),
  );
  lines.push("");

  if (eliminated.size > 0) {
    lines.push("**Eliminated:**");
    for (const [cellId, reason] of eliminated) lines.push(`- \`${cellId}\`: ${reason}`);
  } else {
    lines.push("No cell was eliminated at Tier 1.");
  }
  lines.push("");

  if (tieNote) lines.push(`**Tie:** ${tieNote}`, "");

  return lines.join("\n");
}

export function renderReport(): string {
  const fixtures = loadFixtures();
  const records = loadRecords();
  const summaries = CELLS.map((cell) => summarizeCell(cell, records, fixtures));

  const lines: string[] = [
    "# Model eval — results matrix",
    "",
    `Generated ${new Date().toISOString()}. ${records.length} run(s) read from \`${RESULTS_PATH}\`. Cost is indicative only — the sweep runs on subscription auth.`,
    "",
    "| Cell | Status | Violation caught (per-run) | Clean passed (per-run) | Violation caught (per-fixture) | Errored | Inconsistent | Rate-limited | Median turns | Median duration | Cost (indicative) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summaries.map(formatCellRow),
    "",
    renderRanking(summaries),
  ];

  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(renderReport());
}
