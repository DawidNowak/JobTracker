/**
 * `--check` mode for the fixture rig: applies and discards every fixture's patch in its own
 * throwaway worktree, proving the corpus is not rotted — no model call, nothing kept. `multi`
 * fixtures additionally get their declared ground truth checked against the applied tree: the
 * one-item-per-file rule and the rule citations are load-bearing for scoring, so a fixture that
 * drifts from its declared defects/decoys fails here rather than silently mis-scoring a sweep.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { loadFixtures, type Fixture } from "./fixtures.ts";
import { withFixtureWorktree } from "./worktree.ts";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 }).trim();
}

function declaredFiles(fixture: Fixture): string[] {
  if (fixture.expect.kind !== "multi") return [];
  return [...fixture.expect.defects.map((defect) => defect.file), ...fixture.expect.decoys.map((decoy) => decoy.file)];
}

/**
 * `withFixtureWorktree` always applies the patch as exactly one commit on top of `baseSha`
 * (`worktree.ts:64`), so `HEAD~1..HEAD` is always the fixture's diff, regardless of which
 * commit `baseSha` itself points to.
 */
function validateGroundTruth(fixture: Fixture, worktreePath: string): void {
  const files = declaredFiles(fixture);
  if (files.length === 0) return;

  const changed = new Set(
    git(["diff", "--name-only", "HEAD~1", "HEAD"], worktreePath)
      .split("\n")
      .filter((line) => line.length > 0),
  );

  for (const file of files) {
    if (!existsSync(path.join(worktreePath, file))) {
      throw new Error(`declared file "${file}" does not exist in the applied worktree.`);
    }
    if (!changed.has(file)) {
      throw new Error(`declared file "${file}" is not part of the fixture's diff.`);
    }
  }
}

async function main(): Promise<void> {
  const fixtures = loadFixtures();
  let failed = false;

  for (const fixture of fixtures) {
    try {
      await withFixtureWorktree(fixture, async (worktreePath) => {
        validateGroundTruth(fixture, worktreePath);
      });
      console.log(`  ok    ${fixture.id}`);
    } catch (err) {
      failed = true;
      console.error(`  FAIL  ${fixture.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failed) {
    console.error(`\n${fixtures.length} fixture(s) checked, at least one failed to apply.`);
    process.exit(1);
  }

  console.log(`\n${fixtures.length} fixture(s) applied cleanly.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
