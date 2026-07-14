# S-09 Rozmowa Follow-up Flag — Plan Brief

> Full plan: `context/changes/rozmowa-followup-flag/plan.md`

## What & Why

Rozmowa (interview) cards that have had no action for **≥ 4 business days** (Mon–Fri, weekends excluded) should nudge the user to follow up after the interview, rather than silently going stale. S-09 adds an on-card amber flag — **"Czas na follow-up po rozmowie"** — plus a **"Napisz follow-up"** button that opens the existing card-detail/notes dialog. This is PRD US-04 / FR-012 / issue #10, the direct sibling of the shipped S-08 Zaaplikowano flag. The domain reason for business days (not calendar): a Friday interview at a 4-calendar-day threshold fires on Tuesday (2 business days), which is premature.

## Starting Point

The board is a React `client:load` island; every card carries DB-owned `last_action_at`. S-08 shipped the exact card-render machinery this reuses: the amber follow-up pill + "Napisz follow-up" button, note-writing end-to-end (`CardNotes` in `CardDetailDialog`, which reloads on close so a saved note clears the flag for free), and drag-based status change (S-05) that also resets `last_action_at`. The one gap: `isStale()` is **calendar-day only** — S-08 explicitly deferred business-day math to S-09.

## Desired End State

A stale (≥ 4 business days) Rozmowa card shows an amber "Czas na follow-up po rozmowie" flag and a "Napisz follow-up" button in place of its timestamp. The button opens the detail dialog; the user saves a note, closes it, the board reloads, and the flag is gone. Dragging the card to another column also clears it. Fresh Rozmowa cards and other columns show the normal timestamp. Saving a note never changes status. S-07 and S-08 flags are unaffected.

## Key Decisions Made

| Decision            | Choice                                                   | Why (1 sentence)                                                                        | Source |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------ |
| Business-day logic  | New `isStaleBusinessDays()` sibling in `format.ts`       | Parallel API, unit-testable in isolation, leaves the shipped calendar `isStale` intact  | Plan   |
| Counting convention | Weekdays in `(startOfDay(then), startOfDay(now)]`        | Matches the PRD's own vector: Friday → Tuesday = 2 business days                        | PRD    |
| Card structure      | Extract shared `FOLLOWUP_FLAGS` config (Zaap. + Rozmowa) | Realizes the seam S-08 deferred; kills byte-identical duplication (one render path)     | Plan   |
| Act affordance      | Keep single "Napisz follow-up" button                    | US-04's "or change status" is already served by existing drag; no new UI/plumbing       | Plan   |
| Testing             | Unit tests own business-day math; e2e mirrors S-08       | Weekend boundaries are a unit concern; e2e reuses the proven note-clears-flag lifecycle | Plan   |
| Public holidays     | Excluded (weekends only)                                 | Out of MVP scope per PRD — locale-specific, changes yearly                              | PRD    |

## Scope

**In scope:** `isStaleBusinessDays()` + unit tests; `FOLLOWUP_FLAGS` config refactor folding in Zaaplikowano and adding Rozmowa; amber "Czas na follow-up po rozmowie" flag; "Napisz follow-up" button reusing the detail dialog; e2e spec.

**Out of scope:** any schema/API/service/migration change; public-holiday awareness; inline note editor; new status-change affordance on the flag; dialog autofocus/scroll; status change on note save; changes to `isStale`; e2e of the status-change-clears-flag path.

## Architecture / Approach

Client-side, computed-per-render flag (never persisted). Add `isStaleBusinessDays(iso, n, now?)` to `format.ts`. In `KanbanCard`, replace the hard-coded S-08 condition with `FOLLOWUP_FLAGS.find((f) => f.status === status && f.isStale(last_action_at))` over a two-entry config (`{status, isStale, label}`), rendering one shared amber-pill + button branch driven by the matched entry's label. No new callback plumbing through `KanbanColumn`/`KanbanBoard`; the button flips the existing `onDetailOpenChange` state and stops pointer propagation to avoid dnd-kit drag.

## Phases at a Glance

| Phase                  | What it delivers                                      | Key risk                                           |
| ---------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| 1. Business-day helper | `isStaleBusinessDays()` + unit tests                  | Off-by-one business-day math around weekends       |
| 2. Config-driven flag  | `FOLLOWUP_FLAGS` refactor + Rozmowa amber flag/button | Regression to shipped S-08 render (guarded by e2e) |
| 3. E2E coverage        | Playwright spec mirroring S-08 for Rozmowa            | client:load timing; seed weekday-stability         |

**Prerequisites:** S-06 (card detail + notes), S-07 (`isStale`, card render), S-08 (follow-up block, e2e template) — all done.
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- The business-day counting convention is pinned to the PRD Friday→Tuesday=2 example; if that reading is wrong, the threshold fires a day early/late. Unit tests lock it.
- Extracting `FOLLOWUP_FLAGS` touches shipped S-08 render code; the S-08 e2e spec guards against regressions.
- e2e seeds an 8+ calendar-day-old card (always ≥ 4 business days regardless of run weekday) to stay weekend-stable without business-day math in the test.

## Success Criteria (Summary)

- Stale (≥ 4 business days) Rozmowa cards show the amber "Czas na follow-up po rozmowie" flag; fresh ones don't; other columns unaffected.
- "Napisz follow-up" opens the notes dialog; saving a note clears the flag on reload without changing status; a drag also clears it.
- Typecheck, lint, unit tests (incl. `isStaleBusinessDays`), and the new e2e spec all pass.
