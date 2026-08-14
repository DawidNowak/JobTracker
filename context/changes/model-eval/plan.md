# Reviewer Model Eval Implementation Plan

## Overview

`packages/code-reviewer/src/index.ts:26` hardcodes `const MODEL = "claude-sonnet-5"`, and the
README justifies it with a single anecdote — _"Investigates before scoring — `claude-haiku-4-5`
never opened a file"_. Cost is stated as a guess (`~$0.30-1.00`). Nothing measured any of it.

This change builds a small, repeatable eval harness inside the reviewer package, uses it to run a
4-cell × 6-fixture × 2-run sweep as far as the subscription's usage limits allow, and applies the
result to the shipping config. The point is not only to answer "which model" once — it is that the next model release
starts from a committed baseline instead of a fresh opinion.

## Current State Analysis

**What exists.** The reviewer is a self-contained package (`@jobtracker/code-reviewer`, zero
tests, two runtime dependencies) driving the Claude Agent SDK's `query()` against an embedded
diff. As of `code-review-impr` it emits genuinely machine-comparable output: five criterion
statuses, a structured findings array with `file`/`line`/severity/confidence, and a verdict
computed in Node by `deriveVerdict()` rather than authored by the model.

**What that unlocks.** Scoring a review no longer means grading prose. A seeded violation is
caught iff the owning criterion comes back `FAIL` with a `BLOCKING` finding pointing at the right
file — a predicate, not a judgment call.

**What is missing.** There is no way to run the reviewer against anything but the current branch.
`main()` (`src/index.ts:104-222`) is a single function that resolves the repo root from cwd,
computes the merge-base against `origin/master`, runs the query, then delivers a report and emits
a verdict to `$GITHUB_OUTPUT`. Model and effort are module constants, not parameters. Nothing
returns run metrics to a caller.

### Key Discoveries:

- **The git layer is already parameterized.** `getChangedFiles(base, cwd)`, `getDiffStat(base, cwd)`
  and `getDiff(base, cwd)` all take base and cwd explicitly (`src/git.ts:59-106`). Only
  `getMergeBase()` hardcodes `master`. An eval that supplies its own base SHA and worktree path
  needs **no change to `git.ts` at all**.
- **Run metrics are already on the wire.** The `result` message carries `num_turns` and
  `total_cost_usd`, currently only logged (`src/index.ts:196`). Cost and turn capture is a return
  value away.
- **`xhigh` is a valid SDK effort level** — `sdk.d.ts:1425` types `effort?: EffortLevel` as
  `'low' | 'medium' | 'high' | 'xhigh' | 'max'`.
- **Effort is silently downgraded on models that do not support it** — `sdk.d.ts:141` describes
  the active level as being reported "after any silent downgrade for the selected model".
  `claude-haiku-4-5` does not support effort, so the haiku cell is really "haiku, effort ignored".
  No error surfaces; the harness must label it rather than print a comparable-looking `@ high`.
- **PR head commits are reachable** — spot-checked 4 historical PR heads, 3 present locally, the
  4th fetchable via `refs/pull/N/head`. Not needed for the seeded-fixture approach, but it means
  the realistic-diff fixtures deferred below stay available later.
- **`settingSources: ["project"]` resolves from the session cwd** (`src/index.ts:161`), so a
  fixture worktree must be a full repo checkout — `CLAUDE.md` → `AGENTS.md` must be present at
  its root or the reviewer loses every project convention it scores against.

## Desired End State

`npm run eval` inside `packages/code-reviewer` runs the candidate matrix against a committed
fixture corpus and writes a scored results matrix. `context/changes/model-eval/results.md` holds
the first sweep's numbers and the decision derived from them. `src/index.ts`'s `MODEL` and `effort`
carry values the sweep produced, and the README's "How it is wired" table cites the eval instead of
an anecdote.

**Verification:** a deliberately mis-seeded fixture is reported as `missed` rather than silently
passing (Phase 3 automated criterion, replayed against a stored run so it costs nothing); and
`npm run review` on a normal branch behaves exactly as it does today (Phase 1 manual, re-checked in
Phase 5). Re-running the full sweep is _not_ claimed as a verification — it is a multi-hour,
quota-bound operation and these are stochastic model runs, so "reproduces the matrix shape" is not
something the plan can assert cheaply or honestly.

## What We're NOT Doing

