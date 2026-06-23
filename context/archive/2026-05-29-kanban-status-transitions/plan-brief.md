# Kanban Status Transitions (S-05) — Plan Brief

> Full plan: `context/changes/kanban-status-transitions/plan.md`

## What & Why

Make cards draggable between the three active columns (Interesujące ↔ Zaaplikowano ↔ Rozmowa). The board becomes a kanban for real — without this slice it is read-only. A successful drop fires `PATCH /api/applications/[id]`; the existing `BEFORE UPDATE` trigger automatically resets `last_action_at`, which is the variable the upcoming follow-up flag slices (S-07/S-08/S-09) will read. The card's visible timestamp also switches to `last_action_at` so freshness rendering and flag computation share one source of truth.

## Starting Point

The DB already has `applications.status` and the `BEFORE UPDATE` trigger that bumps `last_action_at` only on status change (F-01). The board is purely server-rendered Astro (`KanbanBoard.astro` → `KanbanColumn.astro` → `KanbanCard.astro`) with the only React island being S-02's `AddApplicationDialog`. The only domain endpoint is `POST /api/applications`, which set the JSON envelope (`201 / 422 { errors } / 5xx { error } / 401`). No row-update endpoint, no row-update service, no dnd library.

## Desired End State

A signed-in user grabs an active card with the mouse, drops it on another active column, and it visibly relocates immediately. The visible timestamp on the card reads "przed chwilą". On success the move persists across reload. On failure the card snaps back to its origin and a dismissible red banner explains the error. Backward moves (Rozmowa → Zaaplikowano, Zaaplikowano → Interesujące) are first-class. Same-column drops are a no-op (no network call). Two-user RLS holds: user B's PATCH against user A's card id is a 404. The three Astro board files are deleted; the same names exist as React components inside a single `KanbanBoard.tsx` `client:load` island.

## Key Decisions Made

| Decision                                | Choice                                                                | Why (1 sentence)                                                                                                                  | Source |
| --------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| UI affordance                           | Drag-and-drop between columns                                          | Kanban-native; pulls in dnd-kit + a board-level React island, accepted as scope.                                                  | Plan   |
| Endpoint shape                          | `PATCH /api/applications/[id]` with `{ status }`                       | Sets the repo's general per-row edit pattern; S-03 will widen the same route to accept more fields.                              | Plan   |
| Post-success UX                         | Optimistic move + reload only on error (snap-back to snapshot)         | Feels instant inside the 500ms NFR; no targeted refetch needed; reload reconciles on next nav.                                    | Plan   |
| DnD library                             | `@dnd-kit/core` only (skip `@dnd-kit/sortable`)                        | Within-column ordering is out of scope (server orders by `created_at DESC`); install only what's used.                            | Plan   |
| Island scope                            | Whole board is the React island (one `DndContext` covers all columns) | dnd-kit needs all draggables/droppables in one React tree — single-card islands cannot share a context.                           | Plan   |
| Card-face timestamp                     | Switch from `created_at` to `last_action_at`                          | Same variable the follow-up flags will read; surfaces freshness consistent with the flag rule that lands in S-07/S-08/S-09.       | Plan   |
| Error UX                                | Snap back + dismissible red banner above the board                    | Matches S-02's banner pattern; no new shadcn primitive (no toast/sonner); visual rollback is unambiguous.                         | Plan   |
| Same-column drop                        | Client-side short-circuit, no PATCH                                   | DB trigger would no-op anyway; avoids a pointless round-trip and the visual flash that the optimistic UI would otherwise produce. | Plan   |
| Stale-row concurrency                   | Ignore in MVP (last write wins; reload to re-sync)                    | PRD is single-user-per-account; explicit `If-Match` / version column is scope creep for a non-PRD use case.                       | Plan   |
| DnD accessibility                       | Pointer sensor only (no keyboard, no touch)                            | Explicit user choice; keyboard-only users cannot move cards in MVP — flagged as a known risk below.                               | Plan   |

## Scope

