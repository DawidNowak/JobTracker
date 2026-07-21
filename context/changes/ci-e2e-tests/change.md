---
change_id: ci-e2e-tests
title: Ci e2e tests
status: impl_reviewed
created: 2026-07-21
updated: 2026-07-21
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

### Phase 3 stability verification — 2026-07-21

`e2e` job on PR #22 (https://github.com/DawidNowak/JobTracker/pull/22), run [29824254337](https://github.com/DawidNowak/JobTracker/actions/runs/29824254337) (post-Phase-2-docs push), re-run 3x via `gh run rerun --job`:

| #   | Trigger        | Conclusion | Wall-clock |
| --- | -------------- | ---------- | ---------- |
| 1   | push (4a88eae) | success    | 3m34s      |
| 2   | rerun          | success    | 4m26s      |
| 3   | rerun          | success    | 4m10s      |
| 4   | rerun          | success    | 3m44s      |

4/4 green, no flakes, no timeout-related failures observed — no need to invoke the `workers` cap stabilizer from the plan's Phase 3 contract. Combined with Phase 1's initial green run and its deliberate-break red/revert cycle, the `e2e` job has now been observed green 5 times total on ubuntu across two separate pushes. Chromium install step consistently fast (~12-20s) on every run, confirming the cache hit.

### Phase 3 promotion + merge-block proof — 2026-07-21

- `e2e` added to `master`'s required status checks via `gh api PATCH .../branches/master/protection/required_status_checks` (now `["ci","test","e2e"]`, `strict: true`).
- Merge-block proof: pushed a temporary deliberate break to `tests/e2e/board-load.spec.ts` (commit `0d2fa34`) → run [29826805765](https://github.com/DawidNowak/JobTracker/actions/runs/29826805765): `e2e` FAILURE, `ci`/`test` SUCCESS → `gh pr view 22` showed `mergeStateStatus: "BLOCKED"` (still `mergeable: "MERGEABLE"`, i.e. blocked specifically by the required check, not a conflict). Reverted (commit `52ae31e`) → run [29827740941](https://github.com/DawidNowak/JobTracker/actions/runs/29827740941) SUCCESS → `mergeStateStatus` back to `CLEAN`.
