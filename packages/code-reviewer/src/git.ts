import { execFileSync } from "node:child_process";

const BASE_BRANCH = "master";

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 }).trim();
}

function refExists(ref: string, cwd?: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function getRepoRoot(): string {
  return git(["rev-parse", "--show-toplevel"]);
}

export function getCurrentBranch(cwd: string): string {
  return git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

/**
 * Fork point between the current branch and master. Diffing against this rather than
 * against `master` itself keeps commits that landed on master after we branched out of
 * the review.
 *
 * A CI checkout of a PR (e.g. actions/checkout on `pull_request`) lands in detached HEAD
 * with no local `master` branch — only the remote-tracking `origin/master` exists. Prefer
 * that when present; it's also the more correct target on a dev machine, since it reflects
 * the real upstream branch rather than a local `master` that may be stale.
 */
export function getMergeBase(cwd: string): string {
  const base = refExists(`origin/${BASE_BRANCH}`, cwd) ? `origin/${BASE_BRANCH}` : BASE_BRANCH;
  return git(["merge-base", base, "HEAD"], cwd);
}

/**
 * `git diff <base>` with no second ref compares the working tree against <base>, covering
 * committed, staged and unstaged changes to *tracked* files. Untracked files produce no
 * diff line at all, so they are collected separately — a branch whose entire contribution
 * is new files would otherwise be reported as "nothing to review".
 */
export function getChangedFiles(base: string, cwd: string): string[] {
  const tracked = git(["diff", "--name-status", base], cwd);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd);

  const lines = tracked ? tracked.split("\n") : [];
  if (untracked) {
    for (const file of untracked.split("\n")) {
      lines.push(`U\t${file}`);
    }
  }
  return lines;
}

export function getDiffStat(base: string, cwd: string): string {
  return git(["diff", "--stat", base], cwd);
}

/**
 * Files whose diff body is noise for a review: npm-managed lockfiles and the Supabase-
 * generated types file. A change to one of these still shows up in `getChangedFiles` and
 * `getDiffStat` — the model sees *that* it changed — but the mechanical body is excluded
 * here so it isn't spent reading hash churn or generated type declarations.
 */
const GENERATED_FILE_EXCLUDES = ["**/package-lock.json", "**/database.types.ts"];

/**
 * Full unified diff for all tracked changes against `base` in one shot, so the review
 * prompt can embed it directly instead of the model spending a turn per file on
 * `git diff <base> -- <path>`. Untracked files are not covered — `git diff` never shows
 * them — the model reads those directly via the Read tool.
 */
export function getFullDiff(base: string, cwd: string): string {
  return git(["diff", base, "--", ".", ...GENERATED_FILE_EXCLUDES.map((p) => `:(exclude)${p}`)], cwd);
}
