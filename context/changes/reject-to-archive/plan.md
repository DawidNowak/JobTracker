# Reject to Archive Implementation Plan

## Overview

Add a **reject** action that moves an application in **Zaaplikowano** or **Rozmowa** off the main kanban board into an archived state by stamping `archived_at = now()`. Rejecting is exposed as an "Odrzuć" item in the card's dropdown menu (guarded to those two columns), gated behind a confirmation dialog, and enforced server-side so an **Interesujące** card can never be archived. This is roadmap slice **S-10**; the archive _view_ is the separate S-11 slice and stays out of scope.

## Current State Analysis

Most of the plumbing already exists from F-01:

- **Schema is done.** `public.applications.archived_at timestamptz` exists, with partial indexes `applications_active_board_idx (user_id, status) where archived_at is null` and `applications_archive_idx (user_id, archived_at) where archived_at is not null`. — `supabase/migrations/20260526123145_applications_schema.sql:27,32-38`
- **RLS is done.** `applications_update_own` (USING + WITH CHECK on `user_id = auth.uid()`) already authorizes an owner to update `archived_at`. **No migration is needed for this slice.** — same file, `:52-56`
- **The board filter is done.** `listActiveApplications` selects `.is("archived_at", null)`, so a card disappears from the board the instant `archived_at` is set. — `src/lib/services/applications.ts:7-18`, consumed by `src/pages/dashboard.astro:20-25`
- **The `last_action_at` trigger will not fire.** It bumps only `when (old.status is distinct from new.status)`; archiving touches `archived_at`, not `status`, so the last-action clock is preserved for the future archive view. — `supabase/migrations/20260526123145_applications_schema.sql:118-122`

What is missing: the write path (a service + endpoint that sets `archived_at`), the server-side status guard, and the UI affordance + confirmation dialog.

## Desired End State

A logged-in user opens the ⋮ menu on a card in **Zaaplikowano** or **Rozmowa** and sees an "Odrzuć" item (absent on **Interesujące** cards). Clicking it opens a confirmation dialog; confirming calls `POST /api/applications/[id]/archive`, which sets `archived_at = now()` and returns the row. The card leaves the board. A crafted request to archive an **Interesujące** card is rejected with a 422 and a Polish message; the row stays active.

Verify by: (a) `npm run typecheck && npm run lint && npm test` green; (b) the new HTTP smoke + RLS integration tests pass; (c) manually rejecting a Zaaplikowano card removes it from the board and the DB row shows a non-null `archived_at` (not deleted); (d) the Playwright reject spec passes locally.

### Key Discoveries:

- Dropdown menu + per-card dialog wiring pattern to mirror: `src/components/board/KanbanCard.tsx:61-97,138-178,249-257`
- Confirm-dialog + `window.location.reload()` on success pattern to mirror: `src/components/board/DeleteApplicationDialog.tsx`
- id-addressed route pattern (uuid validation, 401/400/404 semantics, `jsonResponse`): `src/pages/api/applications/[id].ts`
- Existence-leak guard convention — non-owner gets exactly **404**, never a range: `tests/http/patch-applications.test.ts:53-72`
- E2E template (seed → open menu → confirm → assert board + DB): `tests/e2e/delete-application.spec.ts`

## What We're NOT Doing

- **No archive view.** `/archive` stays the "Wkrótce" placeholder (`src/pages/archive.astro`) — that is S-11. After this slice a rejected card is simply gone from every visible surface until S-11 ships.
- **No un-archive / restore.** Archiving is one-directional in MVP.
- **No archiving from Interesujące.** Those cards are deleted or promoted to Zaaplikowano, never archived (FR-009 / FR-016).
- **No schema/migration change.** The column, indexes, and RLS already exist.
- **No changes to the delete flow.** Delete remains a permanent, no-archive action.

## Implementation Approach

