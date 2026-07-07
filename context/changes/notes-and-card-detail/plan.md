# Notes and Card Detail (S-06) Implementation Plan

## Overview

Add a **card-detail modal** that surfaces an application's fields (read-only) alongside its full **follow-up note history**, and lets the user **create, edit, and delete** plain-text notes. Writing a new note resets the card's `lastActionAt` (the follow-up timer); editing or deleting a note does not.

This is roadmap slice **S-06** (`context/foundation/roadmap.md:148`). It introduces the card-detail surface that S-07–S-09 (follow-up flags) and S-11 (archive view) all build on, and it is the "act-on" side of every follow-up flag.

## Current State Analysis

The F-01 foundation already did the heavy lifting at the data layer:

- **`application_notes` table** exists with `id`, `application_id` (FK, `on delete cascade`), `user_id`, `body` (`check length > 0`), `created_at`, and a `(application_id, created_at desc)` history index (`supabase/migrations/20260526123145_applications_schema.sql:67`).
- **RLS is complete** for all four verbs. INSERT and UPDATE were hardened to `EXISTS`-check parent-application ownership (`supabase/migrations/20260526132205_*.sql`); SELECT and DELETE use direct `user_id = auth.uid()`. **No migration is needed for this slice** — full create/edit/delete is already permitted by policy.
- **AFTER INSERT trigger** `application_notes_bumps_parent_last_action` advances the parent's `last_action_at` on note insert only (`...123145...:154`). UPDATE and DELETE have no trigger — matching our decision that edits/deletes leave the timer untouched.
- **Zod** `applicationNoteCreateSchema` exists but takes `application_id` in the body (`src/lib/validation/applications.ts:42`); our nested routes carry the id in the URL, so a body-only variant is needed.
- **Types**: `application_notes` Row/Insert/Update are generated in `database.types.ts:42`; `src/types.ts` only re-exports `ApplicationRow` today.

What does **not** exist yet: any notes **service**, any notes **API route**, the **card-detail UI**, an **absolute-date** formatter, and a card **entry point** to open the detail.

### Key Discoveries:

- **`lastActionAt` reset is DB-enforced on insert** (`...123145...:154`) — the modal must NOT try to also patch `last_action_at`; the trigger owns it.
- **Established API pattern** (`src/pages/api/applications/[id].ts`): auth check → UUID param validate (`z.uuid()`) → `request.json()` → zod `safeParse` → `createClient(headers, cookies)` → service call → `jsonResponse(...)`. 404 is returned when the service returns null (RLS miss is indistinguishable from not-found — by design).
- **Established service pattern** (`src/lib/services/applications.ts`): typed client → `.from(...).insert/update/delete/select()` scoped by `user_id` → `.select("*").single()/.maybeSingle()` → throw on error.
- **Established modal pattern** (`src/components/board/EditApplicationDialog.tsx`): shadcn `Dialog` with `max-h-[90vh] flex flex-col`, scrollable body, `DialogFooter`; on success closes and calls `window.location.reload()`.
- **Card state pattern** (`src/components/board/KanbanCard.tsx:43-71`): per-card boolean open-state lifted into `KanbanCardDraggable`, with dnd-kit `disabled` while any overlay is open (`anyOpen`). A detail dialog must extend this `anyOpen` guard so dragging is suppressed while the detail is open.
- **Timestamp helpers** (`src/lib/format.ts`): only `formatRelative` exists; the note history needs absolute dates.
- **Test patterns** exist for both HTTP (`tests/http/patch-applications.test.ts`) and RLS attack (`tests/integration/rls-application-notes-attack.test.ts`), with helpers `provisionUser`, `signInAndCaptureCookies`, `seedApplication`.

## Desired End State

A user clicks a card's "Szczegóły" menu item and a modal opens showing the application's company, position, source link, work mode, salary, description, and recruiter contact as read-only text, plus a notes section: an input to add a note, and the history newest-first with absolute timestamps. The user can add a note (it appears instantly at the top), edit any note inline, or delete a note after confirming. Closing the modal refreshes the board so the card's relative timestamp reflects any new note. Editing or deleting a note never changes the card's follow-up timer.

