/**
 * Loads the eval corpus from `src/eval/fixtures/<id>/`. Each fixture directory holds
 * `fixture.json` (this file's shape) and `change.patch` — the seeded diff, pinned to `baseSha`.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CriterionId } from "../criteria.ts";

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export interface PlantedDefect {
  id: string;
  criterion: CriterionId;
  /** Exactly one file per defect — see the fixture-authoring rule in the plan. */
  file: string;
  /** The written rule this defect breaks, e.g. "AGENTS.md 🚫 — never USING (true)". */
  rule: string;
}

export interface Decoy {
  id: string;
  /** Exactly one file per decoy. */
  file: string;
  /** Why this is innocent despite looking guilty. */
  note: string;
}

export type FixtureExpectation =
  | { kind: "violation"; criterion: CriterionId; files: string[] }
  | { kind: "clean" }
  | { kind: "multi"; defects: PlantedDefect[]; decoys: Decoy[] };

export interface Fixture {
  id: string;
  title: string;
  baseSha: string;
  branch: string;
  prTitle: string;
  prBody: string;
  expect: FixtureExpectation;
  /** Absolute path to the fixture's `change.patch`, resolved at load time. */
  patchPath: string;
}

interface FixtureJson {
  id: string;
  title: string;
  baseSha: string;
  branch: string;
  prTitle: string;
  prBody: string;
  expect: FixtureExpectation;
}

/**
 * `multi` ground truth is load-bearing at fixture-authoring scale, so drift is caught at load
 * time rather than silently mis-scoring a sweep: every planted item's id is unique within the
 * fixture, every item's file is claimed by exactly one item (defect or decoy), and every
 * `rule` / `note` is non-empty.
 */
function validateExpectation(fixtureId: string, expect: FixtureExpectation): void {
  if (expect.kind !== "multi") return;

  const seenIds = new Set<string>();
  const seenFiles = new Set<string>();

  for (const item of [...expect.defects, ...expect.decoys]) {
    if (seenIds.has(item.id)) {
      throw new Error(`Fixture "${fixtureId}": duplicate planted-item id "${item.id}".`);
    }
    seenIds.add(item.id);

    if (seenFiles.has(item.file)) {
      throw new Error(`Fixture "${fixtureId}": file "${item.file}" is claimed by more than one planted item.`);
    }
    seenFiles.add(item.file);
  }

  for (const defect of expect.defects) {
    if (defect.rule.trim() === "") {
      throw new Error(`Fixture "${fixtureId}": defect "${defect.id}" has an empty rule.`);
    }
  }

  for (const decoy of expect.decoys) {
    if (decoy.note.trim() === "") {
      throw new Error(`Fixture "${fixtureId}": decoy "${decoy.id}" has an empty note.`);
    }
  }
}

/** Reads every `fixtures/<id>/fixture.json`, in directory-name order. */
export function loadFixtures(): Fixture[] {
  const ids = readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  return ids.map((id) => {
    const dir = path.join(FIXTURES_DIR, id);
    const raw = readFileSync(path.join(dir, "fixture.json"), "utf8");
    const parsed = JSON.parse(raw) as FixtureJson;

    if (parsed.id !== id) {
      throw new Error(`Fixture directory "${id}" declares id "${parsed.id}" — the two must match.`);
    }

    validateExpectation(id, parsed.expect);

    return { ...parsed, patchPath: path.join(dir, "change.patch") };
  });
}