A dedicated action endpoint (`POST /api/applications/[id]/archive`) owns the write and the domain rule, keeping `archived_at` out of the general `applicationUpdateSchema` (which would otherwise permit client-supplied timestamps and un-archiving). The service performs a **conditional update** that only matches an owned, still-active, Zaaplikowano/Rozmowa row; the endpoint classifies a no-match into 404 (not visible to the user) vs 422 (the user's own row is Interesujące / already archived) so the UI can show the correct message. The frontend mirrors the existing delete affordance: a menu item guarded by status, a confirm dialog, and a reload on success.

## Phase 1: Backend — archive endpoint, service, and tests

### Overview

Add the service function and route that set `archived_at`, enforce the status rule, and prove ownership + guard behavior at the RLS and HTTP layers.

### Changes Required:

#### 1. Archive service

**File**: `src/lib/services/applications.ts`

**Intent**: Add `archiveApplication` that stamps `archived_at = now()` on an owned, active, Zaaplikowano/Rozmowa row and returns the updated row (or `null` when nothing matched, so the caller can classify the failure).

**Contract**: `archiveApplication(supabase: Client, id: string, userId: string): Promise<ApplicationRow | null>`. Conditional UPDATE filtered on `id = id`, `user_id = userId`, `archived_at is null`, and `status in ('Zaaplikowano', 'Rozmowa')`, setting `archived_at` to the current timestamp, `.select("*").maybeSingle()`. Do **not** set or touch `status` (preserves the `last_action_at` trigger's no-op). To let the endpoint distinguish 404 from 422 on a `null` result, also expose a lightweight owned-row lookup (reuse or add a helper that returns the row's `status`/`archived_at` scoped to `user_id`) — or return a discriminated result. Implementer's choice; the required outward behavior is fixed by the route below.

#### 2. Archive route

**File**: `src/pages/api/applications/[id]/archive.ts` (new)

**Intent**: A `POST` handler that authorizes the caller, validates the id, invokes `archiveApplication`, and maps the outcome to the correct status code + Polish copy.

**Contract**: `export const prerender = false;` and `export const POST: APIRoute`. No request body is required (ignore/empty body). Response matrix:

- `401` `{ error: "Brak autoryzacji." }` when no `context.locals.user`.
- `400` `{ error: "Nieprawidłowy identyfikator." }` when the id param fails `z.uuid()`.
- `500` `{ error: "Supabase nie jest skonfigurowany." }` when `createClient` returns null.
- `200` `{ application: row }` on success.
- `404` `{ error: "Nie znaleziono aplikacji." }` when no owned row is visible (non-owner or missing) — must be **exactly 404**, matching the existence-leak convention.
- `422` when the owned row can't be archived — **key the message on the fetched row's actual state**, not a single hardcoded string:
  - owned row is **Interesujące** → `{ error: "Ofertę z kolumny „Interesujące" można tylko usunąć lub przenieść do „Zaaplikowano"." }`.
  - owned row is **already archived** (`archived_at` non-null; reachable only via a duplicate/crafted POST since the UI hides the affordance off-board) → a neutral message, e.g. `{ error: "Aplikacja została już odrzucona." }` — never the „Interesujące" copy.

Follow the handler skeleton and error-logging style of `src/pages/api/applications/[id].ts`.

#### 3. RLS integration coverage

**File**: `tests/integration/rls-applications.test.ts`

**Intent**: Assert at the PostgREST row level that setting `archived_at` is owner-gated and that an archived row drops out of the active-board query — RLS/filter is the SUT, so assert against raw rows, not the service.

**Contract**: Add cases: (a) owner sets `archived_at` on their own row and a subsequent `select().is("archived_at", null)` no longer returns it; (b) a non-owner UPDATE of `archived_at` affects zero rows / is invisible. Reuse existing seed + client helpers in the suite.

#### 4. HTTP smoke coverage

**File**: `tests/http/archive-applications.test.ts` (new)

**Intent**: Drive the endpoint over HTTP to prove the status matrix end-to-end.

**Contract**: Mirror the structure of `tests/http/patch-applications.test.ts` (provision two users, capture cookies, seed). Cases: `401` without cookie; exactly `404` for a non-owner (row left unmutated — `archived_at` still null via admin read); `200` for the owner on a **Zaaplikowano** seed with `archived_at` now non-null; `200` on a **Rozmowa** seed; `422` for the owner on an **Interesujące** seed with `archived_at` still null (assert the „Interesujące" copy); `422` for the owner on an **already-archived** seed (`{ status: "Zaaplikowano", archived_at: <past ts> }`) asserting the neutral „już odrzucona" copy — proves the state-keyed message branch.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Full suite passes: `npm test`
- New HTTP smoke suite passes: `npm test -- archive-applications`
- RLS archive assertions pass: `npm test -- rls-applications`

#### Manual Verification:

- `POST /api/applications/<id>/archive` on an owned Zaaplikowano card returns 200 and the row's `archived_at` is set (verified via Supabase / admin read).
- The same request against an Interesujące card returns 422 and leaves `archived_at` null.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2.

---

## Phase 2: Frontend — reject action UI

### Overview

Expose the reject action on the card, guarded to Zaaplikowano/Rozmowa, behind a confirmation dialog that calls the Phase 1 endpoint.

### Changes Required:

#### 1. Reject confirmation dialog

**File**: `src/components/board/RejectApplicationDialog.tsx` (new)

**Intent**: A confirm dialog mirroring `DeleteApplicationDialog` that POSTs to the archive endpoint and reloads the board on success.

**Contract**: Props `{ application: ApplicationRow; open: boolean; onOpenChange: (open: boolean) => void }`. Uses `AlertDialog`. Copy: title "Odrzuć aplikację", description "Aplikacja zostanie przeniesiona do archiwum i zniknie z tablicy.", confirm button "Odrzuć", cancel "Anuluj". On confirm: `fetch("/api/applications/${application.id}/archive", { method: "POST" })`; on 200 → `window.location.reload()`; on failure → inline banner "Nie udało się odrzucić aplikacji. Spróbuj ponownie." Reset banner/loading state on close, matching `DeleteApplicationDialog`.

#### 2. Card menu wiring

**File**: `src/components/board/KanbanCard.tsx`

**Intent**: Add a `rejectOpen` state, render an "Odrzuć" menu item only for Zaaplikowano/Rozmowa cards, and mount `RejectApplicationDialog`.

**Contract**: Add `rejectOpen` to the `KanbanCardDraggable` state set and to `anyOpen` (so drag stays disabled while the dialog is open). Thread `rejectOpen` / `onRejectOpenChange` through `CardBodyProps` like the existing delete props. Render the "Odrzuć" `DropdownMenuItem` between "Edytuj" and "Usuń" **only when** `application.status === "Zaaplikowano" || application.status === "Rozmowa"`. Mount `RejectApplicationDialog` alongside the other dialogs in `KanbanCardBody`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Full suite passes: `npm test`

#### Manual Verification:

- "Odrzuć" appears in the ⋮ menu on Zaaplikowano and Rozmowa cards and is **absent** on Interesujące cards.
- Confirming the dialog removes the card from the board; cancelling leaves it.
- The card is gone after reload (not present in any column); the DB row still exists with `archived_at` set (not deleted).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: E2E — reject flow (local-only)

### Overview

A Playwright spec proving the reject flow end-to-end in a real browser. Per `AGENTS.md`, E2E is **local-only and not a CI gate**.

### Changes Required:

#### 1. Reject E2E spec

**File**: `tests/e2e/reject-application.spec.ts` (new)

**Intent**: Seed a Zaaplikowano card, reject it through the UI, and assert it leaves the board while its row survives in the DB with `archived_at` set — and that Interesujące exposes no reject affordance.

**Contract**: Follow `tests/e2e/delete-application.spec.ts` and the `seedApp` / `admin` fixtures in `tests/e2e/fixtures.ts`. Steps: seed `{ status: "Zaaplikowano", company: <unique> }`; `goto("/dashboard")` + `waitForBoardHydration`; open the card's "Opcje aplikacji" menu; click the "Odrzuć" menuitem; assert the alertdialog heading "Odrzuć aplikację"; `Promise.all([page.waitForEvent("load"), confirm click])`; assert the company text has count 0 on the board; via `admin`, assert the row still exists **and** `archived_at` is non-null. Add a second assertion (same or sibling test) that a seeded **Interesujące** card's menu has no "Odrzuć" menuitem.

### Success Criteria:

#### Automated Verification:

- Reject spec passes: `npm run test:e2e -- reject-application`

#### Manual Verification:

- Spec is green against a freshly started local stack + dev server (per the e2e-browser playbook), with no cross-test bleed when run alongside the existing e2e suite.

---

## Testing Strategy

### Unit / Integration Tests:

- RLS: owner can set `archived_at`; archived row excluded by the active-board `is("archived_at", null)` filter; non-owner blocked (`tests/integration/rls-applications.test.ts`).
- HTTP: full status matrix incl. exactly-404 non-owner and 422 Interesujące (`tests/http/archive-applications.test.ts`).

### E2E Tests:

- Reject a Zaaplikowano card → leaves board, row survives with `archived_at` set; Interesujące card shows no "Odrzuć" (`tests/e2e/reject-application.spec.ts`).

### Manual Testing Steps:

1. On the board, open ⋮ on a Zaaplikowano card → click "Odrzuć" → confirm → card disappears.
2. Reload; confirm the card is in no column.
3. Verify via admin/Supabase the row still exists with `archived_at` non-null.
4. Open ⋮ on an Interesujące card → confirm "Odrzuć" is absent.
5. Repeat step 1 for a Rozmowa card.

## Performance Considerations

None. Single-row indexed UPDATE keyed on `id`/`user_id`; the archive partial index already exists.

## Migration Notes

No migration. Column, indexes, and RLS policies already shipped in F-01.

## References

- Roadmap slice S-10: `context/foundation/roadmap.md:196-205`
- PRD FR-009 / FR-016 / FR-017: `context/foundation/prd.md:126-131`
- Schema + RLS: `supabase/migrations/20260526123145_applications_schema.sql`
- Board filter: `src/lib/services/applications.ts:7-18`
- Delete flow to mirror: `src/components/board/DeleteApplicationDialog.tsx`, `src/components/board/KanbanCard.tsx`
- HTTP smoke pattern: `tests/http/patch-applications.test.ts`
- E2E template: `tests/e2e/delete-application.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — archive endpoint, service, and tests

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Full suite passes: `npm test`
- [x] 1.4 New HTTP smoke suite passes: `npm test -- archive-applications`
- [x] 1.5 RLS archive assertions pass: `npm test -- rls-applications`

#### Manual

- [x] 1.6 POST archive on owned Zaaplikowano card returns 200 and sets `archived_at`
- [x] 1.7 POST archive on Interesujące card returns 422 and leaves `archived_at` null

### Phase 2: Frontend — reject action UI

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — daece52
- [x] 2.2 Lint passes: `npm run lint` — daece52
- [x] 2.3 Full suite passes: `npm test` — daece52

#### Manual

- [x] 2.4 "Odrzuć" appears on Zaaplikowano/Rozmowa cards and is absent on Interesujące — daece52
- [x] 2.5 Confirming removes the card; cancelling leaves it — daece52
- [x] 2.6 After reload the card is gone from the board but its DB row survives with `archived_at` set — daece52

### Phase 3: E2E — reject flow (local-only)

#### Automated

- [x] 3.1 Reject spec passes: `npm run test:e2e -- reject-application` — 82fa6f2

#### Manual

- [x] 3.2 Spec green against a fresh local stack + dev server with no cross-test bleed — 82fa6f2
