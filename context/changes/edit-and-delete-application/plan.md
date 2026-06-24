# Edit and Delete Application Implementation Plan

## Overview

Add the ability to **edit** an existing job application's fields and to **delete** an application, surfaced from each kanban card via a 3-dot (kebab) menu. This completes PRD requirements FR-005 (edit), FR-006 (delete with column-aware warning), FR-016 (close/skip from Interesujące), and the edit half of FR-019 (recruiter contact). Most of the backend contract already exists — `applicationUpdateSchema` and the UPDATE/DELETE RLS policies are in place — so the work is: two new service functions, two new handlers on the existing `[id].ts` route, a shared form component, and three new UI components.

## Current State Analysis

- **DB**: `applications` table already has `applications_update_own` (UPDATE) and `applications_delete_own` (DELETE) RLS policies scoped to `auth.uid()` (`supabase/migrations/20260526123145_applications_schema.sql`). A `BEFORE UPDATE` trigger bumps `last_action_at` **only when `status` changes** — field edits do not reset the follow-up clock. **No migration is needed.**
- **Validation**: `applicationUpdateSchema` (all fields optional, `source` min(1) when present) already exists at `src/lib/validation/applications.ts:23`. `applicationStatusUpdateSchema` (status-only) is what the route currently uses.
- **Service** (`src/lib/services/applications.ts`): has `listActiveApplications`, `updateApplicationStatus`, `createApplication`. Missing: full update and delete.
- **API** (`src/pages/api/applications/[id].ts`): only a `PATCH` bound to `applicationStatusUpdateSchema` → `updateApplicationStatus`. No DELETE.
- **UI**: `KanbanCard.tsx` is read-only; its draggable wrapper spreads `{...listeners}` over the whole card body. `KanbanCardBody` is reused as the `DragOverlay` content (`KanbanBoard.tsx:134`). `AddApplicationDialog.tsx` implements the full field form + `window.location.reload()` on success — the template to mirror.
- **shadcn**: `src/components/ui/` has button, dialog, input, label, select, textarea. **`dropdown-menu` and `alert-dialog` are NOT installed** and must be added.
- **Tests**: `tests/http/{post,patch}-applications.test.ts` and `tests/integration/rls-applications.test.ts` plus helpers (`tests/helpers/{users,supabase-clients,fetch,seed,cookies}.ts`) are the models for new coverage. AGENTS rule: real Supabase, never mock the client — RLS is the system under test.

## Desired End State

On the dashboard kanban board, every card shows a kebab (⋮) button. Opening it offers **Edytuj** and **Usuń**.

- **Edytuj** opens a dialog pre-filled with the application's current fields (source, position, company, description, salary, work mode, recruiter contact — no status, no parse button). Saving issues `PATCH /api/applications/:id` and reloads the board. The application's `last_action_at` is unchanged by a field edit.
- **Usuń** opens a confirmation dialog whose wording depends on the card's column (per FR-006/FR-016). On confirm it issues `DELETE /api/applications/:id` and the card disappears from the board. Deletion is permanent (no archive).
- A user can never edit or delete another user's application (RLS-enforced; covered by tests).

Verify: edit a card's company → reload shows new value, card position/timestamp unchanged; delete a card → it's gone after reload; `npm run typecheck`, `npm run lint`, and `npm test` all pass.

### Key Discoveries:

- `applicationUpdateSchema` already models the full-update body (`src/lib/validation/applications.ts:23`) — no new schema needed.
- The `last_action_at` trigger keys off `status` change only (`...applications_schema.sql` trigger `applications_bump_last_action_at_on_status_change`), so excluding `status` from the edit form is what keeps the follow-up clock intact — no app-level guard required.
- `KanbanCardBody` is rendered both as the live card and the drag overlay; the actions menu must be gated to the live card only.
- The drag listeners sit on the wrapper `div` (`KanbanCard.tsx:38-47`); the menu trigger must stop pointer-event propagation so opening the menu doesn't begin a drag.
- `AddApplicationDialog` reloads the page on success (`AddApplicationDialog.tsx:141`); edit/delete will follow the same reload pattern rather than threading state callbacks through `KanbanColumn` → `KanbanCard`.

## What We're NOT Doing

