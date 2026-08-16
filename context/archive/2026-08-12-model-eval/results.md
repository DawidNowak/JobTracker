# Model eval — results matrix

Generated 2026-08-14T10:23:08.243Z. 48 run(s) read from `packages/code-reviewer/eval-results/runs.jsonl`. Cost is indicative only — the sweep runs on subscription auth.

| Cell                                           | Status   | Violation caught (per-run) | Clean passed (per-run) | Violation caught (per-fixture) | Errored | Rate-limited | Median turns | Median duration | Cost (indicative)                  |
| ---------------------------------------------- | -------- | -------------------------- | ---------------------- | ------------------------------ | ------- | ------------ | ------------ | --------------- | ---------------------------------- |
| claude-haiku-4-5 @ high (effort not supported) | complete | 8/10                       | 2/2                    | 3/5                            | 2       | 0            | 14           | 107s            | $0.1097 (min $0.0584, max $0.1919) |
| claude-sonnet-5 @ high                         | complete | 9/10                       | 2/2                    | 4/5                            | 1       | 0            | 11           | 71s             | $0.2656 (min $0.1009, max $0.6069) |
| claude-sonnet-5 @ xhigh                        | complete | 10/10                      | 2/2                    | 5/5                            | 0       | 0            | 14           | 118s            | $0.3887 (min $0.1253, max $0.6981) |
| claude-opus-5 @ high                           | complete | 10/10                      | 2/2                    | 5/5                            | 0       | 0            | 12.5         | 97s             | $0.3167 (min $0.1253, max $0.4817) |

## Ranking

**Tier 3 (efficiency) decided the ranking.**

1. `opus-high` — 10/10 caught
2. `sonnet-xhigh` — 10/10 caught
3. `sonnet-high` — 9/10 caught

**Eliminated:**

- `haiku-high`: caught 8/10 violation runs, 2 fewer than the best cell's 10 — a systematic gap, not a single flaky miss.

## Decision

**Automated rule winner: `claude-opus-5 @ high` (cell `opus-high`).**

Tier 1 (correctness) ties `opus-high` and `sonnet-xhigh` at 10/10 violation runs caught (5/5 fixtures caught on both repeats) — the best catch rate in the matrix. Tier 2 (reliability) leaves them tied again: 0 errored runs each. Tier 3 (efficiency) breaks the tie: `opus-high`'s median turns (12.5) and median duration (97s) both beat `sonnet-xhigh`'s (14 turns, 118s). The incumbent, `claude-sonnet-5 @ high`, is not eliminated (its 9/10 catch rate is only one run behind the best, inside the one-fixture-run elimination margin) but ranks third — both higher-effort cells caught strictly more violation runs.

`claude-haiku-4-5 @ high` is eliminated at Tier 1: it caught 8/10 violation runs, a 2-run gap behind the best cell, which exceeds the one-run margin that separates a systematic gap from a single flaky miss. Its cell is also labeled effort-not-supported — the SDK silently downgrades `effort` for this model, so this was never a true `@ high` comparison to begin with.

The sweep ran to full completion: all 4 cells × 6 fixtures × 2 runs = 48/48, with no cell partially run. The subscription's usage limit was hit twice mid-sweep (`sonnet-high` × `swallowed-await`, and again partway through `opus-high`); both stops were correctly detected as `rate_limited` and excluded from every denominator, then resumed by re-running only the affected fixtures once the limit reset. No cell's reliability count includes a quota rejection — the fix that made this possible is noted below.

### Final decision (shipped): `claude-sonnet-5 @ high` — incumbent, human override

The cell that ships is **not** the automated rule's winner. This is a deliberate human override, made after reviewing the matrix, for reasons the decision rule doesn't weigh:

