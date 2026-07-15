# Archive View (S-11) Implementation Plan

## Overview

Build the read-only **archive view**: a page at `/archive` listing archived job applications (`archived_at IS NOT NULL`), where clicking an entry opens a dedicated full-page read-only view at `/archive/[id]` — including the application's complete note history — with **no editing affordances anywhere** (PRD FR-010, FR-017).

The backend is already shipped by S-10 (`reject-to-archive`, commit `9b84010`): the `archived_at` column, the partial archive index, the write path, and — critically — the SELECT RLS policies on `applications` and `application_notes` are pure ownership checks (`user_id = auth.uid()`) with no `archived_at` clause, so they already return archived rows. **No migration, index, or RLS change is required.** All work is in the app tier.

## Current State Analysis

- **Data path is ready.** `supabase/migrations/20260526123145_applications_schema.sql:27,36-38,42-45,80-83` defines the nullable `archived_at`, the `applications_archive_idx` partial index, and ownership-only SELECT RLS on both `applications` and `application_notes`. The later `20260526132205_harden_application_notes_rls.sql:9-13` deliberately left notes SELECT as simple `user_id = auth.uid()`. Archived rows and their note history are fully readable by the owner today.
- **Service layer gap.** `src/lib/services/applications.ts` has `listActiveApplications` (`:7-18`, `.is("archived_at", null)`) but no archived-list sibling. The only by-id fetch is `getOwnedApplicationState` (`:77-93`) which selects only `status, archived_at` — insufficient to render a full card. `src/lib/services/notes.ts` `listNotes(supabase, applicationId, userId)` (`:6-22`) works unchanged for archived applications.
- **Pages.** `src/pages/dashboard.astro:10-36` is the SSR fetch → `AppShell` → island pattern to mirror. `src/pages/archive.astro:1-12` is a static "Wkrótce" placeholder to replace. There are **no dynamic Astro page routes** today (only `[id]` API routes with `z.uuid()`).
- **Reusable presentation.** `src/components/board/CardDetailDialog.tsx:34-67` `DetailRow` field block; `src/components/board/CardNotes.tsx:203-206` note-row display markup (body pre-wrap + `formatDateTime`); `src/lib/format.ts` `parseSourceHref` (`:1-11`) + `formatDateTime` (`:15-17`). All drop-in.
- **Nav & auth are ready.** `src/components/app/AppNav.astro:19-21` already renders the "Archiwum" → `/archive` link with active-state via `activeNav="archiwum"`. `src/middleware.ts:4,18-22` gates `/archive` and (via `startsWith`) `/archive/[id]` for free. Pages don't self-guard.

## Desired End State

- Navigating to `/archive` (authenticated) shows a list of the user's archived applications, newest-archived first, each row showing `company — position` and the "Zarchiwizowano" date, the whole row a link to `/archive/{id}`. When there are none, `"Brak zarchiwizowanych aplikacji."` is shown.
- Navigating to `/archive/{id}` for an owned archived application shows a full read-only card: the reused field rows (link, tryb pracy, wynagrodzenie, opis, kontakt) plus **Status** and a **"Zarchiwizowano"** date, followed by the complete note history rendered read-only (no composer, no Edytuj/Usuń). A non-existent, non-owned, or malformed id returns **404**.
- No editing control appears anywhere on either page. This is enforced **structurally**: neither page imports the board mutation machinery, mounts `DndContext`, or renders `CardNotes`.

**Verification**: with two seeded users each owning an archived application, user A sees only their own entry on `/archive`, `/archive/{A's id}` renders their card + notes read-only, and `/archive/{B's id}` returns 404. `npm run typecheck && npm run lint && npm test` all green.

### Key Discoveries:

