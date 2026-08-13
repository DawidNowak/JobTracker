/**
 * `--check` mode for the fixture rig: applies and discards every fixture's patch in its own
 * throwaway worktree, proving the corpus is not rotted — no model call, nothing kept.
 */

import { loadFixtures } from "./fixtures.ts";
import { withFixtureWorktree } from "./worktree.ts";

async function main(): Promise<void> {
  const fixtures = loadFixtures();
  let failed = false;

  for (const fixture of fixtures) {
    try {
      await withFixtureWorktree(fixture, async () => {});
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
