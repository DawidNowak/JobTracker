---
change_id: promptfoo-eval
title: Promptfoo eval
status: implemented
created: 2026-08-15
updated: 2026-08-16
archived_at: null
---

## Notes

**Raw evidence behind `frame.md`'s saturation finding (derived 2026-08-15).** Full
per-fixture outcome breakdown of all 48 records in
`packages/code-reviewer/eval-results/runs.jsonl`, kept here so it does not have to
be re-derived:

```
=== haiku-high
   clean-control             clean_pass, clean_pass
   lib-purity-break          caught, caught
   rls-using-true            caught, errored
   route-missing-prerender   caught, caught
   service-layer-assert      caught, errored
   swallowed-await           caught, caught
=== sonnet-high
   clean-control             clean_pass, clean_pass
   lib-purity-break          caught, caught
   rls-using-true            caught, errored
   route-missing-prerender   caught, caught
   service-layer-assert      caught, caught
   swallowed-await           caught, caught
=== sonnet-xhigh / opus-high
   (all six fixtures, both runs: caught / clean_pass — no exceptions)

totals: { caught: 37, clean_pass: 8, errored: 3 }
        missed: 0, misattributed: 0, false_positive: 0, rate_limited: 0
```

All three `errored` runs were `resultSubtype: "success"` with a consistency
violation — **not** SDK failures:

| Cell          | Fixture                   | Violation                                                     |
| ------------- | ------------------------- | ------------------------------------------------------------- |
| `haiku-high`  | `rls-using-true` #1       | `correctness` is FAIL but has no BLOCKING finding             |
| `haiku-high`  | `service-layer-assert` #1 | `architecture_boundaries` is FAIL but has no BLOCKING finding |
| `sonnet-high` | `rls-using-true` #1       | `test_discipline` is FAIL but has no BLOCKING finding         |

Note that in all three the over-`FAIL`ed criterion is _not_ the one the fixture
planted — the model found the real defect and additionally over-flagged an
unrelated criterion. This contradicts `context/changes/model-eval/results.md:22`,
which characterises `haiku-high`'s 8/10 as a "systematic gap" in _catching_.

Reproduce with:

```bash
node -e "const fs=require('fs');const l=fs.readFileSync('eval-results/runs.jsonl','utf8').trim().split('\n').map(JSON.parse);const t={};for(const r of l)t[r.outcome]=(t[r.outcome]||0)+1;console.log(t)"
```

(run from `packages/code-reviewer/`)
