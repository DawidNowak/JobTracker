# Reviewer Model Eval — Plan Brief

> Full plan: `context/changes/model-eval/plan.md`
> Predecessor: `context/changes/code-review-impr/plan.md`

## What & Why

The CI reviewer's model is chosen by anecdote. `src/index.ts:26` pins `claude-sonnet-5`, and the
README justifies it with one sentence — _"`claude-haiku-4-5` never opened a file"_ — while cost is
stated as a guess. This change builds a small eval harness inside the package, runs a measured
sweep, and applies the result. The harness matters more than the answer: when the next model ships,
the question gets re-answered by re-running a command instead of re-arguing an opinion.

## Starting Point

The previous change (`code-review-impr`) made the reviewer's output machine-comparable: five
criterion statuses, structured findings with `file`/`line`/severity/confidence, and a verdict
computed in Node by `deriveVerdict()`. That is what makes scoring a predicate rather than a
judgment call. What is missing is any way to run the reviewer against something other than the
current branch — `main()` resolves the repo root from cwd, computes the merge-base against
`origin/master`, and treats model and effort as module constants.

## Desired End State

`npm run eval` runs a candidate matrix against a committed fixture corpus and prints a scored
table. `results.md` in the change folder holds the first sweep's numbers and the decision derived
from them. The shipping `MODEL` and `effort` carry values the sweep produced, and the README cites
the eval instead of the anecdote.

## Key Decisions Made

| Decision         | Choice                                                      | Why (1 sentence)                                                                                                                                                                  |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deliverable      | Harness + first eval run                                    | A repeatable answer, not a one-off comparison that expires with the next release                                                                                                  |
| Ground truth     | Seeded violations (synthetic)                               | Exact by construction — no oracle bias, no slow hand-labeling                                                                                                                     |
| Execution        | Git worktree at the fixture commit                          | The agent's Read/Grep see the real tree, so "does it investigate?" is part of what's measured                                                                                     |
| Fixture storage  | `.patch` files applied in a throwaway worktree              | Fixtures are reviewable diffs; nothing seeded ever lands on a real branch                                                                                                         |
| Corpus           | 1 per criterion + 1 clean control (6)                       | Minimum that touches all five criteria and still measures false positives                                                                                                         |
| Matrix           | haiku@high, sonnet-5@high, sonnet-5@xhigh, opus-5@high      | Tests the incumbent at its own recommended effort, one tier up, and the haiku anecdote                                                                                            |
| Repeats          | 2 runs per fixture per cell                                 | Catches the occasional structured-output blowup without tripling spend                                                                                                            |
| Tier 1 shape     | Catch/false-positive **rate**, not a pass/fail gate         | A binary gate over 10 stochastic runs turns one flaky miss into a verdict, and can eliminate every cell — leaving Phase 5 nothing to apply                                        |
| Harness home     | `src/eval/` in the package, zero new deps                   | Preserves the package's zero-test, zero-dependency shape; no `AGENTS.md` ⚠️ gate tripped                                                                                          |
| Budget           | Run-count ceiling (48), checked before dispatch             | The sweep runs on subscription auth, so dollars are not the real bound — usage limits are                                                                                         |
| Ceiling behavior | Cheapest cells first, stop cleanly and keep partial results | A truncated sweep still answers the haiku and high-vs-xhigh questions                                                                                                             |
| Decision rule    | Correctness → reliability → turns/latency                   | A cheap reviewer that misses an RLS violation is worthless at any price; cost is not measurable here                                                                              |
| Prompt           | Held fixed; confound documented                             | Measures the pipeline as it ships, one variable at a time                                                                                                                         |
| End state        | `MODEL` + `effort` + README + `results.md`                  | Half the matrix is about effort — not acting on it would waste the sweep; `maxTurns`/`maxBudgetUsd` stay put, being tail-calibrated against real PRs the corpus does not resemble |

## Scope

**In scope:** `src/index.ts` (extract `runReview()`, then apply results) · `src/eval/*` (new) ·
6 fixture patches · `package.json` (`eval` script) · `.gitignore` · `packages/code-reviewer/README.md` ·
`context/changes/model-eval/results.md`

