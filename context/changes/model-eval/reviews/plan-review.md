<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Reviewer Model Eval

- **Plan**: `context/changes/model-eval/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-13
- **Verdict**: REVISE → SOUND (all 8 findings fixed in the plan)
- **Findings**: 3 critical, 5 warnings, 0 observations

## Verdicts

| Dimension             | Verdict (at review) | After fixes |
| --------------------- | ------------------- | ----------- |
| End-State Alignment   | FAIL                | PASS        |
| Lean Execution        | PASS                | PASS        |
| Architectural Fitness | WARNING             | PASS        |
| Blind Spots           | FAIL                | PASS        |
| Plan Completeness     | WARNING             | PASS        |

## Grounding

9/9 paths ✓, 12/12 symbols ✓, brief↔plan ✓, Progress↔Phase contract ✓ (5 phases, 36 rows at
review time, all matched). One trivial drift: `deriveVerdict` is `schema.ts:158`, plan cites `:157`.
No `context/foundation/lessons.md` and no `docs/reference/contract-surfaces.md` in this project —
both checks skipped.

Verified against source: `MODEL` (`index.ts:26`), `main()` (`:104-222`), `maxTurns` (`:168`),
`effort` (`:169`), `maxBudgetUsd` (`:172`), `settingSources` (`:161`), `deliverReport`
(`output.ts:122`), `getChangedFiles`/`getDiffStat`/`getDiff` (`git.ts:59-106`), `BASE_BRANCH`
(`git.ts:3`), `EffortLevel` incl. `xhigh` (`sdk.d.ts:480`), silent-downgrade wording
(`sdk.d.ts:141`), `duration_ms`/`num_turns`/`total_cost_usd` on the result message
(`sdk.d.ts:3295-3324`), the five criterion ids (`criteria.ts`), and the `Finding` shape carrying
`criterion`/`severity`/`file` (`schema.ts:26-35`).

## Findings

### F1 — The cost axis may not exist under the configured credential

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details · Phase 3 §3 · Phase 4 · brief "Prerequisites"
- **Detail**: The $10 ceiling, tier 3 of the decision rule, and the Phase 5 `maxBudgetUsd` re-tune
  all read `total_cost_usd`. The only credential configured anywhere in the repo is subscription
  OAuth — `packages/code-reviewer/.env` holds exactly one key (`CLAUDE_CODE_OAUTH_TOKEN`) and CI
  passes the same (`.github/workflows/ai-code-review.yml:38`); `index.ts:196` already hedges with
  `?? 0`. If cost reports `0` the ceiling silently does not exist and tier 3 ranks every cell
  identically. Separately, 48 sequential runs (12 on opus) against a subscription hit usage limits,
  and quota refusals scored as `errored` would make tier 2 measure the quota rather than the model.
- **Decision**: FIXED — user directed that the eval is for testing purposes, bounded by what the
  subscription allows, with cost explicitly not a concern. Applied a broader fix than either option:
  the dollar ceiling became a **run-count ceiling** (`--max-runs`, default 48), tier 3 became
  **turns then latency**, the list-price-normalization apparatus and the Sonnet introductory-pricing
  caveat were removed entirely, cost is retained as an indicative-only column, and a new
  `rate_limited` outcome was added to the scorer — recorded and reported, but excluded from tier 2
  and from every denominator.

### F2 — Phase 5 re-tunes the CI reviewer's guards from data the plan already says is unrepresentative

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 5 §1 and §2 (contradicting Phase 4 §1)
- **Detail**: Phase 4 states fixture per-run cost sits well below the README's $0.30–1.00 figure
  "measured against 3000-line real PRs"; Phase 5 then re-tunes `maxTurns` and `maxBudgetUsd` from
  those same runs. Both guards are tail-calibrated against real diffs — `maxTurns: 20` exists
  because a real run at `10` exhausted its turns before producing valid structured output, and
  `maxBudgetUsd: 2.00` is documented as "roughly 20-30x the current per-run cost — only fires on a
  runaway". Deriving a tail guard from a small-diff median could set `maxTurns` _below_ today's
  value and reintroduce the exact `error_max_structured_output_retries` failure it was raised to
  prevent.
- **Fix A ⭐ Recommended**: Narrow Phase 5 to `MODEL` and `effort` only.
  - Strength: Exactly what the sweep measures validly — relative quality across cells on identical inputs.
  - Tradeoff: Drops one stated end-state item; brief needs the same edit.
  - Confidence: HIGH — both guards' provenance is documented in the README.
  - Blind spot: None significant.
- **Fix B**: Add one real-diff calibration fixture pinned to a merged PR head.
  - Strength: Preserves full Phase 5 scope with a representative sample; PR heads confirmed reachable.
  - Tradeoff: 8 of the heaviest runs against a quota that may already bind; scores nothing.
  - Confidence: MEDIUM.
  - Blind spot: Whether one PR's turn count is a usable tail estimate.
- **Decision**: FIXED via Fix A. Phase 5 §1 now sets `MODEL` and `effort` only and states why both
  guards are left alone; §2 keeps the README's `maxTurns`, `maxBudgetUsd` and "Cost per review" text
  unchanged and adds an `effort` row; two new "What We're NOT Doing" entries; Desired End State,
  criterion 5.6, new criterion 5.7, and three brief rows updated to match.

### F3 — The decision rule can eliminate all four cells, leaving Phase 5 with nothing to apply

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 3 §4 (ranking) → Phase 4 §2 → Phase 5 §1
- **Detail**: Tier 1 eliminated "any cell that missed a violation or produced a false positive" — a
  binary gate over a stochastic measurement, with 10 violation runs and only 2 clean-control runs
  per cell. One flaky miss in 10, or one over-eager finding on the single clean fixture, eliminated
  a cell outright. The plan handled the all-eliminated case as a reporting concern, but Phase 5's
  contract assumes a winner exists — leaving no defined behavior after a multi-hour sweep. Compounding
  it: `criteria.ts:87` makes coverage risk-proportional, so a clean control introducing any new code
  path without a test is _legitimately_ failable under `test_discipline`, which the scorer would
  record as `false_positive`.
- **Decision**: FIXED via Fix A. Tier 1 is now a **rate**, not a gate: cells rank on catch rate and
  false-positive rate, eliminated only if catch rate falls more than one fixture-run below the best
  cell's. Every rate prints with its denominator. A post-tier-3 tie names the tie and recommends the
  incumbent. Phase 2's corpus section gained an explicit note that the clean control must introduce
  no new risk-bearing path (copy, comment, or type-level edit only).

### F4 — The plan's own harness-validation check is never built

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Desired End State "Verification" vs. Phases 2–4
- **Detail**: Two named verifications had no backing phase, criterion, or Progress row — the
  mis-seeded negative control, and "re-running `npm run eval` reproduces the matrix shape". The
  negative control is the only thing distinguishing "the models missed it" from "the scorer never
  returns `caught`".
- **Decision**: FIXED. New Phase 3 automated criterion 3.5 replays a stored JSONL run through
  `scoreRun()` with `expect.criterion` pointed at a different id and asserts `missed` — costs
  nothing, no model call. Phase 3 Progress renumbered (3.5 inserted, manual rows → 3.7–3.9). The
  re-run-reproducibility claim was dropped from Desired End State with a stated reason rather than
  left as an unbacked promise.

### F5 — The `runReview()` contract drops two behaviors Phase 1 requires `main()` to preserve

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 (Contract) vs. Phase 1 §2 (Contract)
- **Detail**: §1's options list had no callback, yet §2 required `main()` to preserve the console
  streaming (`index.ts:175-183`, inside the loop §1 relocates) and the empty-changeset early return
  (`index.ts:116-119`, depending on `getChangedFiles()`, which §1 gives to the runner). `ReviewRun`
  had no member for "no changes, nothing dispatched".
- **Decision**: FIXED. Added optional `onMessage(message)` to the options — `main()` passes the
  existing logging closure, the eval passes nothing (48 runs of full assistant text is unreadable) —
  and `changedFileCount: number` to `ReviewRun`, where `0` means no dispatch with `resultSubtype`
  `no_changes`. §2's contract now names both mechanisms explicitly.

### F6 — Finding-file matching has no path normalization

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 (scorer) · Phase 2 §1 (`expect.files`)
- **Detail**: `caught` required a `BLOCKING` finding whose `file` matches one of `expect.files`
  (repo-relative POSIX), but nothing constrains the form the model emits — `prompt.ts:78` describes
  `file` only as "the location you verified the finding against", while the Read tool takes
  _absolute_ paths, which under the eval point into an OS temp worktree on a Windows host. A form
  mismatch is silent and uniform: every cell scores `missed` and the report reads as "every model is
  bad" rather than "the scorer is broken".
- **Decision**: FIXED. The scorer now matches on a normalized path **suffix** — separators to `/`,
  worktree prefix stripped — never string equality, with the failure mode written into the contract
  so the implementer knows why. `prompt.ts` is left untouched, per the plan's decision to hold the
  shipping prompt fixed.

### F7 — The ceiling stops mid-cell, producing a state the report and decision rule don't handle

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 vs. Phase 4 criterion 4.4 and the ranking section
- **Detail**: The guard checked before each _run_. Opus is last and heaviest, so a realistic stop
  lands partway through its 12 runs — and a cell with 5 of 12 is neither "ran" nor "not run", the
  binary framing criterion 4.4 and the per-cell denominators both assume.
- **Decision**: FIXED. The ceiling now checks whether the _whole next cell_ fits before starting it,
  so ceiling stops always land on a cell boundary. Quota stops cannot be aligned that way, which the
  plan now says explicitly — partial cells are labeled partial and ranked on their real denominators
  (paired with F3's denominator-printing rule). Criterion 4.4 rewritten to a three-way state:
  complete, not-run, or explicitly partial.

### F8 — Repeat aggregation across the 2 runs per fixture is unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §4 ("catch count (of 5)")
- **Detail**: `scoreRun()` is per-run and each cell produces 10 violation runs, but the report
  promised a per-fixture "of 5" column without saying how a fixture caught once and missed once
  resolves — leaving tier 1's strictness to be decided by accident.
- **Decision**: FIXED. The report now carries two correctness columns: the raw per-run tally
  (`x/10`, `y/2`) that tier 1 ranks on, and a strict per-fixture count (`of 5`) where a fixture
  counts as caught only if **both** runs caught it. The gap between the columns is the cell's
  flakiness made visible.

## Triage summary

- **Fixed**: F1 (broader fix per user direction), F2 (Fix A), F3 (Fix A), F4, F5, F6, F7, F8 — 8
- **Skipped / Accepted / Dismissed**: none

Post-fix Progress↔Phase contract re-verified: automated 4/3/6/3/4, manual 3/3/3/4/5 — 38 criteria
bullets, 38 Progress rows, no stray checkboxes outside the Progress section.