- SELECT RLS is ownership-only, already covers archived rows — no DB work (`schema.sql:42-45,80-83`, `harden_application_notes_rls.sql:9-13`).
- List queries here rely on RLS for ownership and don't re-filter `user_id`; by-id fetches keep the `.eq("user_id", …)` belt-and-suspenders (`applications.ts:29-30,48-49,64-66,85-86,98-99`).
- `last_action_at` trigger fires only on `status` change (`schema.sql:118-122`), so archiving preserves the pre-archive clock — the read-only card shows faithful history.
- FR-017 durability is a component-architecture decision, not a prop: a separate read-only tree that never imports mutation code beats a `readOnly` flag threaded through ≥6 scattered affordance sites in `KanbanCard.tsx` + embedded note CRUD.
- Middleware `startsWith` already protects `/archive/[id]`; no `PROTECTED_ROUTES` change (`middleware.ts:4,18-22`).

## What We're NOT Doing

- **No** search, filter, or sort controls in the archive (parked non-goal — `roadmap.md:250`, `prd.md:190`). Sort is fixed: `archived_at` descending.
- **No** schema, index, RLS, or migration changes.
- **No** un-archive / restore action (out of scope for S-11).
- **No** `readOnly` prop added to `KanbanCard` or `CardNotes`; no reuse of `CardDetailDialog` (it forces `window.location.reload()` on close — board-specific).
- **No** React islands on either archive page — both render fully SSR. No `DndContext`.
- **No** new status-badge component or salary/status formatting layer — status renders as plain `DetailRow` text like the rest of the app.
- **No** new API route — the detail page fetches notes server-side via `listNotes` in its frontmatter, not the client GET endpoint.

## Implementation Approach

Three phases, bottom-up: service functions first (independently testable at the PostgREST/RLS level), then the list page, then the detail page + read-only notes component. Every user-facing string is Polish, matching existing copy. Presentation reuses the `DetailRow` pattern and `format.ts` helpers, re-expressed as Astro markup so the pages stay island-free.

## Phase 1: Service Layer

### Overview

Add the two missing service functions in `src/lib/services/applications.ts`, following the file's existing conventions exactly.

### Changes Required:

#### 1. Archived-list query

**File**: `src/lib/services/applications.ts`

**Intent**: Add `listArchivedApplications` as the mirror of `listActiveApplications` — return the owner's archived rows, newest-archived first, letting RLS scope ownership.

**Contract**: `listArchivedApplications(supabase: Client): Promise<ApplicationRow[]>`. Query: `.from("applications").select("*").not("archived_at", "is", null).order("archived_at", { ascending: false })`. Throws on error, returns `data`. No `.eq("user_id", …)` — matches `listActiveApplications` (RLS scopes ownership); ordering is served by `applications_archive_idx`.

#### 2. Full-row by-id fetch

**File**: `src/lib/services/applications.ts`

**Intent**: Add `getOwnedApplication` returning a full `ApplicationRow` (or null) for one owned application, so the detail page can render a complete card. Distinct from `getOwnedApplicationState`, which returns only `status, archived_at`.

**Contract**: `getOwnedApplication(supabase: Client, id: string, userId: string): Promise<ApplicationRow | null>`. Query: `.from("applications").select("*").eq("id", id).eq("user_id", userId).maybeSingle()`. Keeps the `.eq("user_id", …)` belt-and-suspenders every by-id function here uses. Not archive-specific (no `archived_at` filter) — the detail page decides how to treat a still-active id (see Phase 3).

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Full test suite passes: `npm test`
- [ ] Integration test: an owner reading via the archived-list query sees their archived row(s) and none of another user's; active rows are excluded (assert at the PostgREST row level, per `tests/README.md` — not through the service).

#### Manual Verification:

- [ ] N/A for this phase (no UI yet) — covered by automated integration assertions.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Archive List Page

### Overview

Replace the `archive.astro` placeholder with a real SSR list mirroring `dashboard.astro`'s fetch-and-render structure.

### Changes Required:

#### 1. Archive list page

**File**: `src/pages/archive.astro`

**Intent**: Fetch the owner's archived applications server-side and render them as a simple list; show an empty-state message when there are none. Keep `AppShell title="Archiwum" activeNav="archiwum"`.

