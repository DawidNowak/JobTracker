# Promptfoo prompt eval for the CI/CD code reviewer — Plan Brief

> Full plan: `context/changes/promptfoo-eval/plan.md`
> Frame brief: `context/changes/promptfoo-eval/frame.md`

## What & Why

The existing eval corpus has **zero measurement headroom on catch rate** — 40/40 violation runs
caught across every model cell — so a promptfoo eval scoring `REVIEWER_APPEND` variants on recall
would measure nothing. The only signal that has ever varied in 48 runs is output discipline: 3 runs
where the model marked a criterion `FAIL` without a `BLOCKING` finding, which discards the whole
review in CI. This change builds a promptfoo rig that scores **output validity and precision** on a
corpus with real ambiguity in it, and tunes the FAIL⇔BLOCKING rule against it.

## Starting Point

`packages/code-reviewer/src/eval/` is a working harness: fixture loading, worktree materialization
with signal-safe cleanup, a pure categorical scorer, a model-axis sweeper and a report generator.
Its limits are exactly the two the frame identified — `score.ts:64` collapses "consistency
violation", "null output" and "SDK error" into one `errored` bucket, and all six fixtures carry a
single planted defect in a 13–75 line diff, so every model cell scores 100%.

## Desired End State

`packages/code-reviewer/promptfoo/` holds a self-contained rig runnable at any time with
`npm run eval:prompt`, **not wired into the review flow** — no CI job, `ai-code-review.yml`
untouched, production behaving identically whether the rig exists or not. `REVIEWER_APPEND` carries
the winning variant's consistency-rule wording, and `results.md` records the sweep that chose it.

## Key Decisions Made

| Decision          | Choice                                                            | Why (1 sentence)                                                                                                                                                                            | Source       |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| What to measure   | Output validity + precision, not catch rate                       | Catch rate is saturated at 100%; a recall-scored grid would be flat.                                                                                                                        | Frame        |
| Which prompt      | `REVIEWER_APPEND`'s FAIL⇔BLOCKING rule (`prompt.ts:85-90`)        | It is the one thing the eval has ever measured varying.                                                                                                                                     | Frame        |
| Provider          | Custom TS provider wrapping `runReview()`                         | The built-in provider's `working_dir` is a provider-level constant, but the rig needs a distinct worktree per run; the custom path also keeps the `rate_limited` exclusion promptfoo lacks. | Plan         |
| Existing harness  | Keep the model sweep, extract a shared core                       | The model sweep answers a different question and already works; only `score.ts`/`fixtures.ts` need to grow.                                                                                 | Plan         |
| Durability        | Rig stays in the repo, decoupled from the flow                    | Future prompt experiments should not have to rebuild it; but it must never affect production reviews.                                                                                       | Plan         |
| Corpus            | 3 fixtures, 300–600 lines, 4–6 defects + 3–4 decoys               | Per-run range of 0–N is the source of headroom; decoys stop "flag everything" from being the winning strategy.                                                                              | Frame + Plan |
| Ground-truth rule | One planted item per file                                         | Makes `matchesExpectedFile`'s existing suffix match sufficient and designs out line-range instability.                                                                                      | Plan         |
| Scoring           | `valid ? max(0,(caught−falsePositives)/planted) : 0`              | Zeroing an invalid run mirrors production, where an inconsistent review is discarded outright.                                                                                              | Plan         |
| False positives   | Any `BLOCKING` on a non-defect file; decoys are a reported subset | Penalising only declared decoys would let a variant spray BLOCKINGs across ordinary files for free.                                                                                         | Plan         |
| Penalty weight    | 1                                                                 | One wrongly-blocked PR costs exactly one missed defect — no invented coefficient to defend.                                                                                                 | Plan         |
| Budget            | 24 runs (4 variants × 3 fixtures × 2 repeats)                     | Well inside the 48-run sweep already proven feasible, leaving headroom for a re-run.                                                                                                        | Plan         |
| Regression floor  | **Cut** — no gate                                                 | This is a first step, not a production-ready result; 24 runs decide the winner.                                                                                                             | Plan         |

## Scope

**In scope:** splitting `score.ts`'s `errored` bucket · an additive multi-defect fixture shape · a
pure graded scorer (`grade.ts`) · a replay check against the existing 48 records · a
`reviewerAppend` seam in `index.ts` · the promptfoo config, custom provider, graded assertions and
four prompt variants · three hand-authored multi-issue fixtures · a 24-run sweep and writeup ·
landing the winning wording.