- **The `$` cost column is not a real cost differentiator here.** The sweep runs on `CLAUDE_CODE_OAUTH_TOKEN` — flat subscription billing — so every cell costs the same to the user regardless of model. `total_cost_usd` is a notional per-run figure (Caveat 3), not a billed amount, and the decision rule deliberately excludes it from every tier for exactly this reason.
- **What actually varies between cells is usage-quota consumption**, which tracks turns and wall-clock latency, not the `$` column. On that measure `sonnet-high` is the strongest cell in the matrix, not `opus-high` or `haiku-high`: median duration 71s and median turns 11, both the best of the four cells (`opus-high`: 97s/12.5 turns; `haiku-high`: 107s/14 turns; `sonnet-xhigh`: 118s/14 turns).
- **`sonnet-high`'s correctness gap is small and inside the rule's own noise margin.** It caught 9/10 violation runs — one fewer than the two leaders, the same one-run margin the decision rule itself treats as "a single flaky miss," not a systematic gap (the same margin that spared it from Tier-1 elimination). This is a materially different gap than `haiku-high`'s 2-run, actually-systematic miss.
- **It is the incumbent.** No config change ships as a result of this eval — `src/index.ts`'s `MODEL` and `effort` constants stay exactly as they are today (Phase 5 §1 applies as written: "If the winner is the incumbent at its current settings, this file does not change at all").

This override is recorded here rather than silently substituted for the automated result so that a future re-run of this eval — after a new model ships — starts from what the decision rule actually computed, not from this run's practical choice.

## Caveats

1. **Seeded fixtures are easier than real defects.** Each violation fixture plants exactly one rule break in an otherwise-plausible diff, with no competing signal and no ambiguity about which file to look at. A real PR mixes intentional changes with incidental ones and often has several files that could plausibly carry a defect. The catch rates above are an upper bound on real-world recall, not an estimate of it.
2. **Measured recall is partly a property of the scoring rule, not solely of the model.** A run only counts as `caught` if the expected criterion returns `FAIL` with at least one `BLOCKING`/`CERTAIN`-tier finding on the expected file (`prompt.ts`'s evidence rule, `score.ts`'s `hasBlockingFindingOnExpectedFile`). A model that flags the right file at lower confidence scores the same as a model that misses it entirely. The eval measures the pipeline's end-to-end behavior (model + prompt + evidence rule together), not model recall in isolation.
3. **The sweep ran on subscription auth — the cost column is indicative only, and this eval is not a cost measurement.** `total_cost_usd` may report a notional figure rather than a billed amount. The decision rule's tiers are correctness, reliability, and turns/latency — cost is recorded and shown per cell but never used to break a tie.

## Run notes

- **Date:** 2026-08-14
- **Package version:** `@jobtracker/code-reviewer@0.0.1`, at commit `7bdfdb5` (plus two fixes landed during this sweep, see below)
- **Two bugs were found and fixed mid-sweep**, both discovered because the subscription's usage limit was hit twice during the real run:
  - `classifyThrownError()` in `src/eval/run.ts` only recognized API-style rate-limit phrasing (`rate limit`, `quota`, `429`, …). The actual rejection text — `"You've hit your limit · resets <time>"` — matched none of those patterns, so every run after the first quota exhaustion was misclassified `error_during_execution` (a model-side failure) instead of `rate_limited`. This would have penalized `opus-high`, the last and heaviest cell, for running out of quota rather than for anything the model did — exactly the failure mode the plan's Critical Implementation Details section calls out. Fixed by broadening the regex; verified correct on the second quota hit (3 runs correctly labeled `rate_limited`, excluded from every denominator, sweep resumed cleanly).
  - `rankCells()` in `src/eval/report.ts` only ran Tier 2/Tier 3 tie-breaking when _every_ surviving cell shared the same catch rate. With three survivors (`sonnet-high` 9/10, `sonnet-xhigh` 10/10, `opus-high` 10/10), the two leaders' genuine tie was never broken by tier 2/3 — the report picked a winner by array declaration order instead, silently. Rewritten as a single lexicographic sort (catch rate, then errored count, then turns, then latency) so a leader-only tie is disambiguated correctly, matching the plan's stated "lexicographic" decision rule.
  - The corrupted records from the first bug (26 runs mislabeled `error_during_execution`, plus 6 stale leftover records from earlier manual testing) were removed from `eval-results/runs.jsonl` before resuming, so no misclassified run is counted in the matrix above.
