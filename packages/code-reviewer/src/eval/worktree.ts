/**
 * Materializes a fixture as a real commit in a throwaway detached worktree, and guarantees its
 * removal. Nothing seeded ever touches a real branch.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { getRepoRoot } from "../git.ts";
import type { Fixture } from "./fixtures.ts";

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 }).trim();
}

// The rig never depends on the machine's git identity — every eval commit carries this instead.
const FIXED_IDENTITY = ["-c", "user.name=jobtracker-eval", "-c", "user.email=eval@jobtracker.local"];

// `finally` only protects a *thrown* run (an errored fixture, a rejected model call). A signal
// (Ctrl-C on the sweep, or a CI job cancellation) tears the process down without ever reaching
// it, so every in-flight worktree is also tracked here and swept by a process-level handler —
// belt-and-braces on top of `finally`, not a replacement for it.
const activeWorktrees = new Set<string>();
let signalHandlersRegistered = false;

function registerSignalHandlers(repoRoot: string): void {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;

  const cleanupAndExit = (signal: NodeJS.Signals): void => {
    for (const worktreePath of activeWorktrees) {
      try {
        git(["worktree", "remove", "--force", worktreePath], repoRoot);
      } catch {
        // Best-effort — the process is exiting either way.
      }
    }
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.once("SIGINT", () => cleanupAndExit("SIGINT"));
  process.once("SIGTERM", () => cleanupAndExit("SIGTERM"));
}

/**
 * Prunes stale worktrees, creates a detached worktree at `fixture.baseSha` under the OS temp
 * dir, applies `change.patch`, commits it with a fixed identity, invokes `fn(worktreePath)`, and
 * removes the worktree in a `finally` — so a failed or rate-limited run never blocks the next
 * `git worktree add` at the same path or leaves a stale entry in the repo's worktree list.
 */
export async function withFixtureWorktree<T>(fixture: Fixture, fn: (worktreePath: string) => Promise<T>): Promise<T> {
  const repoRoot = getRepoRoot();
  registerSignalHandlers(repoRoot);
  git(["worktree", "prune"], repoRoot);

  const worktreePath = path.join(os.tmpdir(), `jobtracker-eval-${fixture.id}-${randomUUID()}`);
  git(["worktree", "add", "--detach", worktreePath, fixture.baseSha], repoRoot);
  activeWorktrees.add(worktreePath);

  try {
    git(["apply", fixture.patchPath], worktreePath);
    git(["add", "-A"], worktreePath);
    git([...FIXED_IDENTITY, "commit", "-m", `eval: ${fixture.title}`], worktreePath);

    return await fn(worktreePath);
  } finally {
    git(["worktree", "remove", "--force", worktreePath], repoRoot);
    activeWorktrees.delete(worktreePath);
  }
}
