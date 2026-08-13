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
  cleanFalsePositive: number;
  perFixtureCaught: number;
  perFixtureTotal: number;
  errored: number;
  rateLimited: number;
  medianTurns: number | null;
  medianDurationMs: number | null;
  costs: { median: number | null; min: number | null; max: number | null };
}

function summarizeCell(cell: Cell, allRecords: EvalRunRecord[], fixtures: Fixture[]): CellSummary {
  const records = allRecords.filter((record) => record.cellId === cell.id);
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
  const cleanFalsePositive = scoredClean.filter((record) => record.outcome === "false_positive").length;

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
    cleanFalsePositive,
    perFixtureCaught,
    perFixtureTotal,
    errored,
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
  const cleanTally =
    summary.cleanScored > 0 ? `${summary.cleanScored - summary.cleanFalsePositive}/${summary.cleanScored}` : "—";
  const perFixture = summary.perFixtureTotal > 0 ? `${summary.perFixtureCaught}/${summary.perFixtureTotal}` : "—";
  const turns = summary.medianTurns ?? "—";
  const duration = summary.medianDurationMs !== null ? `${(summary.medianDurationMs / 1000).toFixed(0)}s` : "—";
  const cost =
    summary.costs.median !== null
      ? `$${summary.costs.median.toFixed(4)} (min $${(summary.costs.min ?? 0).toFixed(4)}, max $${(summary.costs.max ?? 0).toFixed(4)})`
      : "—";

  return `| ${label} | ${status} | ${violationTally} | ${cleanTally} | ${perFixture} | ${summary.errored} | ${summary.rateLimited} | ${turns} | ${duration} | ${cost} |`;
}

interface RankingResult {
  order: CellSummary[];
  eliminated: Map<string, string>;
  decidingTier: 1 | 2 | 3 | null;
  tieNote: string | null;
}

/**
 * Tier 1: rank by catch rate; a cell is eliminated only if its caught-run count falls more than
 * one fixture-run below the best cell's (a single flaky miss never eliminates, a systematic gap
 * always does). Tier 2 (fewer errored runs) and tier 3 (turns, then latency) only run among
 * survivors, and only when the prior tier leaves every survivor exactly tied.
 */
function rankCells(summaries: CellSummary[]): RankingResult {
  const ranked = summaries.filter((summary) => summary.violationScored > 0);
  const eliminated = new Map<string, string>();

  if (ranked.length === 0) {
    return { order: [], eliminated, decidingTier: null, tieNote: null };
  }

  const bestCaught = Math.max(...ranked.map((summary) => summary.violationCaught));
  const survivors = ranked.filter((summary) => {
    const gap = bestCaught - summary.violationCaught;
    if (gap > 1) {
      eliminated.set(
        summary.cell.id,
        `caught ${summary.violationCaught}/${summary.violationScored} violation runs, ${gap} fewer than the best cell's ${bestCaught} — a systematic gap, not a single flaky miss.`,
      );
      return false;
    }
    return true;
  });

  const catchRate = (summary: CellSummary): number => summary.violationCaught / summary.violationScored;
  // `survivors` always contains at least the cell that achieved `bestCaught` (gap 0), so `first`
  // below is never undefined despite `noUncheckedIndexedAccess`.
  const first = (list: CellSummary[]): CellSummary => {
    const head = list[0];
    if (head === undefined) throw new Error("rankCells: survivors unexpectedly empty");
    return head;
  };

  let decidingTier: 1 | 2 | 3 = 1;
  let order = [...survivors].sort((a, b) => catchRate(b) - catchRate(a));

  const tier1Tied = order.length > 1 && order.every((summary) => catchRate(summary) === catchRate(first(order)));
  if (tier1Tied) {
    decidingTier = 2;
    order = [...survivors].sort((a, b) => a.errored - b.errored);

    const tier2Tied = order.length > 1 && order.every((summary) => summary.errored === first(order).errored);
    if (tier2Tied) {
      decidingTier = 3;
      order = [...order].sort((a, b) => {
        const turnsDiff = (a.medianTurns ?? Infinity) - (b.medianTurns ?? Infinity);
        return turnsDiff !== 0 ? turnsDiff : (a.medianDurationMs ?? Infinity) - (b.medianDurationMs ?? Infinity);
      });
    }
  }

  const runnerUp = order[1];
  const winner = first(order);
  const stillTied =
    runnerUp !== undefined &&
    winner.medianTurns === runnerUp.medianTurns &&
    winner.medianDurationMs === runnerUp.medianDurationMs &&
    catchRate(winner) === catchRate(runnerUp) &&
    winner.errored === runnerUp.errored;

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
    "| Cell | Status | Violation caught (per-run) | Clean passed (per-run) | Violation caught (per-fixture) | Errored | Rate-limited | Median turns | Median duration | Cost (indicative) |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summaries.map(formatCellRow),
    "",
    renderRanking(summaries),
  ];

  return lines.join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(renderReport());
}
