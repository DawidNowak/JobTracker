# Archive View (S-11) — Plan Brief

> Full plan: `context/changes/archive-view/plan.md`
> Research: `context/changes/archive-view/research.md`

## What & Why

Build the read-only **archive view**: a `/archive` page listing archived job applications and a dedicated `/archive/[id]` full-page view showing an application's details plus its complete note history — with **no editing anywhere** (PRD FR-010, FR-017). Users need to look back at rejected/closed applications and their accumulated notes without any risk of altering them.

## Starting Point

S-10 (`reject-to-archive`, commit `9b84010`) already shipped the backend: the `archived_at` column, the partial archive index, the write path, and ownership-only SELECT RLS on `applications` + `application_notes` (no `archived_at` clause — archived rows already read back). Today `/archive` is just a "Wkrótce" placeholder. The nav link and middleware auth for `/archive` (and `/archive/[id]` via `startsWith`) already exist. **All remaining work is app-tier — no DB changes.**

## Desired End State

`/archive` lists the owner's archived applications newest-archived-first, each row a link to `/archive/{id}`. `/archive/{id}` renders a full read-only card (reused field rows + Status + "Zarchiwizowano" date) followed by the read-only note history. Non-owned, still-active, or malformed ids return 404. No edit/drag/menu/composer control exists on either page — enforced structurally, not by a flag.

## Key Decisions Made

| Decision               | Choice                                                                            | Why (1 sentence)                                                                                                   | Source   |
| ---------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Detail URL shape       | Dedicated `/archive/[id].astro` SSR page                                          | Real bookmarkable URLs, matches `[id]`+`z.uuid()` convention, never imports mutation code (best FR-017 guarantee). | Plan     |
| Read-only guardrail    | Separate SSR component tree, no `readOnly` flag on board card                     | Mutation surface in `KanbanCard`/`CardNotes` is large & scattered; a flag risks leaking an affordance.             | Research |
| Detail fields          | Reused field rows + Status + "Zarchiwizowano" date                                | Gives archive context (state + when) without introducing a badge layer.                                            | Plan     |
| Note history rendering | Extract display-only `ReadOnlyNotesList.astro`, notes fetched SSR via `listNotes` | Leaves `CardNotes` untouched; structurally impossible to leak the composer/edit/delete.                            | Plan     |
| Status display         | Plain `DetailRow` text (no badge)                                                 | Consistent with how the app renders everything else; avoids scope creep.                                           | Plan     |
| List row               | `company — position` + "Zarchiwizowano" date, whole row `<a>`                     | Scannable, gives the key archive signal, zero client JS.                                                           | Plan     |
| Empty state            | `"Brak zarchiwizowanych aplikacji."`                                              | Matches existing empty-copy tone (`"Brak notatek."`).                                                              | Plan     |

## Scope

**In scope:** `listArchivedApplications` + `getOwnedApplication` service fns; SSR `/archive` list with empty state; SSR `/archive/[id]` read-only detail; `ReadOnlyNotesList.astro`; 404 handling for bad/non-owned/active ids.

**Out of scope:** search/filter/sort (parked non-goal); any schema/RLS/migration; un-archive/restore; React islands or `DndContext` on archive pages; new status-badge/formatting layer; new API route.

## Architecture / Approach

Bottom-up, fully SSR. `applications.ts` gains an archived-list query (mirror of active, `.not("archived_at","is",null)`, ordered `archived_at desc` — served by the existing index) and a full-row by-id fetch (keeps the `.eq("user_id",…)` belt-and-suspenders). `archive.astro` mirrors `dashboard.astro`'s fetch-then-render. `archive/[id].astro` validates the id, fetches the owned row + notes server-side, 404s otherwise, and reuses the `CardDetailDialog` field layout + `format.ts` helpers as Astro markup. Read-only is guaranteed structurally: no archive page imports the board's mutation machinery.

## Phases at a Glance

| Phase                       | What it delivers                                                          | Key risk                                                                 |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1. Service layer            | `listArchivedApplications` + `getOwnedApplication` + RLS integration test | Getting the archived filter / ordering right; RLS assertion at row level |
| 2. Archive list page        | Real SSR `/archive` list + empty state                                    | `archived_at` null-narrowing under strict TS                             |
| 3. Detail page + notes list | `/archive/[id]` read-only card + `ReadOnlyNotesList`                      | 404 semantics for active/non-owned ids; no affordance leak               |

**Prerequisites:** None — backend shipped in S-10; local Supabase stack running for `npm test`.
**Estimated effort:** ~1–2 sessions across 3 phases (small, pattern-mirroring changes).

## Open Risks & Assumptions

- Assumes a still-active id at `/archive/[id]` should 404 (treated as "not an archive record") rather than redirect — plan encodes 404.
- Assumes no pagination needed at current per-user volumes (parked non-goal).
- Notes SELECT RLS for archived applications is assumed already covered by existing suites; extend only if a gap surfaces.

## Success Criteria (Summary)

- Owner sees only their own archived applications on `/archive`, newest-first, with a working link to each detail page.
- `/archive/{owned archived id}` shows the full card + complete note history, entirely read-only; every other id class 404s.
- `npm run typecheck && npm run lint && npm test` all green; the active board is unaffected.