- **No archive / soft-delete flow.** "Reject → archive" (FR-009/FR-010/FR-017) and the archive view are a separate change. This change does hard delete only.
- **No status editing in the edit form.** Status changes stay on drag-drop (and future decision prompts).
- **No follow-up decision-prompt UI** (US-03 "Zdecyduj — aplikujesz?" / "Aplikuj"/"Pomiń" flagging). The PRD routes Interesujące deletion through that prompt, but the prompt/flagging feature is out of scope here; the kebab **Usuń** provides the delete path for all columns now, using the FR-016 confirmation wording for Interesujące.
- **No re-parse ("Pobierz dane oferty") in the edit form.** Parsing belongs to the create/discovery flow.
- **No optimistic UI for edit/delete.** Reload-on-success matches the existing create flow; optimistic board mutation is a possible later refinement.
- **No card detail view.** Note history / detail panel is a separate feature.

## Implementation Approach

Build bottom-up: backend first (services + route + tests), then refactor the form into a shared component without changing create behavior, then assemble the edit/delete UI on top. The PATCH route is unified onto `applicationUpdateSchema` so a single handler serves both drag-drop status changes (`{ status }`) and full field edits — the existing drag-drop body remains valid under the broader schema.

## Critical Implementation Details

- **Drag vs. menu pointer events** — The kebab trigger lives inside the draggable card whose wrapper has dnd-kit `{...listeners}`. Stop propagation of the trigger's pointer-down (and keep the Radix menu content portaled to `body`, which it is by default) so opening the menu never initiates a drag. The `PointerSensor` already has `activationConstraint: { distance: 5 }`, which helps but does not by itself prevent the menu trigger from starting a drag.
- **Overlay guard** — `KanbanCardBody` is reused as the `DragOverlay`. Render the actions menu only on the live card (e.g. a `showActions`/`isOverlay`-derived flag), never in the overlay copy.
- **`last_action_at` invariant** — Do not include `status` in the edit form or its PATCH body. The DB trigger only bumps `last_action_at` on a status change, so a field-only PATCH preserves the follow-up clock with no extra app logic.

## Phase 1: Backend — full update + delete

### Overview

Add service functions and wire the existing `[id].ts` route to support full updates and deletion, with integration tests proving validation, not-found, and cross-user RLS isolation.

### Changes Required:

#### 1. Application service functions

**File**: `src/lib/services/applications.ts`

**Intent**: Add `updateApplication` (full field update) and `deleteApplication`, mirroring the ownership-scoped pattern already used by `updateApplicationStatus`.

**Contract**:
- `updateApplication(supabase: Client, id: string, input: ApplicationUpdate, userId: string): Promise<ApplicationRow | null>` — `.update(input).eq("id", id).eq("user_id", userId).select("*").maybeSingle()`; returns `null` when no owned row matches (drives 404).
- `deleteApplication(supabase: Client, id: string, userId: string): Promise<boolean>` — `.delete().eq("id", id).eq("user_id", userId).select("id").maybeSingle()`; returns whether a row was deleted (drives 404). `ApplicationUpdate` is imported from `@/lib/validation/applications`.

#### 2. Route handlers (PATCH unify + DELETE)

**File**: `src/pages/api/applications/[id].ts`

**Intent**: Switch the PATCH handler to validate with `applicationUpdateSchema` and call `updateApplication` (so it serves both `{ status }` drag-drop bodies and full edits), and add a `DELETE` handler. Keep the existing 401/400(id)/422/404/500 response shape and `export const prerender = false`.

**Contract**:
- `PATCH` validates body with `applicationUpdateSchema`; on success calls `updateApplication`; `null` → 404, row → `200 { application: row }`.
- `DELETE` validates the `:id` param (existing `uuidSchema`), requires `context.locals.user`, calls `deleteApplication`; `false` → `404 { error: "Nie znaleziono aplikacji." }`, `true` → `200 { ok: true }` (or `204`). Reuse `jsonResponse` / `formatZodErrors` from `@/lib/http`.
- `applicationStatusUpdateSchema` is no longer referenced by the route; leave the export in place (harmless) or remove if unused elsewhere.

#### 3. HTTP + RLS tests

