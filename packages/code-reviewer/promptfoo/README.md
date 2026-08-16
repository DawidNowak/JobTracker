# Promptfoo prompt-eval rig

A self-contained evaluation rig for tuning `REVIEWER_APPEND`'s FAIL⇔BLOCKING consistency rule
(`../src/prompt.ts:85-90`). It is **not wired into the review flow**: no CI job references this
config, `.github/workflows/ai-code-review.yml` is untouched, and the production review path
behaves identically whether this rig exists or not. It is run by hand.

## How to run it

From `packages/code-reviewer/`:

```bash
npm run eval:prompt                      # full grid: 4 prompts × every test in promptfooconfig.yaml
npm run eval:prompt -- --repeat 2        # repeat each cell twice (Phase 4's sweep)
npx promptfoo view                       # open the results UI for the most recent run
```

To run a single prompt variant against a single fixture (a smoke test):

```bash
npm run eval:prompt -- --filter-prompts incumbent --filter-first-n 1
```

`--filter-prompts <name>` selects one of `incumbent` / `restated` / `workedExample` / `checklist`
(the export names in `variants/index.ts`). `--filter-first-n <N>` caps how many `tests:` entries
run. Both flags are plain promptfoo CLI options — see `npx promptfoo eval --help`.

## How it fits together

Promptfoo owns the **grid and the reporting**; `../src/eval/` owns **worktrees, fixtures, and
scoring**:

- `provider.ts` — a custom `ApiProvider`. For each `(prompt, fixtureId)` cell it materializes the
  fixture in a throwaway git worktree (`../src/eval/worktree.ts`) and calls the real
  `runReview()` (`../src/index.ts`) with `reviewerAppend` set to the prompt variant under test —
  the same production code path a real PR review runs, not a reimplementation of it.
- `variants/index.ts` — the four prompt variants. Each is built by substituting only the
  consistency-rule paragraph into the live `REVIEWER_APPEND` text, so the surrounding prompt is
  sourced from production rather than copied, and a future edit anywhere else in the prompt can't
  silently turn this into a multi-axis sweep.
- `grade-assert.ts` — four named-metric assertions (`composite`, `recall`, `precision`,
  `validity`), each a thin wrapper around `../src/eval/grade.ts`'s `gradeRun()`.
- `promptfooconfig.yaml` — wires the above together: `prompts:` (the four variants), `providers:`
  (the one custom provider), `defaultTest.assert:` (the four metrics), `tests:` (one entry per
  fixture, `vars: { fixtureId }`).

## Scoring formula

Per run, `gradeRun()` computes:

- **`valid`** — `output !== null`, `resultSubtype === "success"`, and no consistency violation.
  An invalid run scores `0` on every metric — mirroring production, where an inconsistent review
  is discarded outright rather than partially trusted.
- **`caught`** — a planted defect counts caught iff some `BLOCKING` finding cites its criterion
  **and** matches its file.
- **`falsePositives`** — any `BLOCKING` finding on a file carrying no planted defect. Declared
  decoys (`decoyHits`) are the deliberately tempting subset of that count, reported separately —
  penalizing only declared decoys would let a variant spray `BLOCKING` findings across ordinary
  files for free.
- **`composite score`** = `valid ? max(0, (caught − falsePositives) / planted) : 0`. The penalty
  weight is 1: one wrongly-blocked PR costs exactly one missed defect.
- **`recall`** = `caught / planted` (a fixture with nothing planted scores 1 trivially).
- **`precision`** = `caught / (caught + falsePositives)` (no `BLOCKING` findings at all scores 1).

## Fixture-authoring rule

**One planted item per file** — every defect and every decoy lives in its own distinct file. This
is what lets `matchesExpectedFile`'s existing file-suffix match (`../src/eval/score.ts`) stay
sufficient; line-range matching against a model's approximate line numbers would be a
ground-truth stability problem this rule designs out entirely. `loadFixtures()` and `eval:check`
enforce it mechanically — see `../src/eval/fixtures.ts` and `../src/eval/check.ts`.

## Rate-limited runs

Promptfoo has no concept of excluding a run from scoring — `EvaluateStats` tracks
`successes`/`failures`/`errors` separately, but an error still counts against the run. When the
provider's call to `runReview()` throws and the error text looks like a subscription usage-limit
rejection, `provider.ts` returns `{ error: "rate_limited: …" }` so the run lands in promptfoo's
`errors` bucket and stays visible — but it is **not** automatically excluded from any table or
average. When reading a report, treat any `error` starting with `rate_limited:` as excluded by
hand from every denominator, the same way `../src/eval/run.ts`'s model sweep does natively.

## What this rig is not

- Not part of CI. No workflow references it; the required `npm test` check never runs it.
- Not a regression gate. It does not gate merges, and a bad sweep result does not block anything
  automatically — a human reads `context/changes/promptfoo-eval/results.md` and decides.
- Not an LLM-as-judge. `gradeRun()` is a pure, deterministic, model-call-free function of the
  fixture's declared ground truth and the run's structured output.
