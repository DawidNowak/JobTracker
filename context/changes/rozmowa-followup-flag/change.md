---
change_id: rozmowa-followup-flag
title: Rozmowa followup flag
status: impl_reviewed
created: 2026-07-14
updated: 2026-07-14
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

**Addendum (impl review, 2026-07-14, F1)**: Phase 3's commit (c88f002) bumped `playwright.config.ts`'s `retries` from `0` to `1` suite-wide. This wasn't in the plan. Rationale: several e2e specs (`decision-prompt.spec.ts`, `delete-application.spec.ts`, the new `followup-flag.spec.ts` siblings) already work around a `client:load` island hydration race with per-assertion `toPass()` retry loops — this is a known, pre-existing flake class, not a new hidden bug. The config bump is a belt-and-suspenders layer on top of that. Caveat: it isn't fully sufficient — a review rerun of the full suite reproduced `decision-prompt.spec.ts`'s "Aplikuj moves a stale card to Zaaplikowano" failing on both the original attempt and the retry under 6-worker parallelism, while it passed reliably with `--workers=1`. Root cause (dev-server contention under parallel workers) is unaddressed. E2E is not a CI gate (see AGENTS.md), so this is accepted as a partial mitigation rather than a blocking issue.

**Superseded (2026-07-14)**: The root cause noted above is now addressed. `KanbanBoard.tsx` exposes a deterministic `data-board-hydrated` signal (via `tests/helpers/hydration.ts`'s `waitForBoardHydration`), the Aplikuj test no longer retries a mutating click, and `playwright.config.ts`'s `retries` is back to `0` — see that file's comment for the reasoning. The actual defect this whole time was retrying a click behind `KanbanBoard.tsx`'s optimistic UI update, not just tight timeouts; retries were masking that, not fixing it.
