# Promptfoo prompt eval — results matrix

Generated 2026-08-16T06:37:34.000Z. 24 canonical run(s) (4 variants × 3 fixtures × 2 repeats),
drawn from **9 separate `promptfoo eval` invocations** run across three subscription-quota windows
(2026-08-15 11:25, 15:58, 21:09, and 2026-08-16 06:03–06:22) because a single sweep does not fit
in one quota window. `npx promptfoo view` shows each invocation's own grid; there is no single
grid spanning all 24 — this file is the merge.

## Per-variant summary (n=6 each: 3 fixtures × 2 repeats)

| Variant         | Mean composite | Mean recall | Mean precision | Validity rate | Decoy hits (total/24) | Misattributed (total) | False positives (total) |
| --------------- | -------------- | ----------- | -------------- | ------------- | --------------------- | --------------------- | ----------------------- |
| `workedExample` | **0.6389**     | 0.7361      | 0.8833         | 1.000         | 1                     | 1                     | 2                       |
| `checklist`     | 0.5528         | 0.7167      | 0.8472         | 1.000         | 1                     | 4                     | 4                       |
| `incumbent`     | 0.5417         | 0.6944      | 0.7917         | 1.000         | 3                     | 3                     | 3                       |
| `restated`      | 0.5361         | 0.6944      | 0.8639         | 1.000         | 0                     | 3                     | 4                       |

Every one of the 24 canonical runs was `valid` — zero consistency violations, zero null outputs,
across all four variants. The signal this sweep was built to measure (FAIL⇔BLOCKING consistency)
did not fire even once in this corpus, so the ranking below is decided entirely by recall/precision
on the multi-issue fixtures, not by the validity axis the rig was originally built to discriminate.

## Per-fixture breakdown (mean composite, n=2 each)

| Fixture                    | `incumbent` | `restated` | `workedExample` | `checklist` |
| -------------------------- | ----------- | ---------- | --------------- | ----------- |
| `multi-board-filters`      | 1.000       | 0.900      | **1.000**       | 0.700       |
| `multi-followup-reminders` | 0.625       | 0.375      | **0.750**       | 0.625       |
| `multi-scraper-parser`     | 0.000       | **0.333**  | 0.167           | **0.333**   |

`workedExample` leads or ties on 2 of 3 fixtures but is the **second-worst** performer on
`multi-scraper-parser`, the hardest fixture in the corpus (every variant scored ≤0.33 there). The
overall ranking is not uniform across fixtures — see Caveats.

## Ranking

**Rule applied: mean composite, tied on validity rate, then mean recall** (all four variants tie
on validity rate at 1.000, so recall is the effective tiebreaker — moot here since composite alone
separates them).

1. `workedExample` — composite 0.6389, recall 0.7361, precision 0.8833
2. `checklist` — composite 0.5528, recall 0.7167, precision 0.8472
3. `incumbent` — composite 0.5417, recall 0.6944, precision 0.7917
4. `restated` — composite 0.5361, recall 0.6944, precision 0.8639

By this rule, `workedExample` ranks first, ~0.086–0.103 ahead of the other three, which are
themselves bunched within 0.017 of each other.

## Full raw grid (24 canonical runs)

