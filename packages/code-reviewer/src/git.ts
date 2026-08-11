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

/** Diff text is capped at this many lines before being embedded in the task prompt. */
const MAX_DIFF_LINES = 3000;

/**
 * Full diff text for the changeset, generated-file exclusions folded in directly. Embedded
 * straight into the task prompt rather than left for the agent to fetch itself.
 */
export function getDiff(base: string, cwd: string): string {
  const excludes = GENERATED_FILE_EXCLUDES.map((p) => `:(exclude)${p}`);
  return git(["diff", base, "--", ".", ...excludes], cwd);
}

export interface TruncatedDiff {
  text: string;
  totalLines: number;
  includedLines: number;
  truncated: boolean;
}

/** Placeholder used when the diff itself could not be fetched (see `getDiff`'s call site). */
export const EMPTY_DIFF: TruncatedDiff = { text: "", totalLines: 0, includedLines: 0, truncated: false };

/**
 * Caps diff text at `maxLines`, cutting wherever that falls rather than aligning to file
 * boundaries — a bounded review should always run rather than being blocked or silently
 * skipped.
 */
export function truncateDiff(text: string, maxLines = MAX_DIFF_LINES): TruncatedDiff {
  const lines = text.split("\n");
  const totalLines = lines.length;
  const truncated = totalLines > maxLines;
  return {
    text: truncated ? lines.slice(0, maxLines).join("\n") : text,
    totalLines,
    includedLines: truncated ? maxLines : totalLines,
    truncated,
  };
}