**Contract**: Frontmatter mirrors `dashboard.astro:10-31` — `createClient(Astro.request.headers, Astro.cookies)`, then inside `if (supabase) { try { … } catch { console.error(...) } }` call `listArchivedApplications(supabase)` into a `rows: ApplicationRow[]` (default `[]`). Body: when `rows.length === 0`, render the muted empty state `"Brak zarchiwizowanych aplikacji."`; otherwise a `<ul>` where each `<li>` is a full-row `<a href={\`/archive/${row.id}\`}>` showing `` `${row.company ?? "—"}${row.position ? ` — ${row.position}` : ""}` `` and, below it, `Zarchiwizowano ${formatDateTime(row.archived_at)}`. `archived_at`is non-null for every row in this list (the query filters it), but narrow/guard so TypeScript strict is satisfied. Merge classes only via`cn()`; no `class:list`.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Full test suite passes: `npm test`

#### Manual Verification:

- [ ] `/archive` (signed in) lists archived applications newest-first, each row linking to `/archive/{id}`; no edit/drag/menu controls present.
- [ ] With no archived applications, `"Brak zarchiwizowanych aplikacji."` renders.
- [ ] "Archiwum" nav item shows active state; the board (`/dashboard`) still shows only active applications (no regression).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Archive Detail Page + Read-Only Notes

### Overview

Add the dedicated `src/pages/archive/[id].astro` full-page read-only view and extract a display-only notes component. Both are SSR, island-free.

### Changes Required:

#### 1. Display-only notes list component

**File**: `src/components/board/ReadOnlyNotesList.astro` (new)

**Intent**: Render a note history read-only — no composer, no Edytuj/Usuń, no delete dialog. Re-express `CardNotes`'s display row markup (`CardNotes.tsx:203-206`) as Astro so nothing interactive can leak (FR-017).

**Contract**: Props: `{ notes: ApplicationNoteRow[] }`. Renders a heading `"Notatki"`; when empty, `"Brak notatek."`; otherwise a `<ul>` where each `<li>` shows `note.body` (`whitespace-pre-wrap`) and `formatDateTime(note.created_at)` in muted text — matching the visual style of `CardNotes.tsx:203-206` minus all buttons. Pure presentation; no fetching, no client JS.

#### 2. Archive detail page

**File**: `src/pages/archive/[id].astro` (new)

**Intent**: Full read-only card for one archived application plus its note history, fetched entirely server-side. 404 for anything the user can't/shouldn't view.