**Out of scope:** any CI integration · a regression gate against the existing six fixtures ·
changes to `criteria.ts` · replacing the model sweep · exercising the `truncateDiff` cap ·
line-range defect matching · LLM-as-judge assertions.

## Architecture / Approach

Promptfoo owns the **grid and reporting**; the existing harness owns **worktrees, fixtures and
scoring**. The custom provider is the seam:

```
promptfooconfig.yaml
  prompts:   4 REVIEWER_APPEND variants  ──┐
  tests:     3 fixtures (vars.fixtureId) ──┤
  provider:  file://./provider.ts          │
                    │                      │
                    ▼                      │
        withFixtureWorktree(fixture) ◄─────┘   (existing, unchanged)
                    │
                    ▼
        runReview({ reviewerAppend: prompt })   (production path, + one new option)
                    │
                    ▼
        grade-assert.ts → gradeRun()            (pure, replayable)
                    │
                    ▼
        named metrics: composite · recall · precision · validity
```

`gradeRun()` is a **superset** of the existing scorer — it handles the new `multi` shape and also
degrades cleanly to `violation` and `clean`. That is what lets the rig be smoke-tested against an
existing single-defect fixture before any expensive fixture authoring.

## Phases at a Glance

| Phase                 | What it delivers                                                        | Key risk                                                                                         |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Shared eval core   | Split `errored` bucket, multi-defect shape, `grade.ts`, replay check    | Low — no model calls; verified against the 48 records already on disk                            |
| 2. Promptfoo rig      | `reviewerAppend` seam, provider, assertions, 4 variants, config, README | Provider frictions (per-test `working_dir`, no rate-limit exclusion) prove worse than documented |
| 3. Multi-issue corpus | 3 hand-authored fixtures with cited ground truth                        | Highest — a mis-specified defect or a decoy that is actually guilty poisons every later number   |
| 4. Sweep and decide   | 24 runs, ranking, `results.md`                                          | The grid comes back flat and no variant is separable from noise                                  |
| 5. Apply and document | Winning wording in `prompt.ts`, decoupling verified                     | Low — a no-op if the incumbent wins                                                              |

**Prerequisites:** working Claude subscription auth for `packages/code-reviewer` (`.env`);
`promptfoo@^0.122.0` addable as a devDependency; a clean `git worktree list`; the repo's own gates
(`npm run typecheck && npm run lint && npm test`) green before starting.

**Estimated effort:** ~4–5 sessions across 5 phases. Phase 3 (fixture authoring) is the bulk of the
human time; Phase 4 is the bulk of the quota.

## Open Risks & Assumptions

- **No regression floor.** Deliberately cut. The unguarded failure mode is a variant that wins on
  precision by making the model more conservative — downgrading borderline BLOCKINGs — while
  quietly losing the ability to catch a plain `USING (true)`. The six saturated fixtures were the
  only thing that would detect this; they remain in the repo but do not gate this decision.
- **6 runs per variant is a thin sample.** Consistency violations were a ~6% event on the old
  corpus, so validity may barely move at this run count. The design leans on the _continuous_
  composite score as the primary discriminator for exactly this reason, but if the new fixtures do
  not raise the violation rate, validity will be under-measured.
- **The grid may come back flat.** If it does, the correct outcome is to record that as the
  finding — the consistency violations are model-inherent, not prompt-driven — rather than picking
  a winner from noise. Phase 4's manual criteria say so explicitly.
- **Fixture ground truth is the weakest link.** Three hand-authored 300–600 line diffs with 4–6
  defects each is a lot of surface for one mis-specified expectation to hide in. Mitigated by the
  one-item-per-file rule, mandatory rule citations, and `eval:check` validation — but ultimately it
  rests on Phase 3's manual review.
- **Promptfoo cannot exclude a run from scoring.** Rate-limited runs land in its `errors` bucket
  and must be excluded by hand when reading the report.
- **Assumption:** the three new fixtures apply cleanly to current `master` HEAD and stay applicable
  as the repo moves. `eval:check` catches rot; re-pinning is a manual fix.

## Success Criteria (Summary)

- `npm run eval:prompt` produces a 24-run grid where the four variants are separated by more than
  run-to-run noise on at least one named metric — or the flatness is itself recorded as the finding
- `REVIEWER_APPEND` carries a consistency-rule wording chosen from measured evidence, with
  `results.md` making the choice auditable without re-running anything
- The review flow is provably untouched: `git diff master --stat -- .github/` is empty, and a real
  PR review still runs, comments and labels correctly