**Out of scope:** hand-labeled real PRs · a second prompt variant · the full model × effort grid ·
`claude-fable-5` · a test runner or any new dependency · CI wiring for the eval ·
`criteria.ts` / `prompt.ts` / `schema.ts` / `git.ts` · the 3000-line diff cap ·
re-tuning `maxTurns` / `maxBudgetUsd` · measuring cost

## Architecture / Approach

One refactor unlocks everything: pull the `query()` call out of `main()` into `runReview(options)`,
which takes repo root, base, branch, model and effort as arguments and returns the parsed output
plus run metrics — delivering no report and emitting no verdict. `main()` stays the CI caller; the
eval becomes a second caller.

The sweep then loops cells × fixtures × runs. For each, it creates a detached worktree at the
fixture's pinned base SHA, applies the patch, commits inside the worktree, and calls `runReview()`
against it. `scoreRun()` reduces the structured output to one categorical outcome, results append
to JSONL as they complete, and a renderer applies the lexicographic rule and shows its working.

Notably, `git.ts` needs **no changes** — every function there already takes `base` and `cwd`
explicitly; only `getMergeBase()` hardcodes `master`, and the eval supplies its own base.

## Phases at a Glance

| Phase                      | What it delivers                                             | Key risk                                                                        |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1. `runReview()` seam      | Reviewer callable as a function with injectable model/effort | Regressing the CI path — `deliverReport`/`emitVerdict` must stay in `main()`    |
| 2. Fixture rig & corpus    | 6 fixtures + worktree lifecycle                              | Orphaned worktrees blocking re-runs; over-obvious seeded bugs measuring nothing |
| 3. Matrix runner & scoring | Cheapest-first sweep, ceiling, scored matrix                 | Scoring predicate too strict or too loose — miscounts every cell equally        |
| 4. Run the sweep           | 48 runs, `results.md`                                        | **Highest** — the subscription quota may run out before the opus cell does      |
| 5. Apply the outcome       | Config + README cite the eval                                | None significant — config and docs                                              |

**Prerequisites:** none blocking. Working Agent SDK credentials (already configured), a clean
worktree list, and enough remaining subscription quota for a multi-hour sweep. No schema change, no
new dependency, no CI change.
**Estimated effort:** ~2 sessions. Phases 1–3 are one sitting; Phase 4 is a multi-hour sequential
sweep (each review takes minutes, runs stay sequential deliberately).

## Open Risks & Assumptions

- **The subscription quota may not cover the opus cell.** The sweep runs on `CLAUDE_CODE_OAUTH_TOKEN`
  (the only credential configured, locally and in CI), so the bound is usage limits rather than
  dollars. Cheapest-first ordering plus an append-only JSONL is the mitigation: a truncated sweep
  keeps everything it finished and can resume with `--cells` narrowed after a quota reset.
- **Cost is not a measured dimension.** Under subscription auth `total_cost_usd` may report `0` or a
  notional figure, so the ceiling is a run count, the decision rule's third tier is turns/latency,
  and the cost column in the report is labeled indicative only.
- **A rate-limited run must not be scored as an errored run.** Quota refusals cluster at the tail of
  a long sweep, which is exactly where the opus cell runs — scoring them as `errored` would penalize
  opus for running last rather than for anything it did.
- **Seeded violations are easier than real defects.** A model can ace the corpus and still miss
  subtle real bugs. Accepted trade for exact, re-runnable ground truth; written into `results.md`.
- **Measured recall is partly a property of the prompt.** Current Claude models follow
  "only block on `BLOCKING` + `CERTAIN` evidence" literally — `prompt.ts` encodes exactly that
  shape. The confound is documented, not experimentally separated.
- **`claude-haiku-4-5` does not support effort**; the SDK silently downgrades it (`sdk.d.ts:141`).
  The haiku cell is "haiku, effort ignored" and must be labeled as such, not printed as `@ high`.
- Fixture patches are pinned to a base SHA and will rot if that region of the tree changes
  materially; re-pinning is a documented maintenance step, not an automated one.

## Success Criteria (Summary)

- `npm run eval` produces a scored matrix, and a deliberately mis-seeded fixture scores `missed`
  rather than silently passing — the scorer is provably able to fail.
- The shipping model and effort are backed by numbers in `results.md`, not an anecdote.
- `npm run review` behaves identically after the refactor — the CI `verdict=` contract is intact.