- **Not hand-labeling real PRs.** Ground truth is seeded-by-construction only.
- **Not testing a second prompt variant.** The shipping prompt and criteria are held fixed; the
  recall-suppression confound is documented in the report, not experimentally separated.
- **Not sweeping the full model × effort grid.** Four cells, not twelve.
- **Not including `claude-fable-5`** as a quality ceiling reference.
- **Not adding a test runner or any new dependency** to the package.
- **Not wiring the eval into CI.** It is a manual, human-triggered tool.
- **Not changing `criteria.ts`, `prompt.ts`, `schema.ts`, or `git.ts`** — the eval measures the
  pipeline as it ships.
- **Not changing the 3000-line diff cap** or the `context/**` exclusion.
- **Not re-tuning `maxTurns` or `maxBudgetUsd`.** Both are tail-calibrated against real 3000-line
  PRs; the corpus is small-diff by design and cannot speak to either. See Phase 5 §1.
- **Not measuring cost.** The sweep runs on subscription auth, so dollar figures are indicative at
  best (see Critical Implementation Details).

## Implementation Approach

One structural refactor unlocks everything else: pull the `query()` call out of `main()` into a
`runReview()` function that takes its context (repo root, base, branch, model, effort) as
arguments and returns the parsed output plus run metrics — delivering no report and emitting no
verdict. `main()` becomes the CI/local caller; the eval becomes a second caller.

Fixtures are `.patch` files pinned to a base SHA. The runner creates a detached worktree at that
SHA, applies the patch, commits it inside the worktree, and calls `runReview()` with the worktree
as repo root and the pinned SHA as base. Nothing seeded ever touches a real branch.

Scoring is a predicate over the structured output, and the decision rule is lexicographic:
correctness first, then reliability, then turns and latency. Cells run cheapest-first so that a
sweep cut short still answers the cheapest questions.

## Critical Implementation Details

**The sweep runs on subscription auth, so cost is not a measured dimension.** The only credential
configured in this repo is `CLAUDE_CODE_OAUTH_TOKEN` (`packages/code-reviewer/.env`, and
`.github/workflows/ai-code-review.yml:38` for CI), which bills to a Claude subscription rather than
per-token. `total_cost_usd` may therefore report `0` or a notional figure — `index.ts:196` already
hedges it with `?? 0`. Consequences, decided deliberately:

- The sweep ceiling is a **run count**, not a dollar figure. A dollar ceiling that reads a field
  which may always be `0` is a guard that silently does not exist.
- The decision rule's third tier breaks ties on **turns and latency**, not cost. Cost is still
  recorded per run as observational data and rendered in the matrix, labeled as indicative only.
- The real constraint is the subscription's usage limits, which is an accepted bound: the sweep
  runs as far as the subscription allows and reports what it got.

**A rate-limited run is not an errored run.** Because the bound above is a quota rather than a
budget, the tail of a long sweep is where refusals appear — and tier 2 of the decision rule ranks
cells on errored-run count. If a quota refusal is scored as `errored`, the opus cell (last and
heaviest) is penalized for running late in the sweep rather than for anything the model did. The
scorer must separate the two, and only model-side failures may feed tier 2.

**`runReview()` must not deliver or emit.** `deliverReport()` posts a PR comment when
`GITHUB_ACTIONS`/`GITHUB_EVENT_NAME` indicate a `pull_request` run (`src/output.ts:102-131`), and
`emitVerdict()` appends to `$GITHUB_OUTPUT`. Both must stay in `main()`. If either moves inside
the extracted function, a future eval run in any GitHub-Actions context would post 48 comments and
overwrite the verdict the real review step depends on.

**Worktree cleanup must survive a thrown run.** A failed or rate-limited run that leaves a
worktree behind blocks the next `git worktree add` at the same path and leaves a stale entry in
the repository's worktree list. Removal belongs in a `finally`, and the runner should
`git worktree prune` before starting.

**Order the ceiling check before the run, not after.** The ceiling is a run count checked before
dispatch, so a sweep stopped at the ceiling never overshoots. `maxBudgetUsd: 2.00` stays in place
as the per-run runaway guard it already is — it is not the sweep's bound.

## Phase 1: Extract the `runReview()` seam

### Overview

Make the reviewer callable as a function with injectable context and model settings, without
changing a single observable behavior of `npm run review`.

### Changes Required:

