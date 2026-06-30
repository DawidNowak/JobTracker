# Notes and Card Detail (S-06) — Plan Brief

> Full plan: `context/changes/notes-and-card-detail/plan.md`

## What & Why

Job seekers act on a follow-up by recording what they did. S-06 adds a **card-detail modal** where the user reads an application's fields and its full **follow-up note history**, and **writes notes** (with edit/delete). Writing a note is the domain "action" that resets the card's follow-up timer (`lastActionAt`) — making this slice the act-on surface that every follow-up flag (S-07–S-09) and the archive view (S-11) depend on.

## Starting Point

F-01 already shipped the entire data layer: the `application_notes` table, its `(application_id, created_at desc)` history index, complete RLS (incl. hardened cross-user INSERT/UPDATE checks), and an AFTER INSERT trigger that bumps the parent's `last_action_at`. There is **no notes service, no notes API route, and no card-detail UI** yet. The card today only offers Edytuj / Usuń via a dropdown menu.

## Desired End State

A "Szczegóły" menu item opens a modal showing the application's fields read-only plus a notes section: an add-note input and the history newest-first with absolute timestamps. Notes can be added (instant optimistic prepend), edited inline, and deleted with confirmation. Closing the modal refreshes the board so a new note's timer reset is visible. Editing or deleting a note never moves the follow-up timer.

## Key Decisions Made

| Decision                         | Choice                                   | Why (1 sentence)                                                                 | Source |
| -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------- | ------ |
| Detail surface                   | Modal Dialog                             | Reuses the exact `EditApplicationDialog` pattern; keeps user on the board.       | Plan   |
| Note history load                | Client `GET` on modal open               | Always fresh, keeps the board query lean, matches the React board's fetch model. | Plan   |
| Save UX                          | Optimistic prepend, board reload on close| History feels instant; modal stays open to write several notes.                  | Plan   |
| Note mutability                  | Full edit + delete                       | User wants a correctable log (beyond roadmap's write+read).                       | Plan   |
| Detail vs field editing          | Fields read-only; edit stays in `EditApplicationDialog` | Clean separation, no duplicated form logic, foreshadows S-11 read-only view. | Plan |
| Timestamp format                 | Absolute date + time (new `formatDateTime`) | A historical log needs precise "when"; relative time ages into uselessness.   | Plan   |
| Edit/delete effect on timer      | No effect (insert-only bump)             | Same logic that excludes field edits in F-01; needs no trigger change.           | Plan   |

## Scope

**In scope:** notes service (list/create/update/delete), four nested REST endpoints, validation schemas, card-detail modal (read-only fields + note history + add note), absolute-date formatter, per-note edit & delete, card menu entry, HTTP + RLS tests.

**Out of scope:** schema migration (done in F-01), editing application fields in this modal, follow-up flag computation (S-07–S-09), server-rendering notes into the board, `lastActionAt` recompute on edit/delete, pagination/rich-text/length cap.

## Architecture / Approach

Bottom-up. Phase 1 builds `src/lib/services/notes.ts` + zod schemas + routes `GET|POST /api/applications/[id]/notes` and `PATCH|DELETE /api/applications/[id]/notes/[noteId]`, authorized entirely by existing RLS (parent-ownership `EXISTS` checks). Phase 2 builds the `CardDetailDialog` + `CardNotes` React components that fetch on open and hold note state locally, plus the card menu entry. Phase 3 layers per-row edit/delete with optimistic reconciliation. The `last_action_at` reset is owned by the DB trigger — the app never writes that column.

## Phases at a Glance

| Phase                         | What it delivers                                  | Key risk                                                                 |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Notes API & service        | Tested CRUD endpoints over `application_notes`     | Mapping the cross-user RLS rejection to 404 (not 500) on POST.           |
| 2. Card-detail modal (core)   | Read-only fields + note history + add note (S-06)  | dnd-kit drag must be suppressed while modal open; board reload on close.  |
| 3. Note edit & delete         | Inline edit + confirmed delete per note            | Optimistic list reconciliation + restore-on-failure without board reload. |

**Prerequisites:** F-01 (done — schema/RLS/trigger), S-02 (done — card surface). All satisfied.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- POST to a note route pointing at another user's `application_id` is blocked by the hardened INSERT RLS policy; the route must catch that error and return 404 rather than leaking a 500.
- Board reload on modal close is the consistency mechanism for the card's relative timestamp — acceptable, matching the existing edit dialog; no live board state sync is attempted.
- Deleting a card's only note leaves a "phantom" `last_action_at` from its creation — accepted as rare and harmless per the insert-only decision.

## Success Criteria (Summary)

- A user can open a card, read its fields and note history, and add/edit/delete follow-up notes.
- Writing a new note resets the card's follow-up timer; editing or deleting one does not.
- A user can never see or mutate another user's notes (RLS-verified).