**In scope:**
- `applicationStatusUpdateSchema` (status-only) in `src/lib/validation/applications.ts`.
- `updateApplicationStatus` service that scopes by `(id, user_id)` and distinguishes 404 (no row) from 500 (other error).
- `PATCH /api/applications/[id]` route mirroring S-02's JSON envelope (`200 { application } / 401 / 400 / 422 / 404 / 500`).
- `@dnd-kit/core` dependency.
- React `KanbanBoard.tsx` / `KanbanColumn.tsx` / `KanbanCard.tsx` mounted as a single `client:load` island; Astro counterparts deleted.
- `AddApplicationDialog` continues to work as a React child of the new board island.
- Card-face timestamp source switches to `last_action_at`.
- `DndContext` + `PointerSensor` + `DragOverlay`; same-column short-circuit; optimistic state machine with snapshot/revert; error banner.

**Out of scope:**
- Edit / delete (S-03), notes (S-06), parser auto-fill (S-04), decision prompt + follow-up flags (S-07/S-08/S-09), archive (S-10/S-11).
- Drag handles, within-column reordering, multi-select drag.
- Keyboard / touch DnD sensors.
- Toasts / new shadcn primitives.
- Optimistic concurrency (version column / `If-Match`).
- Targeted refetch of the moved row (no GET-by-id endpoint).
- Test scaffolding (AGENTS.md hard rule).

## Architecture / Approach

Three phases. Phase 1 ships server-only: the PATCH route + service + schema, verifiable via curl. Phase 2 is a pure refactor: install `@dnd-kit/core`, port the three Astro board files to React inside a single `client:load` island, switch the timestamp source, delete the Astro originals — the board behaves identically to today's S-02 board (modulo timestamp source). Phase 3 wires DnD: a single `DndContext` at the board, `useDraggable` cards, `useDroppable` columns, an `onDragEnd` state machine that snapshots state, optimistically moves the card and bumps `last_action_at` locally, fires PATCH, and on failure reverts to the snapshot and shows a banner. A `DragOverlay` renders the card under the cursor. This phasing isolates the framework conversion (Phase 2) from the interaction logic (Phase 3) so debugging stays scoped.

## Phases at a Glance

| Phase                                                          | What it delivers                                                                                       | Key risk                                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. PATCH endpoint + service + schema                            | First row-mutating API in the repo; status-only PATCH at `/api/applications/[id]`; envelope reuse.     | Setting the per-row precedent S-03 will widen — `user_id`-scoped service + `maybeSingle` → 404 mapping must be right the first time.            |
| 2. Port board to React (no DnD yet)                             | Three Astro board files become one `KanbanBoard.tsx` island; `AddApplicationDialog` folds in as child. | First domain component goes React-first; Add flow must keep working through the refactor; timestamp source change is the only behavioral delta. |
| 3. Wire DnD with optimistic move + snap-back                    | `DndContext`, draggable cards, droppable columns, optimistic state machine, error banner.              | Snapshot-before-mutate ordering and same-column short-circuit must be exact; banner-vs-overlay layering on the board surface.                   |

**Prerequisites:** F-01 (live), S-01 (live), S-02 (live, shipped 2026-05-29). No new env vars, no new infra, no migrations.
**Estimated effort:** ~2–3 after-hours sessions; Phase 2 (refactor) and Phase 3 (DnD wiring) are the bulk.

## Open Risks & Assumptions

- **Keyboard-only users cannot move cards in MVP.** Pointer-sensor only is an explicit choice; revisit when an a11y signal materializes.
- **Last-write-wins concurrency.** A user with two tabs open who clicks in both can end up with a final state they didn't intend; recovery is one reload. Acceptable per PRD's single-user model.
- **Astro→React conversion** changes the card and column source of truth — S-07's flag rendering must extend the React `KanbanCard.tsx`, not the (deleted) Astro version.
- The `BEFORE UPDATE` trigger filter (`OLD.status IS DISTINCT FROM NEW.status`) means a hypothetical future "same-status PATCH" would not bump `last_action_at`. S-05's same-column short-circuit makes this unreachable from the UI today but worth remembering for S-03.
- `@dnd-kit/sortable` is intentionally not installed; if within-column reordering ever lands, that's the moment to add it.

## Success Criteria (Summary)

- A signed-in user can drag a card across any two of the three active columns (forward or backward) and the move persists across reload.
- A 4xx/5xx/network failure during a move snaps the card back to its origin and surfaces a dismissible banner — no silent state loss (PRD NFR).
- Two-user RLS holds end-to-end on PATCH: user B cannot mutate user A's card.