#### 1. Review runner

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Split `main()` into a reusable runner and a thin CLI/CI entry point. The runner owns
diff collection and the `query()` call and returns everything a caller needs to judge the run; the
entry point keeps credential reporting, report delivery, verdict emission, and the exit code.

**Contract**: A new exported `runReview(options)` where options carry `repoRoot`, `base`, `branch`,
`prTitle`, `prBody`, optional `model` / `effort` defaulting to the current constants, and an
optional `onMessage(message)` callback. Returns a `ReviewRun` — the parsed `ReviewOutput | null`,
`consistencyViolations: string[]`, `verdict: Verdict | null`, `costUsd: number`, `numTurns: number`,
`resultSubtype: string`, `durationMs: number`, `changedFileCount: number`, plus the diff metadata
`ReportMeta` already needs. It throws nothing for a model-side failure: an errored run is a returned
shape with `output: null` and a populated `resultSubtype`.

Two members of that contract exist specifically so §2 can keep `main()`'s behavior byte-identical
while the `query()` loop lives here:

- **`onMessage`** — the streaming console output (`index.ts:175-183`) sits inside the loop this
  phase relocates, so it cannot stay in `main()` on its own. `main()` passes the existing logging
  closure verbatim; the eval passes nothing, because 48 runs of full assistant text is unreadable
  and is exactly the noise the JSONL exists to replace.
- **`changedFileCount`** — the empty-changeset early return (`index.ts:116-119`) depends on
  `getChangedFiles()`, which this phase moves into the runner. `0` means the runner dispatched
  nothing: `output` is `null` and `resultSubtype` is `no_changes`. The decision to print and return
  stays in `main()`, over data the runner hands back, rather than `main()` calling
  `getChangedFiles()` a second time.

`MODEL` and the `effort` value stay module-level constants used as the defaults, so the shipping
configuration remains a one-line edit in Phase 5.

#### 2. Entry point

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: `main()` resolves the same context it does today (`getRepoRoot`, `getMergeBase`,
`PR_HEAD_REF`/`PR_TITLE`/`PR_BODY`), calls `runReview()`, then performs exactly the delivery,
labeling, and `process.exit(1)` logic that exists now.

**Contract**: The empty-changeset early return (driven by `changedFileCount === 0`), the console
streaming of assistant text and tool calls (passed in as `onMessage`), the "no valid structured
output" error path, the consistency-violation path, and the exit code must all behave identically.
`deliverReport()` and `emitVerdict()` are called only here.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Repo typecheck unaffected: `npm run typecheck`
- Lint passes: `npm run lint`
- Prettier is clean: `npm run format` produces no diff on the package

#### Manual Verification:

- `npm run review` on a branch with changes produces the same console output and report as before the refactor
- `npm run review` on a branch with no changes still exits early without calling the API
- No call to `deliverReport` or `emitVerdict` exists inside `runReview`

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 2: Fixture rig and corpus

### Overview

A fixture is a pinned base SHA plus a patch that introduces exactly one known rule violation (or
none, for the control). The rig materializes one in a throwaway worktree and tears it down.

### Changes Required:

#### 1. Fixture format

**File**: `packages/code-reviewer/src/eval/fixtures/<fixture-id>/fixture.json` (+ `change.patch`)

**Intent**: Declare what a fixture is and what catching it means, so scoring never re-reads the
patch.

**Contract**: Each fixture directory holds `change.patch` and a `fixture.json` of this shape — the
`expect` union is the contract Phase 3's scorer branches on:

```jsonc
{
  "id": "rls-using-true",
  "title": "Migration adds an RLS policy with USING (true)",
  "baseSha": "<40-char SHA>",
  "branch": "eval/rls-using-true", // branch name reported to the reviewer
  "prTitle": "...", // author-intent fields, as a real PR would carry
  "prBody": "...",
  "expect": {
    "kind": "violation", // or "clean"
    "criterion": "security_and_data_isolation",
    "files": ["supabase/migrations/20260812090000_eval_notes_table.sql"],
  },
}
```

#### 2. Worktree lifecycle

**File**: `packages/code-reviewer/src/eval/worktree.ts`

**Intent**: Materialize a fixture as a real commit in an isolated checkout and guarantee its
removal.