Verify by: opening a card, adding/editing/deleting notes, confirming history ordering and timestamps, confirming a *new* note advances `last_action_at` (board card "dodano … temu" resets after close) while an edit/delete does not, and confirming a second user can never read or mutate the first user's notes.

## What We're NOT Doing

- **No schema migration.** Table, indexes, RLS, and trigger are all in place from F-01.
- **No editing of application fields** in this modal — field edits stay in the existing `EditApplicationDialog` reached from the same menu. The detail surface is read-only for fields.
- **No follow-up flag computation** (that's S-07/S-08/S-09). This slice only writes/reads notes and relies on the existing insert trigger.
- **No server-side rendering of notes** into `dashboard.astro` — notes load client-side on modal open.
- **No `lastActionAt` recompute** on note edit/delete — the timer is insert-only by decision.
- **No archive/read-only reuse work** (S-11) — though this modal's note-history renderer is built to be reusable later.
- **No rich text / attachments / max-length cap** beyond the existing `length > 0` DB check.

## Implementation Approach

Build bottom-up: a notes **service** + **validation** + **REST endpoints** first (independently testable against RLS), then the **read/write modal** that delivers the roadmap outcome, then the **edit/delete** affordances layered on top. Routes are nested under the application to mirror the existing `[id].ts` convention and to let RLS' parent-ownership check do the authorization work:

- `GET  /api/applications/[id]/notes` — list notes for a card, newest first.
- `POST /api/applications/[id]/notes` — create a note (body in JSON, `application_id` from URL).
- `PATCH  /api/applications/[id]/notes/[noteId]` — edit a note's body.
- `DELETE /api/applications/[id]/notes/[noteId]` — delete a note.

The UI fetches on open, holds the note list in modal-local React state, and reconciles optimistically on each mutation; the board is refreshed only on modal close.

## Critical Implementation Details

- **Timing & lifecycle** — `last_action_at` is advanced by the F-01 AFTER INSERT trigger, not by the app. Never write `last_action_at` from the notes service or route. Because edit/delete have no trigger, they correctly leave the timer alone with no extra code.
- **User experience spec** — dnd-kit dragging must be suppressed while the detail modal is open: extend the `anyOpen` guard in `KanbanCardDraggable` (`KanbanCard.tsx:47,52`) to include the new detail-open flag, otherwise a drag can start under the open modal. The add-note input should clear and keep focus after a successful add so multiple notes can be written in one sitting.

## Phase 1: Notes API & Service Layer

### Overview

Stand up the notes service, validation schemas, and four REST endpoints, fully covered by HTTP and RLS tests. No UI yet.

### Changes Required:

#### 1. Shared note type

**File**: `src/types.ts`

**Intent**: Re-export a single `ApplicationNoteRow` type so service, routes, and components share one name (mirrors the existing `ApplicationRow` export).

**Contract**: `export type ApplicationNoteRow = Database["public"]["Tables"]["application_notes"]["Row"];`

#### 2. Note validation schemas

**File**: `src/lib/validation/applications.ts`

**Intent**: Add a body-only create schema (the URL carries `application_id`, so the existing `applicationNoteCreateSchema` with its `application_id` field doesn't fit the nested route) and an update schema for editing a note body.

**Contract**: `applicationNoteBodySchema = z.object({ body: z.string().min(1) })` and `applicationNoteUpdateSchema = z.object({ body: z.string().min(1) })`, with inferred types exported. Reuse `applicationNoteBodySchema` for both POST body validation and the update if identical; keep them named separately for clarity. `body` is trimmed client-side before send; server keeps `min(1)` to mirror the DB `length > 0` check.

#### 3. Notes service

**File**: `src/lib/services/notes.ts` (new)

**Intent**: Encapsulate the four Supabase operations, each scoped by `user_id`, following the `applications.ts` service shape. RLS enforces ownership; these functions return `null` on miss so routes can map to 404.

**Contract**: Four exported functions on a typed `Client`:
- `listNotes(supabase, applicationId, userId): Promise<ApplicationNoteRow[]>` — `.select("*").eq("application_id", id).eq("user_id", userId).order("created_at", { ascending: false })`.
- `createNote(supabase, applicationId, body, userId): Promise<ApplicationNoteRow>` — `.insert({ application_id, user_id, body }).select("*").single()`.
- `updateNote(supabase, noteId, body, userId): Promise<ApplicationNoteRow | null>` — `.update({ body }).eq("id", noteId).eq("user_id", userId).select("*").maybeSingle()`.
- `deleteNote(supabase, noteId, userId): Promise<boolean>` — `.delete().eq("id", noteId).eq("user_id", userId).select("id").maybeSingle()`, returns whether a row was removed.

Throw on a real Supabase error; return null/false only for the empty-result (RLS/not-found) case — match `updateApplication`/`deleteApplication` in `applications.ts`.

#### 4. List + create endpoint

**File**: `src/pages/api/applications/[id]/notes/index.ts` (new)

**Intent**: `GET` returns the card's notes newest-first; `POST` creates a note. Both follow the `[id].ts` auth/validate/client/service/respond pattern.

**Contract**: `export const prerender = false;`. `GET` → 401 if no user, 400 on bad UUID, 200 `{ notes: [...] }`. `POST` → 401, 400 bad UUID, 400 unparseable JSON, 422 `{ errors }` on zod failure, 201 `{ note }` on success, 500 on unexpected error. Both validate `context.params.id` with `z.uuid()`. POST validates body with `applicationNoteBodySchema`. Because the parent application's existence/ownership is enforced by the hardened INSERT RLS policy, a note pointed at someone else's (or a missing) application fails at insert — surface that as 404 `{ error: "Nie znaleziono aplikacji." }` rather than 500 by catching the RLS/foreign-key error code.

#### 5. Edit + delete endpoint

**File**: `src/pages/api/applications/[id]/notes/[noteId].ts` (new)

**Intent**: `PATCH` edits a note body; `DELETE` removes a note. Note ownership is enforced by RLS; mismatch yields 404.

**Contract**: `export const prerender = false;`. Validate both `id` and `noteId` params as `z.uuid()`. `PATCH` → 401, 400, 422 (zod), 404 if `updateNote` returns null, 200 `{ note }`. `DELETE` → 401, 400, 404 if `deleteNote` returns false, 200 `{ ok: true }`. Mirror the response/error-logging shape of `applications/[id].ts`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- New HTTP test passes: notes CRUD happy-path + 401/400/404/422 (`npm run test`)
- New RLS test passes: a non-owner cannot GET, POST, PATCH, or DELETE another user's notes (extends `tests/integration/rls-application-notes-attack.test.ts`)
- Existing test suite still green: `npm run test`

#### Manual Verification:

- `POST` a note via the running endpoint and confirm the parent application's `last_action_at` advanced (insert trigger fired)
- `PATCH` and `DELETE` a note and confirm `last_action_at` did NOT change
- Confirm `GET` returns notes newest-first

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before Phase 2.

---

## Phase 2: Card-Detail Modal (Core Outcome)

### Overview

The roadmap-defined deliverable: a modal opened from the card menu showing read-only application fields and the note history, with an add-note input. Delivers S-06 on its own (write + read), independent of Phase 3.

### Changes Required:

#### 1. Absolute-date formatter

**File**: `src/lib/format.ts`

**Intent**: Add a precise date+time formatter for the note history (relative time is useless for an aged log).

**Contract**: `export function formatDateTime(iso: string): string` using `Intl.DateTimeFormat("pl", { dateStyle: "medium", timeStyle: "short" })` (e.g. `30 cze 2026, 14:32`). Construct the formatter once at module scope like the existing `relativeFormatter`.

#### 2. Notes section component

**File**: `src/components/board/CardNotes.tsx` (new)

**Intent**: Render the add-note input and the history list; own the notes' client state (GET on open, optimistic prepend on add). Built so Phase 3 can add per-row edit/delete and S-11 can reuse the read-only history.

**Contract**: Props `{ applicationId: string }`. On mount, `GET /api/applications/[id]/notes` → store `ApplicationNoteRow[]`; show a loading and an empty state. Add-note: controlled textarea + "Dodaj notatkę" button → `POST`; on 201, prepend returned note to local state, clear+refocus the input. Each history row shows `body` (preserving line breaks) and `formatDateTime(created_at)`. Surface a non-blocking error banner on failure (match `EditApplicationDialog`'s `bannerError` style).

#### 3. Card-detail dialog

**File**: `src/components/board/CardDetailDialog.tsx` (new)

**Intent**: The modal shell — read-only application fields plus `<CardNotes>` — following the `EditApplicationDialog` Dialog layout.

**Contract**: Props `{ application: ApplicationRow; open: boolean; onOpenChange: (open: boolean) => void }`. Dialog with `max-h-[90vh] flex flex-col`, header titled by company/position, a read-only fields block (company, position, source as "Link do oferty" when a URL via the existing `parseSourceHref` logic, work mode, salary, description, recruiter contact — omit empty fields), then `<CardNotes applicationId={application.id} />` in the scrollable region. On `onOpenChange(false)`, call `window.location.reload()` so the board reflects any new note's `last_action_at` (consistent with `EditApplicationDialog`). Reuse `parseSourceHref` — extract it to a shared spot or import; do not duplicate.

#### 4. Card entry point

**File**: `src/components/board/KanbanCard.tsx`

**Intent**: Add a "Szczegóły" menu item and a `detailOpen` state, rendering `CardDetailDialog`; suppress dragging while it's open.

**Contract**: Add `detailOpen` state in `KanbanCardDraggable` (`:43`), thread `detailOpen`/`onDetailOpenChange` through `CardBodyProps`, include it in the `anyOpen` guard (`:47`), add a `DropdownMenuItem` "Szczegóły" above "Edytuj", and render `<CardDetailDialog>` alongside the existing edit/delete dialogs (`:158`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full test suite green: `npm run test`

#### Manual Verification:

- "Szczegóły" opens the modal; all populated fields show read-only, empty fields are omitted
- Note history loads newest-first with absolute timestamps; empty state shows when there are no notes
- Adding a note prepends it instantly and clears+refocuses the input
- Closing the modal refreshes the board and the card's "dodano … temu" reflects the new note
- Dragging is disabled while the modal is open
- Editing application fields still works via the separate "Edytuj" dialog

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Note Edit & Delete

### Overview

Layer per-note edit and delete onto the history rows, wired to the Phase 1 `PATCH`/`DELETE` endpoints. This is the scope addition beyond the roadmap's write+read outcome.

### Changes Required:

#### 1. Per-note edit & delete in the history

**File**: `src/components/board/CardNotes.tsx`

**Intent**: Add inline edit and a confirmed delete to each history row, reconciling local state optimistically without a board reload.

**Contract**: Each row gains an edit affordance (toggles the body into a controlled textarea with Save/Cancel → `PATCH /api/applications/[id]/notes/[noteId]`; on 200 replace the row in local state) and a delete affordance (confirm via the shadcn `AlertDialog` pattern used in `DeleteApplicationDialog` → `DELETE`; on success remove the row from local state). On any failure, restore prior state and show the error banner. Do NOT reload the board on edit/delete — the follow-up timer is unaffected by decision, so only the in-modal list changes.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Full test suite green: `npm run test`

#### Manual Verification:

- Editing a note saves and shows the updated body; the card's `last_action_at`/board timestamp does NOT change
- Deleting a note removes it after confirmation; remaining notes keep correct order
- A failed edit/delete restores the prior note and shows an error
- Canceling an edit leaves the original body intact

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation. This completes S-06.

---

## Testing Strategy

### Unit Tests:

- Validation: `applicationNoteBodySchema` / `applicationNoteUpdateSchema` reject empty/whitespace-only bodies (mirrors DB `length > 0`).
- `formatDateTime` produces the expected Polish absolute format for a known ISO input.

### Integration Tests (RLS — never mock Supabase):

- Owner can list/create/edit/delete their notes; non-owner gets nothing back and cannot mutate (extend `rls-application-notes-attack.test.ts`).
- Cross-user POST (own `user_id`, victim's `application_id` via URL) is rejected → endpoint returns 404, no row inserted.

### HTTP Tests:

- `GET`/`POST`/`PATCH`/`DELETE` happy paths + 401 (no cookie), 400 (bad UUID), 422 (empty body), 404 (other user's / missing note), modeled on `tests/http/patch-applications.test.ts`.
- After `POST`, parent `last_action_at` advanced; after `PATCH`/`DELETE`, it is unchanged.

### Manual Testing Steps:

1. Open a card → "Szczegóły"; verify read-only fields and empty note state.
2. Add two notes; confirm newest-first ordering and absolute timestamps.
3. Close modal; confirm board card timestamp reset.
4. Reopen; edit a note, confirm board timestamp unchanged.
5. Delete a note with confirmation; confirm ordering holds and timer unchanged.
6. As a second user, confirm the first user's notes are never visible.

## Performance Considerations

Notes load lazily per card on modal open, so the board query stays as lean as it is today (no N×history fan-out). The `(application_id, created_at desc)` index already serves the list query. Note volume per application is small (a follow-up log), so no pagination is needed for MVP.

## Migration Notes

None. The `application_notes` table, indexes, RLS policies (incl. hardened INSERT/UPDATE), and the insert→`last_action_at` trigger all shipped in F-01.

## References

- Roadmap slice: `context/foundation/roadmap.md:148` (S-06)
- Business logic (lastActionAt semantics): `context/foundation/business-logic-notes.md:11`
- Schema + RLS + trigger: `supabase/migrations/20260526123145_applications_schema.sql:67`, `supabase/migrations/20260526132205_*.sql`
- API pattern: `src/pages/api/applications/[id].ts`
- Service pattern: `src/lib/services/applications.ts:75`
- Modal pattern: `src/components/board/EditApplicationDialog.tsx`
- Card state pattern: `src/components/board/KanbanCard.tsx:42`
- Delete-confirm pattern: `src/components/board/DeleteApplicationDialog.tsx`
- Test patterns: `tests/http/patch-applications.test.ts`, `tests/integration/rls-application-notes-attack.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Notes API & Service Layer

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 HTTP test passes: notes CRUD happy-path + 401/400/404/422
- [x] 1.4 RLS test passes: non-owner cannot GET/POST/PATCH/DELETE another user's notes
- [x] 1.5 Existing test suite still green: `npm run test`

#### Manual

- [x] 1.6 POST advances parent `last_action_at` (insert trigger fired)
- [x] 1.7 PATCH and DELETE leave `last_action_at` unchanged
- [x] 1.8 GET returns notes newest-first

### Phase 2: Card-Detail Modal (Core Outcome)

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Full test suite green: `npm run test`

#### Manual

- [ ] 2.4 "Szczegóły" opens modal; populated fields show read-only, empty fields omitted
- [ ] 2.5 Note history loads newest-first with absolute timestamps; empty state shown when none
- [ ] 2.6 Adding a note prepends instantly and clears+refocuses the input
- [ ] 2.7 Closing the modal refreshes the board; card timestamp reflects the new note
- [ ] 2.8 Dragging is disabled while the modal is open
- [ ] 2.9 Field editing still works via the separate "Edytuj" dialog

### Phase 3: Note Edit & Delete

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Full test suite green: `npm run test`

#### Manual

- [ ] 3.4 Editing a note saves; card `last_action_at`/board timestamp unchanged
- [ ] 3.5 Deleting a note removes it after confirmation; remaining order correct
- [ ] 3.6 A failed edit/delete restores prior state and shows an error
- [ ] 3.7 Canceling an edit leaves the original body intact
