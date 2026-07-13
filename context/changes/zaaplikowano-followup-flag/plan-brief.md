# S-08 Zaaplikowano Follow-up Flag — Plan Brief

> Full plan: `context/changes/zaaplikowano-followup-flag/plan.md`

## What & Why

Zaaplikowano cards that have had no action (status change or note save) for **≥ 7 calendar days** should nudge the user to follow up with the recruiter, rather than silently going stale. S-08 adds an on-card amber flag — **"Czas na follow-up z rekruterem"** — plus a **"Napisz follow-up"** button that opens the existing card-detail/notes dialog so the user can write and save a follow-up note. This is PRD US-02 / issue #9, the direct sibling of the shipped S-07 decision prompt.

## Starting Point

The board is a React `client:load` island; every card already carries DB-owned `last_action_at` as an ISO string. S-07 already built the exact primitive this needs: `isStale(iso, days, now?)` (calendar-day correct, unit-tested) and the on-card gating pattern that replaces the timestamp with a prompt for stale cards. Note-writing exists end-to-end (`CardNotes` inside `CardDetailDialog`); a note insert bumps `last_action_at` via trigger, and the dialog reloads on close — so a saved note clears the flag for free.

## Desired End State

A stale (≥ 7d) Zaaplikowano card shows an amber "Czas na follow-up z rekruterem" flag and a "Napisz follow-up" button in place of its timestamp. The button opens the detail dialog (notes already in view); the user saves a note, closes it, the board reloads, and the flag is gone. Fresh Zaaplikowano cards and cards in other columns show the normal timestamp. Saving a note never changes status.

## Key Decisions Made

| Decision             | Choice                                           | Why (1 sentence)                                                                  | Source |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- | ------ |
| Note affordance      | Flag + button opens existing detail/notes dialog | Zero note-UI rework; dialog close reloads and clears the flag automatically       | Plan   |
| Flag visual          | Amber badge + label, replaces the timestamp      | Reads as a genuine flag ("visually flagged" per US-02) with minimal layout change | Plan   |
| Reuse scope for S-09 | Keep follow-up config local to KanbanCard        | S-09 differs (business-day math, different label); avoid premature abstraction    | Plan   |
| Dialog focus         | Open dialog as-is (notes already visible)        | No prop threading into dialog/notes; textarea is already reachable                | Plan   |
| Testing              | Playwright e2e spec mirroring S-07               | Matches how board UI is tested; covers gating + note-clears-flag loop             | Plan   |

## Scope

**In scope:** `showFollowUp` gate on Zaaplikowano stale cards; amber flag label; "Napisz follow-up" button reusing the detail dialog; e2e spec.

**Out of scope:** any schema/API/service/migration change; inline note editor; dialog autofocus/scroll; shared FollowUpFlag component for S-09; status change on note save; business-day logic; new unit test for the predicate.

## Architecture / Approach

Client-side, computed-per-render flag (never persisted), exactly like S-07's prompt. In `KanbanCard`, compute `showFollowUp = status === "Zaaplikowano" && isStale(last_action_at, 7)` and render a third mutually-exclusive branch in the timestamp slot: amber badge + "Napisz follow-up" button that flips the existing `onDetailOpenChange` state. No new callback plumbing through `KanbanColumn`/`KanbanBoard`. The button stops pointer propagation to avoid triggering dnd-kit drag.

## Phases at a Glance

| Phase            | What it delivers                               | Key risk                                                  |
| ---------------- | ---------------------------------------------- | --------------------------------------------------------- |
| 1. Flag + button | Amber flag + "Napisz follow-up" on stale cards | Branch exclusivity + drag isolation on the button         |
| 2. E2E coverage  | Playwright spec driving the flag lifecycle     | e2e seeding of aged `last_action_at` + client:load timing |

**Prerequisites:** S-06 (card detail + notes) and S-07 (`isStale`, card render pattern) — both done.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Adding a note bumps `last_action_at` and clears the flag on reload — treated as a valid "follow-up action", consistent with the domain notes.
- The amber flag introduces a warning color token not previously used on cards; keep it restrained (pill/accent, not full-card).
- e2e must seed an aged `last_action_at`; reuse the S-07 spec's seeding helpers to avoid divergence.

## Success Criteria (Summary)

- Stale (≥ 7d) Zaaplikowano cards show the amber follow-up flag; fresh ones don't; other columns unaffected.
- "Napisz follow-up" opens the notes dialog; saving a note clears the flag on reload without changing status.
- Typecheck, lint, unit tests, and the new e2e spec all pass.