**Contract**: `withFixtureWorktree(fixture, fn)` — prunes stale worktrees, creates a detached
worktree at `baseSha` under the OS temp dir, applies `change.patch`, commits it with a fixed
identity, invokes `fn(worktreePath)`, and removes the worktree in a `finally`. All git invocations
go through `execFileSync` with argument arrays, matching `git.ts`'s existing style. Commits use
`-c user.name=... -c user.email=...` so the rig never depends on the machine's git identity.

#### 3. The corpus

**File**: `packages/code-reviewer/src/eval/fixtures/`

**Intent**: One seeded violation per criterion plus one clean control, each pinned to the same base
SHA (current `master`) to minimize rot.

**Contract**: Six fixtures. Each seeded patch introduces its violation as a plausible-looking
change — not a file named `bad-rls.sql`, and not a comment announcing the bug — because an
obviously-labelled fixture measures nothing.

| Fixture                   | Criterion                     | Seeded violation                                                                                       |
| ------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `rls-using-true`          | `security_and_data_isolation` | New table migration whose policy uses `USING (true)`                                                   |
| `route-missing-prerender` | `api_and_validation_contract` | New API route without `export const prerender = false` and with an unvalidated body reaching the query |
| `lib-purity-break`        | `architecture_boundaries`     | A Supabase call and domain logic added to `src/lib/`, imported via a relative deep path                |
| `swallowed-await`         | `correctness`                 | A missing `await` on a write whose rejection is swallowed by an empty catch                            |
| `service-layer-assert`    | `test_discipline`             | A test asserting through `src/lib/services/` instead of the PostgREST row level                        |
| `clean-control`           | — (clean)                     | A small, genuinely rule-abiding change: must come back `PASS`                                          |

The clean control carries a trap worth stating explicitly: `criteria.ts:87` makes coverage
risk-proportional, so a "clean" patch that introduces a new code path without a test is
_legitimately_ failable under `test_discipline` — and the scorer would record that correct call as a
`false_positive`. The control must therefore be a change that introduces no new risk-bearing path
(copy, comment, or type-level edit), not merely a change that breaks no explicit rule.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Every fixture's patch applies cleanly at its pinned base SHA (rig exposes a `--check` mode that applies and discards all six)
- No worktree remains after a `--check` run: `git worktree list` shows only the primary tree

#### Manual Verification:

- Each seeded patch reads as a plausible change — no filename, comment, or identifier announces the planted violation
- The clean control genuinely violates no rule in `criteria.ts` (read it against all five)
- Aborting a `--check` run mid-way (Ctrl-C) leaves no worktree that blocks a re-run

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 3: Matrix runner and scoring

### Overview

Run the cells against the corpus in cheapest-first order under a hard run-count ceiling, score each
run against its fixture's expectation, and emit both a machine-readable matrix and a readable
report.

### Changes Required:

#### 1. Candidate matrix

**File**: `packages/code-reviewer/src/eval/cells.ts`

**Intent**: Declare the four cells and their run order, with the haiku effort caveat attached as
data rather than left to the reader.

**Contract**: Ordered array of `{ id, model, effort, effortSupported: boolean, note?: string }`.
Order: `haiku-4-5 @ high` → `sonnet-5 @ high` → `sonnet-5 @ xhigh` → `opus-5 @ high`. The haiku
cell carries `effortSupported: false` and a note that the SDK silently downgrades it.

#### 2. Scorer

**File**: `packages/code-reviewer/src/eval/score.ts`

**Intent**: Turn one `ReviewRun` plus its fixture into a single categorical outcome, with no
partial credit and no weighting.

**Contract**: `scoreRun(fixture, run): RunOutcome` where `RunOutcome` is one of `caught`, `missed`,
`misattributed`, `false_positive`, `clean_pass`, `errored`, or `rate_limited`.

- `rate_limited` — the result subtype or error text indicates a subscription usage limit rather than
  a model-side failure. Recorded and reported, but excluded from tier 2 of the decision rule and
  from every per-cell denominator: it is a property of the quota, not of the model. A cell whose
  remaining runs are all rate-limited is reported as **partially run**, exactly like a cell the
  ceiling never reached.
- `errored` — `output === null`, or `consistencyViolations.length > 0`, or a non-success result
  subtype that is _not_ a usage limit.