| Fixture                  | Variant       | Composite | Recall | Precision | Validity | Assertion | Source (eval ID)                           |
| ------------------------ | ------------- | --------- | ------ | --------- | -------- | --------- | ------------------------------------------ |
| multi-board-filters      | incumbent     | 1.00      | 1.00   | 1.00      | 1        | PASS      | log1 (eval-1u7-2026-08-15T11:25:47)        |
| multi-board-filters      | incumbent     | 1.00      | 1.00   | 1.00      | 1        | PASS      | log1 (eval-1u7-2026-08-15T11:25:47)        |
| multi-board-filters      | restated      | 0.80      | 1.00   | 0.83      | 1        | PASS      | log1 (eval-1u7-2026-08-15T11:25:47)        |
| multi-board-filters      | restated      | 1.00      | 1.00   | 1.00      | 1        | PASS      | log1 (eval-1u7-2026-08-15T11:25:47)        |
| multi-board-filters      | workedExample | 1.00      | 1.00   | 1.00      | 1        | PASS      | log1 (eval-1u7-2026-08-15T11:25:47)        |
| multi-board-filters      | workedExample | 1.00      | 1.00   | 1.00      | 1        | PASS      | log1 (eval-1u7-2026-08-15T11:25:47)        |
| multi-board-filters      | checklist     | 0.40      | 0.80   | 0.67      | 1        | PASS      | log1 (eval-1u7-2026-08-15T11:25:47)        |
| multi-board-filters      | checklist     | 1.00      | 1.00   | 1.00      | 1        | PASS      | log1 (eval-1u7-2026-08-15T11:25:47)        |
| multi-followup-reminders | incumbent     | 0.50      | 0.75   | 0.75      | 1        | PASS      | log2 (eval-j5Z-2026-08-15T15:58:08)        |
| multi-followup-reminders | incumbent     | 0.75      | 0.75   | 1.00      | 1        | PASS      | log3 (eval-CeF-2026-08-15T21:09:06)        |
| multi-followup-reminders | restated      | 0.50      | 0.75   | 0.75      | 1        | PASS      | log2 (eval-j5Z-2026-08-15T15:58:08)        |
| multi-followup-reminders | restated      | 0.25      | 0.75   | 0.60      | 1        | PASS      | log3 (eval-CeF-2026-08-15T21:09:06)        |
| multi-followup-reminders | workedExample | 0.75      | 0.75   | 1.00      | 1        | PASS      | log3 (eval-CeF-2026-08-15T21:09:06)        |
| multi-followup-reminders | workedExample | 0.75      | 1.00   | 0.80      | 1        | PASS      | retry: followup × workedExample (eval-fSU) |
| multi-followup-reminders | checklist     | 0.50      | 0.75   | 0.75      | 1        | PASS      | log3 (eval-CeF-2026-08-15T21:09:06)        |
| multi-followup-reminders | checklist     | 0.75      | 0.75   | 1.00      | 1        | PASS      | retry: followup × checklist (eval-EzY)     |
| multi-scraper-parser     | incumbent     | 0.00      | 0.33   | 0.50      | 1        | **FAIL**  | retry: scraper × incumbent (eval-kDF)      |
| multi-scraper-parser     | incumbent     | 0.00      | 0.33   | 0.50      | 1        | **FAIL**  | retry: scraper × incumbent (eval-kDF)      |
| multi-scraper-parser     | restated      | 0.33      | 0.33   | 1.00      | 1        | PASS      | retry: scraper × restated (eval-hz0)       |
| multi-scraper-parser     | restated      | 0.33      | 0.33   | 1.00      | 1        | PASS      | retry: scraper × restated (eval-hz0)       |
| multi-scraper-parser     | workedExample | 0.00      | 0.33   | 0.50      | 1        | **FAIL**  | retry: scraper × workedExample (eval-3Ce)  |
| multi-scraper-parser     | workedExample | 0.33      | 0.33   | 1.00      | 1        | PASS      | retry: scraper × workedExample (eval-3Ce)  |
| multi-scraper-parser     | checklist     | 0.33      | 0.33   | 1.00      | 1        | PASS      | retry: scraper × checklist (eval-L9N)      |
| multi-scraper-parser     | checklist     | 0.33      | 0.67   | 0.67      | 1        | PASS      | retry: scraper × checklist (eval-L9N)      |

`[FAIL]` in the assertion column means the run's composite score fell below promptfoo's pass
threshold, not that the run errored — all four `multi-scraper-parser` cells produced valid,
scored output (real turns, real cost); the model simply caught fewer of the three planted defects
there than on the other two fixtures.

## Excluded runs

- **42 `rate_limited` runs**, excluded from every denominator above. The sweep needed 3 full-grid
  attempts (`npm run eval:prompt -- --repeat 2`, each hitting the Claude Code subscription's
  5-hour usage window mid-run) plus 6 targeted single-cell retries to collect the missing runs
  without re-spending quota on cells already complete. Every excluded run returned
  `"You've hit your limit · resets <time> (Europe/Warsaw)"` — verified by hand, not inferred.
- **16 duplicate valid `multi-board-filters` runs**, excluded as over-collection. Because each
  full-grid re-attempt reruns all 24 cells from scratch (promptfoo has no cross-invocation resume
  for a fresh `eval` command), `multi-board-filters` — the fixture that happened to complete first
  every time before the quota ran out — accumulated 6 valid runs per variant across the 3
  full-grid attempts instead of the needed 2. The first 2 chronologically (all from the very first
  attempt, log1) are used as the canonical pair per variant; the other 4 per variant are recorded
  in `packages/code-reviewer/promptfoo/` run history but not used in any mean above, so
  `multi-board-filters` is not overweighted relative to the other two fixtures.