**File**: `tests/http/patch-applications.test.ts` (extend), `tests/http/delete-applications.test.ts` (new), `tests/integration/rls-applications.test.ts` (extend)

**Intent**: Cover full-update happy path, delete happy path, validation 422 (e.g. empty `source`), 404 for a non-existent id, and the data-isolation guardrail (user A cannot PATCH or DELETE user B's application). Follow existing helper usage; never mock Supabase.

**Contract**: New tests assert status codes and that the row is/ isn't mutated/removed by querying as the owning user. Cross-user cases assert 404 (RLS hides the row) and that the victim's row is untouched.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- New + existing tests pass: `npm test`
- Full-update, delete, 422, 404, and cross-user isolation tests are present and green

#### Manual Verification:

- `PATCH /api/applications/:id` with a field body updates fields without changing `last_action_at`
- `DELETE /api/applications/:id` removes the row; a second DELETE returns 404

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Extract shared ApplicationForm

### Overview

Pull the application field markup out of `AddApplicationDialog` into a reusable presentational component so the edit dialog reuses identical fields and validation-error display. No behavior change to the create flow.

### Changes Required:

#### 1. Shared form component

**File**: `src/components/board/ApplicationForm.tsx` (new)

**Intent**: A controlled, presentational component rendering the source/position/company/description/salary/work-mode/recruiter-contact fields with per-field error slots, driven by props. The parse button (create-only) is provided by the parent, not baked into the form.

**Contract**: Props expose the form values, an `update(key, value)` setter, and the `errors` map (shape matching `AddApplicationDialog`'s `FormState`/`errors`). Provide a slot/render-prop for content under the source field (so `AddApplicationDialog` can place its "Pobierz dane oferty" button there). Reuse the existing `NO_WORK_MODE` sentinel and `workModeValues`. `cn()` for all class merging.

#### 2. Refactor AddApplicationDialog to use it

**File**: `src/components/board/AddApplicationDialog.tsx`

**Intent**: Replace the inline field markup with `<ApplicationForm>`, passing the parse button into the source slot. Keep all existing behavior (parse, submit → POST → reload, open/close reset).

**Contract**: No change to the POST body, success/422 handling, or props (`targetStatus`). Net result: identical create UX, fields now sourced from the shared component.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Tests pass: `npm test`

#### Manual Verification:

- Add-application dialog looks and behaves exactly as before (parse pre-fills fields, validation errors render, submit creates a card and reloads)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Edit + delete UI

### Overview

Install the required shadcn primitives and build the card kebab menu, the edit dialog, and the column-aware delete confirmation.

### Changes Required:

#### 1. Install shadcn primitives

**File**: `src/components/ui/dropdown-menu.tsx`, `src/components/ui/alert-dialog.tsx` (generated)

**Intent**: Add the menu and confirmation primitives via `npx shadcn@latest add dropdown-menu alert-dialog`. Keep generated files as upstream ships them (AGENTS exemption for `src/components/ui/`).

**Contract**: Components available for import under `@/components/ui/*`.

#### 2. Edit dialog

**File**: `src/components/board/EditApplicationDialog.tsx` (new)

**Intent**: A dialog mirroring `AddApplicationDialog` but pre-filled from an `ApplicationRow`, without status and without the parse button, submitting a full field update.

**Contract**: Props `{ application: ApplicationRow; open; onOpenChange }` (controlled by the card menu). Initializes form state from the row (null → empty string). Submit builds the same nullable-or-string body as create **minus `status`**, issues `PATCH /api/applications/:id`; `200` → `window.location.reload()`; `422` → field errors; other → banner error. Reuses `<ApplicationForm>`. No-op saves are allowed (no dirty guard).

#### 3. Delete confirmation dialog

**File**: `src/components/board/DeleteApplicationDialog.tsx` (new)

**Intent**: An `AlertDialog` confirming permanent deletion, with column-aware copy, issuing the DELETE call.

**Contract**: Props `{ application: ApplicationRow; open; onOpenChange }`. Message switches on `application.status`: `Interesujące` → "Usunąć tę aplikację? Tej akcji nie można cofnąć." (FR-016); `Zaaplikowano`/`Rozmowa` → "Rekord nie zostanie zachowany w archiwum. Tej akcji nie można cofnąć." (FR-006). Confirm → `DELETE /api/applications/:id`; success → `window.location.reload()`; failure → inline/banner error. Confirm button uses a destructive style; cancel label "Anuluj".

#### 4. Card actions menu wired into KanbanCard

**File**: `src/components/board/KanbanCard.tsx`

**Intent**: Add a kebab `DropdownMenu` (items **Edytuj**, **Usuń**) to the live card that opens the edit and delete dialogs. Render it only on the non-overlay card and isolate its pointer events from the drag listeners.

**Contract**: Menu trigger is an icon button (`lucide-react` `MoreVertical`/`Ellipsis`) positioned in the card corner; `onPointerDown` stops propagation so the drag sensor doesn't engage. Local state tracks which dialog is open. The menu + dialogs render only when not `isOverlay` (overlay stays a plain body). `cn()` for class merging; button uses existing `Button` variants.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Tests pass: `npm test`
- Generated `dropdown-menu.tsx` and `alert-dialog.tsx` exist under `src/components/ui/`

#### Manual Verification:

- Kebab menu opens without starting a drag; dragging the card still works
- Editing a field, saving, and reloading shows the new value; card stays in its column and its relative timestamp is unchanged
- Delete confirmation shows the correct wording per column; confirming removes the card; cancelling leaves it untouched
- The drag overlay shows no kebab menu
- No regressions to add-application or drag-drop status changes

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit / Integration Tests (Vitest, real Supabase — no client mocking):

- `updateApplication`: updates owned row; `last_action_at` unchanged on a field-only update.
- `deleteApplication`: deletes owned row; returns false for non-existent.
- PATCH full-update happy path + 422 on invalid (`source: ""`) + 404 on missing id.
- DELETE happy path + 404 on second delete / missing id.
- **RLS isolation**: user A's PATCH and DELETE against user B's application return 404 and leave B's row intact.

### Manual Testing Steps:

1. On the board, open a card's kebab → Edytuj, change company/position, save → reload reflects the change; card unmoved, timestamp unchanged.
2. Open kebab → Usuń on a Zaaplikowano/Rozmowa card → confirm wording mentions archive warning → confirm → card gone.
3. Open kebab → Usuń on an Interesujące card → confirm wording is the FR-016 message → cancel → card remains.
4. Drag a card to another column → still works (PATCH status path intact).
5. Verify the drag overlay (mid-drag) shows no kebab.

## Migration Notes

None — UPDATE/DELETE RLS policies and the `last_action_at` trigger already exist; no schema change.

## References

- PRD requirements: `context/foundation/prd.md` (FR-005, FR-006, FR-016, FR-019; business logic on `last_action_at`)
- Existing form template: `src/components/board/AddApplicationDialog.tsx`
- Existing route + service pattern: `src/pages/api/applications/[id].ts`, `src/lib/services/applications.ts:20`
- Existing tests: `tests/http/patch-applications.test.ts`, `tests/integration/rls-applications.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — full update + delete

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — e645d80
- [x] 1.2 Linting passes: `npm run lint` — e645d80
- [x] 1.3 New + existing tests pass: `npm test` — e645d80
- [x] 1.4 Full-update, delete, 422, 404, and cross-user isolation tests present and green — e645d80

#### Manual

- [x] 1.5 PATCH field body updates fields without changing `last_action_at` — e645d80
- [x] 1.6 DELETE removes the row; second DELETE returns 404 — e645d80

### Phase 2: Extract shared ApplicationForm

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Tests pass: `npm test`

#### Manual

- [ ] 2.4 Add-application dialog looks and behaves exactly as before

### Phase 3: Edit + delete UI

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Tests pass: `npm test`
- [ ] 3.4 Generated `dropdown-menu.tsx` and `alert-dialog.tsx` exist under `src/components/ui/`

#### Manual

- [ ] 3.5 Kebab menu opens without starting a drag; dragging still works
- [ ] 3.6 Editing a field + reload shows new value; card unmoved, timestamp unchanged
- [ ] 3.7 Delete confirmation shows correct per-column wording; confirm removes card, cancel leaves it
- [ ] 3.8 Drag overlay shows no kebab menu; no regressions to add/drag-drop