- For `expect.kind === "violation"`: `caught` iff the expected criterion is `FAIL` **and** carries
  at least one `BLOCKING` finding whose `file` matches one of `expect.files`. **Match on a
  normalized path suffix, never on string equality.** `expect.files` holds repo-relative POSIX
  paths, but nothing constrains the form the model emits — `prompt.ts:78` describes `file` only as
  "the location you verified the finding against", and the Read tool the agent uses takes _absolute_
  paths, which under the eval point into an OS temp worktree on a Windows host. Normalize separators
  to `/`, strip any worktree-path prefix, then compare by suffix. A form mismatch here would be
  silent and uniform — every cell scores `missed` and the report reads as "every model is bad"
  rather than "the scorer is broken";
  `misattributed` iff some _other_ criterion is `FAIL` with a `BLOCKING` finding on an expected
  file; otherwise `missed`.
- For `expect.kind === "clean"`: `clean_pass` iff the derived verdict is `PASS`; otherwise
  `false_positive`.

Exported pure, so it stays testable if the package ever gains a runner.

#### 3. Sweep driver

**File**: `packages/code-reviewer/src/eval/run.ts` (+ `"eval"` script in `package.json`)

**Intent**: Execute cells × fixtures × 2 runs in order, enforce the ceiling before dispatch, persist
each result as it completes, and never lose finished work to a later abort.

**Contract**: Reads a `--max-runs` (default `48`, the full matrix) and optional `--cells` /
`--fixtures` filters, parsed by hand — no argument-parsing dependency. Appends each completed run to
a JSONL file under `packages/code-reviewer/eval-results/` (git-ignored) immediately, so an abort or
crash preserves everything already finished.

