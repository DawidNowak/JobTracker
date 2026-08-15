/**
 * Re-scores every stored eval run (`eval-results/runs.jsonl`) through the current `scoreRun` and
 * `gradeRun`, with no model calls, and asserts the exact tally the frame derived from the 48
 * records already on disk. Proves the `score.ts` bucket split is correct against evidence that
 * already exists, rather than a smoke test that would pass on an accidentally-broken scorer too.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadFixtures, type Fixture } from "./fixtures.ts";
import { gradeRun } from "./grade.ts";
import { RESULTS_PATH, type EvalRunRecord } from "./run.ts";
import { scoreRun, type RunOutcome } from "./score.ts";

const EXPECTED_TALLY: Record<RunOutcome, number> = {
  caught: 37,
  clean_pass: 8,
  inconsistent: 3,
  errored: 0,
  missed: 0,
  misattributed: 0,
  false_positive: 0,
  rate_limited: 0,
};

const EXPECTED_INCONSISTENT = new Set([
  "haiku-high × rls-using-true",
  "haiku-high × service-layer-assert",
  "sonnet-high × rls-using-true",
]);

function loadRecords(): EvalRunRecord[] {
  if (!existsSync(RESULTS_PATH)) return [];
  return readFileSync(RESULTS_PATH, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as EvalRunRecord);
}

function emptyTally(): Record<RunOutcome, number> {
  return {
    caught: 0,
    missed: 0,
    misattributed: 0,
    false_positive: 0,
    clean_pass: 0,
    errored: 0,
    inconsistent: 0,
    rate_limited: 0,
  };
}

function main(): void {
  const fixtures = new Map<string, Fixture>(loadFixtures().map((fixture) => [fixture.id, fixture]));
  const records = loadRecords();

  const tally = emptyTally();
  const inconsistentKeys: string[] = [];

  for (const record of records) {
    const fixture = fixtures.get(record.fixtureId);
    if (fixture === undefined) {
      throw new Error(`Record references unknown fixture "${record.fixtureId}".`);
    }

    const outcome = scoreRun(fixture, record.run);
    tally[outcome] += 1;
    if (outcome === "inconsistent") inconsistentKeys.push(`${record.cellId} × ${record.fixtureId}`);

    // Exercised so a `gradeRun` regression against the same stored evidence is caught here too,
    // not only via its own numeric tally.
    gradeRun(fixture, record.run);
  }

  console.log(`Replayed ${records.length} record(s) from ${RESULTS_PATH}.`);
  console.log("Outcome tally:", tally);
  console.log("Inconsistent runs:", inconsistentKeys);

  let ok = true;

  for (const key of Object.keys(EXPECTED_TALLY) as RunOutcome[]) {
    if (tally[key] !== EXPECTED_TALLY[key]) {
      console.error(`Mismatch on "${key}": expected ${EXPECTED_TALLY[key]}, got ${tally[key]}.`);
      ok = false;
    }
  }

  const actualInconsistent = new Set(inconsistentKeys);
  const sameSize = actualInconsistent.size === EXPECTED_INCONSISTENT.size;
  const sameMembers = [...EXPECTED_INCONSISTENT].every((key) => actualInconsistent.has(key));
  if (!sameSize || !sameMembers) {
    console.error(
      `Inconsistent-run identity mismatch.\n  expected: ${[...EXPECTED_INCONSISTENT].join(", ")}\n  got:      ${inconsistentKeys.join(", ")}`,
    );
    ok = false;
  }

  if (!ok) {
    console.error("\nReplay FAILED — see mismatches above.");
    process.exit(1);
  }

  console.log("\nReplay OK — tally and inconsistent-run identities match the recorded evidence.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
