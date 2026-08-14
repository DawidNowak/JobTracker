/**
 * Loads the eval corpus from `src/eval/fixtures/<id>/`. Each fixture directory holds
 * `fixture.json` (this file's shape) and `change.patch` — the seeded diff, pinned to `baseSha`.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CriterionId } from "../criteria.ts";

const FIXTURES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

export type FixtureExpectation = { kind: "violation"; criterion: CriterionId; files: string[] } | { kind: "clean" };

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

    return { ...parsed, patchPath: path.join(dir, "change.patch") };
  });
}