**Contract**: Read `id = Astro.params.id` and validate as a UUID (`z.uuid()`, per the `[id]` route convention). On invalid id → `return new Response(null, { status: 404 })` (or Astro's 404 mechanism). `createClient(...)`; if no client → 404/empty. Fetch `getOwnedApplication(supabase, id, user.id)` (read `Astro.locals.user`); if `null` **or** `archived_at` is `null` (still active — not an archive record) → 404. Then `listNotes(supabase, id, user.id)` for the history. Wrap in `AppShell title="Archiwum" activeNav="archiwum"`. Body reuses the `CardDetailDialog:34-67` field layout re-expressed as Astro `DetailRow`-style rows: title `company — position`; "Link do oferty" when `parseSourceHref(application.source)` non-null; "Tryb pracy"; "Wynagrodzenie"; "Opis" (pre-wrap); "Kontakt do rekrutera"; **"Status"** (plain text, `application.status`); **"Zarchiwizowano"** (`formatDateTime(application.archived_at)`). Then `<ReadOnlyNotesList notes={notes} />`. A back link to `/archive` for navigation. No `CardNotes`, no `CardDetailDialog`, no `DndContext`, no React island.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Full test suite passes: `npm test`

#### Manual Verification:

- [ ] `/archive/{owned archived id}` renders the full field set (including Status + Zarchiwizowano date) and the complete note history, all read-only — no composer, no Edytuj/Usuń, no drag/menu.
- [ ] `/archive/{another user's id}`, `/archive/{active application's id}`, `/archive/{random uuid}`, and `/archive/not-a-uuid` all return 404.
- [ ] Notes appear in the same order and formatting as on the board's card detail; a note with newlines preserves them (pre-wrap).
- [ ] Back navigation to `/archive` works; nav "Archiwum" active state persists on the detail page.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation. Optionally run the `e2e-browser` skill for an authenticated visual smoke check (not a CI gate).

---

## Testing Strategy

### Unit Tests:

- No pure-utility logic is added (`format.ts` helpers already tested where applicable). The service functions are thin PostgREST queries — cover them at the integration level, not with mocks (never mock the Supabase client).

### Integration Tests (`tests/integration/`, PostgREST-level RLS):

- Owner sees their archived row(s) via the archived-list query; another user's archived rows are absent; active rows are excluded.
- Full by-id fetch returns the owned row and returns null for another user's id (RLS) — assert at the row level, not through `src/lib/services/`.
- (Notes SELECT for archived applications is already covered by existing notes RLS suites; extend only if a gap exists for the archived case.)

### Manual Testing Steps:

1. Sign in; archive an application from the board (reject flow), then open `/archive` — it appears newest-first.
2. Open its `/archive/{id}` — verify all fields, Status, Zarchiwizowano date, and read-only note history.
3. Attempt `/archive/{id}` for an id you don't own and for an active application — both 404.
4. Confirm no editing/drag/menu control appears anywhere on either archive page.
5. Confirm the board still shows only active applications.

## Performance Considerations

The archived-list query is served by the existing `applications_archive_idx (user_id, archived_at) where archived_at is not null`, ordered by `archived_at desc`. No pagination in scope (parked non-goal); volumes are per-user and small.

## Migration Notes

None — no schema or data changes.

## References

- Research: `context/changes/archive-view/research.md`
- List/fetch pattern to mirror: `src/pages/dashboard.astro:10-36`
- Service conventions: `src/lib/services/applications.ts:7-18,77-93`
- Field layout to reuse: `src/components/board/CardDetailDialog.tsx:34-67`
- Note-row display markup: `src/components/board/CardNotes.tsx:203-206`
- Format helpers: `src/lib/format.ts:1-11,15-17`
- Prior slice (backend): `context/archive/2026-07-14-reject-to-archive/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Service Layer

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 3c6c23d
- [x] 1.2 Linting passes: `npm run lint` — 3c6c23d
- [x] 1.3 Full test suite passes: `npm test` — 3c6c23d
- [x] 1.4 Integration test: owner sees own archived rows, not others'; active rows excluded (PostgREST-level) — 3c6c23d

#### Manual

- [ ] 1.5 N/A — no UI this phase (covered by automated integration assertions)

### Phase 2: Archive List Page

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — a8416d2
- [x] 2.2 Linting passes: `npm run lint` — a8416d2
- [x] 2.3 Full test suite passes: `npm test` — a8416d2

#### Manual

- [x] 2.4 `/archive` lists archived apps newest-first, each row links to `/archive/{id}`, no edit controls — a8416d2
- [x] 2.5 Empty state `"Brak zarchiwizowanych aplikacji."` renders when none — a8416d2
- [x] 2.6 "Archiwum" nav active; board still shows only active applications (no regression) — a8416d2

### Phase 3: Archive Detail Page + Read-Only Notes

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — b7f9e4c
- [x] 3.2 Linting passes: `npm run lint` — b7f9e4c
- [x] 3.3 Full test suite passes: `npm test` — b7f9e4c

#### Manual

- [x] 3.4 Owned archived detail renders full fields + Status + Zarchiwizowano date + read-only note history — b7f9e4c
- [x] 3.5 Non-owned id, active-application id, random uuid, and malformed id all return 404 — b7f9e4c
- [x] 3.6 Notes match board ordering/formatting; newlines preserved (pre-wrap) — b7f9e4c
- [x] 3.7 Back navigation to `/archive` works; "Archiwum" active state persists on detail page — b7f9e4c