## Caveats

1. **No regression floor was run.** Per the plan's "What We're NOT Doing," this sweep does not
   gate against the original six single-defect/clean fixtures — it only ranks the four variants
   against each other on the three multi-issue fixtures.
2. **The sample is 6 runs per variant.** This is the number the plan specified (3 fixtures × 2
   repeats), but it is small enough that a single unlucky run visibly moves a variant's mean by
   ~0.15–0.2 (see `multi-board-filters` × `checklist`: 0.40 then 1.00 on the two repeats).
3. **The leader's margin is modest relative to within-variant noise.** `workedExample`'s composite
   (0.6389) leads the pack by 0.086–0.103, but the other three variants are bunched within 0.017 of
   each other, and every variant's per-run composite ranges from 0.00 to 1.00 depending almost
   entirely on which fixture it ran against (see the per-fixture table above — fixture identity
   explains far more of the variance than variant identity does). This is not a flat grid — there
   is a consistent leader across fixtures — but the margin is narrow enough that Phase 4's manual
   check ("is the grid flat, or genuinely separated?") needs a human read before this is treated as
   a settled result.
4. **The winner is fixture-dependent.** `workedExample` wins or ties on `multi-board-filters` and
   `multi-followup-reminders` but is second-worst (0.167) on `multi-scraper-parser`, where
   `restated` and `checklist` (tied at 0.333) do best and `incumbent` does worst (0.000).
   `multi-scraper-parser` is also the fixture every variant struggled with most — worth reading the
   raw findings on those 8 runs before trusting the aggregate.
5. **Zero consistency violations across all 24 runs.** The FAIL⇔BLOCKING axis this rig exists to
   tune never fired in this corpus, on any variant. The ranking above is entirely a recall/precision
   result, not a validity result — worth weighing when deciding whether this sweep's design question
   (which consistency-rule wording is best) was actually exercised by this corpus.

## Spot-check notes (informational — not a substitute for your own review)

Two runs read in full against their fixture's ground truth, ahead of the plan's manual
spot-check requirement:

1. **`multi-scraper-parser` × `incumbent`, run 1 (composite 0.00, caught 1/3).** The model correctly
   filed a `BLOCKING` finding on `src/pages/api/applications/parse-status.ts` for the
   `SUPABASE_URL`/`SUPABASE_KEY` leak (the `security_and_data_isolation` defect — caught). It also
   filed a `BLOCKING` finding under `test_discipline` on
   `supabase/migrations/20260815094500_parse_failures_table.sql` for "no integration test verifies
   `parse_failures` RLS isolation" — a real, defensible gap, but on the file the fixture declared as
   a decoy (`parse-failures-rls-correct`, whose innocence note only covers policy _correctness_, not
   test _coverage_). Scored as 1 false positive on a declared decoy — mechanically correct per the
   scoring rule, but a human reading the finding itself would likely call it legitimate criticism
   the fixture didn't anticipate, not a hallucination.
2. **`multi-scraper-parser` × `workedExample`, the composite-0.00 run.** The model filed a `BLOCKING`
   finding under `test_discipline` on `vitest.config.ts` — correctly describing the real planted
   defect (`pracuj-corrupted.test.ts` missing from the workers pool's `include` array) — but cited
   the config file rather than the test file itself
   (`tests/unit/parsers/pracuj-corrupted.test.ts`, the fixture's declared defect file). The strict
   file-suffix match (`matchesExpectedFile`) does not credit this as `caught`, and instead counts it
   as a false positive on an unplanted file, which is why this run's composite lands at exactly 0.00
   despite the model substantively identifying the correct issue.

Both cases point the same direction: the mechanical file-matching scorer is **stricter than a human
reader would be** when a model correctly diagnoses a defect but cites an adjacent file (the fix
location, or a decoy that turns out to have a real-but-different problem) rather than the fixture's
exact declared file. This doesn't necessarily change the ranking — `multi-scraper-parser` is hard
for every variant — but it means the recall/composite numbers on this fixture are a **lower bound**
on real defect-detection quality, not a precise measurement. Worth weighing before treating
`workedExample`'s weak `multi-scraper-parser` showing as a genuine finding gap rather than partly a
file-attribution artifact.

## Pending: human approval

Per the plan's Phase 4 manual verification, a human must review this grid, spot-check at least two
runs' raw output against their grades, and explicitly approve a winner before Phase 5 applies
anything. No decision is recorded here yet.