**The ceiling stops on a cell boundary, not a run boundary.** Before starting a cell it checks
whether the completed-run count plus that cell's full 12 runs would exceed `--max-runs`, and stops
if so. A per-run check would strand the sweep partway through a cell — realistically the opus cell,
which is last and heaviest — and a cell with 5 of 12 runs is neither "ran" nor "not run", which is
the binary framing every downstream consumer assumes (criterion 4.4, the per-cell denominators, and
tier 1's rate comparison).

The sweep also stops cleanly on a run of consecutive `rate_limited` outcomes rather than burning the
remaining matrix against a spent quota. Unlike the ceiling, a quota stop **cannot** be aligned to a
cell boundary — it happens when it happens. That is why the report prints every rate with its
denominator (Phase 3 §4): a partially-run cell is reported as partial and ranked on what it actually
completed, never silently compared against a full cell as though the denominators matched.

#### 4. Report renderer

**File**: `packages/code-reviewer/src/eval/report.ts`

**Intent**: Render the matrix as markdown, applying the lexicographic decision rule and showing its
working.

**Contract**: Per cell, two correctness columns rather than one, because collapsing repeats hides
exactly the flakiness the repeats exist to detect:

- **Per-run tally** (`x/10` violation runs caught, `y/2` clean runs passed) — the raw counts, and
  the figures tier 1 ranks on.
- **Per-fixture count** (`of 5`) — a fixture counts as caught only when **both** of its runs caught
  it. This is the strict column; a fixture caught once and missed once is _not_ a catch here, and
  the gap between the two columns is the cell's flakiness made visible.

Plus: errored-run count, rate-limited count, median turns, median duration, and median/min/max cost
— the cost column labeled indicative only, since the sweep runs on subscription auth.

Then a ranking section applying, in order:

1. **Correctness, as a rate rather than a gate.** Rank cells on catch rate (caught runs / scored
   violation runs) and false-positive rate (false-positive runs / scored clean runs). A cell is
   eliminated only if its catch rate falls more than one fixture-run below the best cell's — a
   single flaky miss never eliminates anyone, a systematic gap always does. Tier 1 is a _ranking_
   step, so it always yields an ordering; the binary "one miss is fatal" reading is deliberately
   rejected, because with 10 violation runs per cell it turns run-to-run noise into a verdict.
2. **Reliability.** Among cells not eliminated, prefer fewer errored runs. Rate-limited runs are
   excluded from both the count and the denominator.
3. **Efficiency.** Break remaining ties on median turns, then latency.

Every rate is printed with its denominator (`4/10`, not `40%`), because a quota-truncated sweep
leaves cells with different denominators and a bare percentage would hide that. If two cells remain
tied after tier 3, the report names the tie and recommends the incumbent — a tie is not a reason to
change what ships.

#### 5. Ignore the results directory

**File**: `.gitignore`

**Intent**: Keep raw JSONL run logs out of git; only the curated `results.md` is committed.

**Contract**: One entry for `packages/code-reviewer/eval-results/`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Lint passes: `npm run lint`
- A single-cell, single-fixture dry run completes and appends one JSONL record: `npm run eval -- --cells haiku-high --fixtures clean-control`
- A `--max-runs 0` run aborts before dispatching any model call and reports every cell as not-run
- The negative control scores `missed`, not `caught`: re-running the completed single-fixture record through `scoreRun()` with the fixture's `expect.criterion` pointed at a different criterion id returns `missed` (no model call — replays the stored JSONL run)
- `git status` is clean after a run — no stray worktrees, no untracked result files

#### Manual Verification:

- The rendered report's ranking section states which tier decided the order, and names any cell it eliminated and why
- The haiku row is visibly labeled as effort-not-supported rather than presented as `@ high`
- Killing the sweep mid-run preserves all previously completed records in the JSONL

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 4: Run the sweep and decide

### Overview

Execute the full 48-run matrix, apply the decision rule, and commit the outcome as a durable
baseline.

### Changes Required:

#### 1. Sweep execution

**File**: — (operational step, no source change)

**Intent**: Run `npm run eval` to completion, or as far as the subscription allows, and capture the
raw JSONL.

**Contract**: 4 cells × 6 fixtures × 2 runs = 48 reviews. The bound is the subscription's usage
limits, not a dollar figure — the sweep runs as far as it gets and reports what it completed. The
opus cell is heaviest and runs last, so it is the one most likely to be cut short. That is the
accepted, pre-agreed outcome: cheapest-first ordering means a truncated sweep still answers "was
haiku really unusable" and "is `high` or `xhigh` right for the incumbent". Resuming after a quota
reset is a matter of re-running with `--cells` narrowed to what did not complete; the JSONL is
append-only, so nothing already finished is re-paid for.

#### 2. Results record

**File**: `context/changes/model-eval/results.md`

**Intent**: Commit the matrix, the decision, and the caveats so the next model release starts from
a baseline rather than a fresh argument.

**Contract**: The rendered report, plus a short decision section naming the winning cell and the
tier that decided it; an explicit statement of the three known caveats (seeded fixtures are easier
than real defects; measured recall is partly a property of the `BLOCKING`/`CERTAIN` evidence rule
in `prompt.ts`, not solely of the model; the sweep ran on subscription auth, so the cost column is
indicative and this eval is **not** a cost measurement); and the date and package version the sweep
ran against.

### Success Criteria:

#### Automated Verification:

- The sweep terminates by completion, clean ceiling stop, or clean quota stop — not by an unhandled exception
- `git worktree list` shows only the primary tree afterward
- `results.md` exists at `context/changes/model-eval/results.md`

#### Manual Verification:

- Every cell is either complete (12 runs — 6 fixtures × 2), explicitly listed as not-run, or explicitly labeled **partial** with its actual denominators shown
- The winning cell is justified by a stated rule tier, not by a judgment call
- All three caveats are written down in `results.md`
- If the ceiling or the subscription quota cut the sweep short before opus, the report says so rather than implying opus lost

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 5: Apply the outcome

### Overview

Move the eval's findings into the shipping configuration and replace the README's anecdote with a
derivation.

### Changes Required:

#### 1. Shipping configuration

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Set `MODEL` and `effort` to the winning cell's values. Nothing else in this file
changes.

**Contract**: `MODEL` (`:26`) and `effort` (`:169`) only. `maxTurns` (`:168`) and `maxBudgetUsd`
(`:172`) are deliberately **left alone**: both are tail-calibrated against real 3000-line PRs —
`maxTurns: 20` exists because a real run at `10` exhausted its turns before producing valid
structured output, and `maxBudgetUsd: 2.00` is documented as "roughly 20-30x the current per-run
cost — only fires on a runaway". The corpus is deliberately small-diff, so its turn counts are a
median on toy inputs, not a tail on real ones; re-deriving a tail guard from it could set `maxTurns`
_below_ today's value and reintroduce the exact `error_max_structured_output_retries` failure it was
raised to prevent. If the winner is the incumbent at its current settings, this file does not change
at all and the plan says so explicitly rather than manufacturing a diff.

#### 2. README

**File**: `packages/code-reviewer/README.md`

**Intent**: Replace the anecdotal `model` justification with the eval's numbers and point at the
results record.

**Contract**: The `model` row of the "How it is wired" table (`:83-94`) and a short pointer to
`context/changes/model-eval/results.md`. Add an `effort` row — currently the table omits it
entirely despite `index.ts:169` setting it — citing the sweep. The `maxTurns` and `maxBudgetUsd`
rows keep their existing justifications, since Phase 5 §1 leaves both values alone. The "Cost per
review" sentence (`:111`) also stays: it describes real 3000-line PRs, which this eval does not
measure — the sweep ran on subscription auth against small fixture diffs. Replacing it with fixture
numbers would make the documentation less accurate than the estimate it replaced.

#### 3. Eval documentation

**File**: `packages/code-reviewer/README.md`

**Intent**: Document how to re-run the eval when a new model ships, since that repeatability is the
whole reason for building the harness rather than doing a one-off comparison.

**Contract**: A short section covering `npm run eval`, the `--max-runs` / `--cells` / `--fixtures`
flags, how to add a fixture, and the fixture-rot caveat (patches are pinned to a base SHA and must
be re-pinned if that region of the tree changes materially).

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Lint passes: `npm run lint`
- Full repo gate is green: `npm run typecheck && npm run lint && npm test`
- Prettier is clean: `npm run format` produces no diff

#### Manual Verification:

- `npm run review` on a real branch works end-to-end on the newly configured model and effort
- Every number in the README's `model` and `effort` rows traces to a figure in `results.md`
- The README's `maxTurns`, `maxBudgetUsd` and "Cost per review" text is unchanged
- The README no longer contains the `claude-haiku-4-5 never opened a file` anecdote as justification
- A reader can re-run the eval from the README alone

**Implementation Note**: This is the final phase. After automated verification passes, pause for
manual confirmation before closing the change out.

---

## Testing Strategy

The package ships no test runner, and this change does not add one. Verification is therefore
structured as: pure functions kept exported and testable, plus explicit manual gates.

### Pure, exported, testable-later:

- `scoreRun()` — the whole scoring contract in one pure function over `(fixture, run)`
- The ranking function in `report.ts` — pure over the aggregated matrix
- These join `deriveVerdict()` and `checkConsistency()`, which the previous change left in the same
  deliberately-testable-later state

### Integration checks (manual, via flags):

- `--check` applies and discards every fixture patch: proves the corpus is not rotted
- `--max-runs 0`: proves the ceiling gate fires before dispatch, spending nothing
- Single-cell single-fixture run: proves the full path end-to-end for one review
- Negative control: replaying that stored run through `scoreRun()` with a deliberately wrong
  `expect.criterion` must return `missed` — proves the scorer can fail, which is the only thing
  separating "the models missed it" from "the predicate never fires"

### Manual Testing Steps:

1. Run `npm run review` before and after Phase 1 on the same branch; diff the console output.
2. Run the fixture `--check` and confirm `git worktree list` is clean afterward.
3. Run one cheap cell against `clean-control`; confirm one JSONL record with a `clean_pass` outcome.
4. Run with `--max-runs 0`; confirm zero model calls and a complete not-run list.
5. Ctrl-C a multi-run sweep; confirm completed records survive and no worktree is orphaned.

## Performance Considerations

Wall-clock, not throughput, is the constraint: each review takes a couple of minutes, so 48 runs is
a multi-hour sequential sweep. Runs stay **sequential** deliberately — concurrent runs would
contend on the shared worktree path, make the run-count ceiling check racy, and distort the
latency numbers the eval is trying to measure.

## Migration Notes

No schema, no data, no deployed surface. The only backward-compatibility obligation is Phase 1's:
`npm run review` and the CI composite action must behave identically after the refactor. The
`verdict=<value>` line written to `$GITHUB_OUTPUT` is the CI contract, and it must keep being
written from `main()` alone.

## References

- Predecessor plan: `context/changes/code-review-impr/plan.md` (criteria-as-data + the mechanical gate)
- Archived predecessor: `context/archive/2026-08-11-cicd-review-impr/plan-brief.md`
- Reviewer package: `packages/code-reviewer/README.md`
- Entry point to refactor: `packages/code-reviewer/src/index.ts:104`
- Scoring surface: `packages/code-reviewer/src/schema.ts:157` (`deriveVerdict`), `:168` (`checkConsistency`)
- Effort downgrade behavior: `packages/code-reviewer/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:141`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract the `runReview()` seam

#### Automated

- [x] 1.1 Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- [x] 1.2 Repo typecheck unaffected: `npm run typecheck`
- [x] 1.3 Lint passes: `npm run lint`
- [x] 1.4 Prettier is clean: `npm run format` produces no diff on the package

#### Manual

- [x] 1.5 `npm run review` produces the same console output and report as before the refactor
- [x] 1.6 `npm run review` on a branch with no changes still exits early without calling the API
- [x] 1.7 No call to `deliverReport` or `emitVerdict` exists inside `runReview`

### Phase 2: Fixture rig and corpus

#### Automated

- [x] 2.1 Typecheck passes: `cd packages/code-reviewer && npm run typecheck` — 6a7191f
- [x] 2.2 Every fixture's patch applies cleanly at its pinned base SHA (`--check` mode) — 6a7191f
- [x] 2.3 No worktree remains after a `--check` run: `git worktree list` shows only the primary tree — 6a7191f

#### Manual

- [x] 2.4 Each seeded patch reads as a plausible change — nothing announces the planted violation — 6a7191f
- [x] 2.5 The clean control genuinely violates no rule in `criteria.ts` — 6a7191f
- [x] 2.6 Aborting a `--check` run mid-way leaves no worktree that blocks a re-run — 6a7191f

### Phase 3: Matrix runner and scoring

#### Automated

- [x] 3.1 Typecheck passes: `cd packages/code-reviewer && npm run typecheck` — 7bdfdb5
- [x] 3.2 Lint passes: `npm run lint` — 7bdfdb5
- [x] 3.3 Single-cell single-fixture dry run completes and appends one JSONL record — 7bdfdb5
- [x] 3.4 A `--max-runs 0` run aborts before dispatching any model call and reports every cell as not-run — 7bdfdb5
- [x] 3.5 The negative control scores `missed`, not `caught` — a stored run replayed through `scoreRun()` with `expect.criterion` pointed at a different criterion id — 7bdfdb5
- [x] 3.6 `git status` is clean after a run — no stray worktrees, no untracked result files — 7bdfdb5

#### Manual

- [x] 3.7 The ranking section states which tier decided the order, and names any cell it eliminated and why — 7bdfdb5
- [x] 3.8 The haiku row is labeled effort-not-supported rather than presented as `@ high` — 7bdfdb5
- [x] 3.9 Killing the sweep mid-run preserves all previously completed records in the JSONL — 7bdfdb5

### Phase 4: Run the sweep and decide

#### Automated

- [x] 4.1 The sweep terminates by completion, clean ceiling stop, or clean quota stop, not by an unhandled exception — 399d04c
- [x] 4.2 `git worktree list` shows only the primary tree afterward — 399d04c
- [x] 4.3 `results.md` exists at `context/changes/model-eval/results.md` — 399d04c

#### Manual

- [x] 4.4 Every cell is complete (12 runs), explicitly not-run, or explicitly labeled partial with its actual denominators shown — 399d04c
- [x] 4.5 The winning cell is justified by a stated rule tier, not a judgment call — 399d04c
- [x] 4.6 All three caveats are written down in `results.md` — 399d04c
- [x] 4.7 If the ceiling or quota cut the sweep short before opus, the report says so rather than implying opus lost — 399d04c

### Phase 5: Apply the outcome

#### Automated

- [x] 5.1 Typecheck passes: `cd packages/code-reviewer && npm run typecheck` — 8ea8a03
- [x] 5.2 Lint passes: `npm run lint` — 8ea8a03
- [x] 5.3 Full repo gate is green: `npm run typecheck && npm run lint && npm test` — 8ea8a03
- [x] 5.4 Prettier is clean: `npm run format` produces no diff — 8ea8a03

#### Manual

- [x] 5.5 `npm run review` works end-to-end on the newly configured model and effort — 8ea8a03
- [x] 5.6 Every number in the README's `model` and `effort` rows traces to a figure in `results.md` — 8ea8a03
- [x] 5.7 The README's `maxTurns`, `maxBudgetUsd` and "Cost per review" text is unchanged — 8ea8a03
- [x] 5.8 The README no longer cites the haiku anecdote as justification — 8ea8a03
- [x] 5.9 A reader can re-run the eval from the README alone — 8ea8a03
