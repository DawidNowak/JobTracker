# Kanban Status Transitions (S-05) Implementation Plan

## Overview

Land bidirectional drag-and-drop between the three active columns (Interesujące ↔ Zaaplikowano ↔ Rozmowa). A user picks up a card with the pointer, drops it on another column, and the card visibly relocates immediately; behind the scenes a `PATCH /api/applications/[id]` writes the new status and the existing `BEFORE UPDATE` trigger bumps `last_action_at` (FR-008's "recorded with a timestamp"). On failure the card snaps back to its origin and a banner explains the error. This slice introduces the repo's first row-mutating endpoint, the first React DnD surface, and converts the static Astro board into a React island so all draggables share one `DndContext`.

## Current State Analysis

- **Schema is ready.** `applications.status` is a `text` column constrained to the three enum values; the `BEFORE UPDATE` trigger at `supabase/migrations/20260526123145_applications_schema.sql:118` sets `NEW.last_action_at = now()` **only when** `OLD.status IS DISTINCT FROM NEW.status`. No migration is required for S-05.
- **Validation has the building blocks.** `applicationStatusSchema = z.enum(applicationStatusValues)` is already exported (`src/lib/validation/applications.ts:6`); `applicationUpdateSchema` (line 23) is broader than we need today but useful in S-03.
- **Service layer has the read; needs the update.** `src/lib/services/applications.ts` exports `listActiveApplications` and `createApplication`; no row-update function exists yet.
- **API surface has one POST.** `src/pages/api/applications/index.ts` is the only domain endpoint; it sets the repo's JSON envelope (`201 { application }`, `422 { errors }`, `5xx { error }`, `401 { error }`). There is no per-row route file yet.
- **Board is pure Astro today.** `src/pages/dashboard.astro:10-31` reads applications grouped by status and passes them to `KanbanBoard.astro`, which renders three `KanbanColumn.astro` children; `KanbanCard.astro` is server-rendered Astro with zero JS. The only React island on the board today is `AddApplicationDialog.tsx`, mounted `client:load` in each addable column header (`KanbanBoard.astro:20`).
- **Card face shows `created_at`.** `KanbanCard.astro:22` calls `formatRelative(application.created_at)` — for S-05 this becomes `last_action_at`, which is also the variable the follow-up flag slices (S-07/S-08/S-09) will read.
- **dnd-kit is not yet a dependency.** `package.json` does not include `@dnd-kit/*`.

## Desired End State

A signed-in user with at least one application in any active column can grab the card with the mouse, drag it across to another active column, and release. The card animates into the target column (optimistic move), the visible timestamp on the card immediately reads "przed chwilą", and a `PATCH` request lands on the server. Backward moves work identically (Rozmowa → Zaaplikowano, Zaaplikowano → Interesujące). Releasing on the origin column is a no-op (no network call). On a 4xx/5xx/network error the card snaps back to its origin and a dismissible red banner above the board explains the failure; on reload the board re-syncs from the server. Two-user RLS holds end-to-end: user B cannot PATCH user A's row even by guessing the id (RLS-scoped `eq("user_id", userId)` returns no row → 404). After this slice, the Astro `KanbanBoard.astro` / `KanbanColumn.astro` / `KanbanCard.astro` files are deleted; the same names exist as React `.tsx` components inside a single `KanbanBoard.tsx` `client:load` island.

### Key Discoveries:

- DB trigger means **the server never sets `last_action_at` from the API** — the migration owns the rule, and the optimistic UI mirrors it client-side by writing `new Date().toISOString()` to the local row (`supabase/migrations/20260526123145_applications_schema.sql:118`).
- dnd-kit's `DndContext` is a React context — every `useDraggable` and `useDroppable` must be a descendant of the **same** `DndContext` instance to participate in cross-column DnD. This forces the smallest viable island shape to be a board-level provider, not a per-card island.
- S-02's `AddApplicationDialog.tsx` reloads the page on success via `window.location.reload()` (the project's established post-success pattern). Inside a React board island it continues to work — reload causes a fresh server render and the island re-hydrates with fresh props.
- The `applicationStatusValues` tuple in `src/lib/validation/applications.ts:3` is also used as the droppable column ids, so the column-id type is reused from validation — no string-literal duplication.
- Within-column ordering is **not** in PRD scope; the board orders by `created_at DESC` server-side. We need `@dnd-kit/core` only, not `@dnd-kit/sortable` (deviation from the question label, captured here intentionally — install only what's used).

## What We're NOT Doing

- **Edit/delete flows (S-03)** — the PATCH endpoint exists but only the `status` field is accepted; the schema for general edits lands in S-03.
- **Drag handles, within-column reordering, multi-select drag** — single card, two clicks (pick up, drop).
- **Keyboard or touch DnD sensors** — pointer only (explicit user choice; keyboard-only users can't move cards in MVP; called out as a Risk).
- **Toasts** — banner-only error UX (avoids adding `sonner` / Radix Toast).
- **Targeted refetch of the affected row** — no GET-by-id endpoint; the post-success `last_action_at` value displayed is the client-clock timestamp, which is close enough for "przed chwilą" rendering and reconciles on next nav.
- **Optimistic concurrency / version columns** — last write wins; PRD's single-user-per-account model makes the race a tab-vs-tab quirk recoverable by reload.
- **Cross-column animation polish** — minimal `DragOverlay`; no spring/eased motion library.
- **Test scaffolding** — repo has no test framework (AGENTS.md hard rule); verification is curl + manual UI.

## Implementation Approach

Three sequential phases, each with its own verification surface:

1. **Phase 1 — server-only.** Ship the `PATCH /api/applications/[id]` endpoint, its service, and its status-only Zod schema. Verifiable via `curl` against a running dev server with a real authenticated cookie; no UI changes; old Astro board still renders. This is the first row-mutating endpoint in the repo and sets the precedent S-03 will extend.

2. **Phase 2 — port the board to React (no DnD yet).** Install `@dnd-kit/core`, create `KanbanBoard.tsx` / `KanbanColumn.tsx` / `KanbanCard.tsx` mirroring the Astro layout pixel-for-pixel, switch the visible card timestamp from `created_at` to `last_action_at`, replace the dashboard's Astro board with a single `<KanbanBoard client:load />` island, fold `AddApplicationDialog` in as a React child. After this phase the board looks and behaves identically to today's S-02 board; the only observable change is the timestamp source. This is a pure refactor whose verification is "nothing visibly broke".

3. **Phase 3 — wire DnD.** Add `DndContext` + `PointerSensor` at the board level, mark cards as `useDraggable`, mark columns as `useDroppable`, implement the `onDragEnd` state machine with optimistic move, same-column short-circuit, PATCH wiring, and snap-back-with-banner on failure. Drag visuals are minimal: a `DragOverlay` showing the card under the cursor and a subtle outline on the hovered column.

The phasing means: if Phase 2's refactor turns out flaky (e.g., AddApplicationDialog regresses), we catch it before any DnD code is in the picture; and Phase 3's complexity is purely interaction logic, not framework conversion.

## Critical Implementation Details

- **DB owns `last_action_at`.** The PATCH endpoint must **never** include `last_action_at` in the UPDATE statement. The trigger sets it from `now()` server-side; the API just changes `status`. The optimistic UI sets a client-side `Date.now()` copy purely for the visible timestamp until the next nav reloads the server value.
- **Status-only PATCH schema for S-05.** Use a narrow `applicationStatusUpdateSchema = z.object({ status: applicationStatusSchema })`. Do **not** reuse the broader `applicationUpdateSchema` yet — accepting other fields without UI for them invites a surprise mutation surface. S-03 will swap or widen the schema.
- **Defensive `user_id` filter in the service.** The `applications` UPDATE policy already gates by `auth.uid()`, but the service should still issue `.eq("id", id).eq("user_id", userId)` so that a wrong-id / wrong-user request 404s cleanly (`PGRST116` "no rows returned" → translate to 404) rather than producing an unclear RLS-rejected error.
- **One `DndContext` covers the whole board.** `KanbanBoard.tsx` must be the parent of all three columns and their cards — there is no way to make cross-column DnD work with three sibling islands. This is the architectural reason the board (not just the card) becomes a `client:load` boundary.
- **Optimistic move snapshot.** Capture the entire `applications` state object before mutating it. On error, `setState(snapshot)` restores both the source-column membership and the previous `last_action_at`. Do not try to patch fields back individually.
- **Same-column drop short-circuits before any state change.** Compare `active.data.current.from === over?.id` at the top of `onDragEnd` — if true, return immediately; do not snapshot, do not mutate, do not PATCH.
- **Single-flight: only one PATCH in flight at a time.** A board-level `isMutating` boolean is set `true` before the PATCH and cleared in `finally`. While true, `useDraggable({ disabled: isMutating })` prevents any card from being picked up. This avoids the snapshot-stomp where a slow PATCH-A reverts to a snapshot that predates a subsequent PATCH-B (single-tab self-collision under slow network). The pattern mirrors `AddApplicationDialog`'s `submitting` flag (`AddApplicationDialog.tsx:51`).
- **AddApplicationDialog continues to reload on success.** Inside the React tree it is a regular child component (no `client:load` directive — directives are only meaningful at the Astro→React boundary). Its `window.location.reload()` path is unchanged; reload re-renders dashboard.astro with fresh data and re-hydrates the React island.

## Phase 1: PATCH endpoint + service + schema

### Overview

Ship the server-side surface that the DnD code will call in Phase 3. Status-only, RLS-gated, with the established JSON envelope. The old Astro board still renders; this phase is invisible to UI users but fully verifiable via curl.

### Changes Required:

#### 1. Narrow status-update schema

**File**: `src/lib/validation/applications.ts`

**Intent**: Add a status-only schema and inferred type so the new endpoint can validate without admitting other fields. Keep `applicationUpdateSchema` untouched — it stays as the future home for S-03's general edit.

**Contract**: New named export `applicationStatusUpdateSchema = z.object({ status: applicationStatusSchema })` and `export type ApplicationStatusUpdate = z.infer<...>`. No changes to existing exports.

#### 2. Update service function

**File**: `src/lib/services/applications.ts`

**Intent**: Add `updateApplicationStatus` that updates a single row by id, scoped explicitly to `user_id`, returning the updated row. The function must distinguish "no row matched" (404 territory) from generic Supabase errors (500 territory) so the route can map them correctly.

**Contract**: `export async function updateApplicationStatus(supabase: Client, id: string, status: ApplicationStatus, userId: string): Promise<ApplicationRow | null>`. Returns `null` when no row matched `(id, userId)`; throws on Supabase error other than `PGRST116`. Implementation uses `.from("applications").update({ status }).eq("id", id).eq("user_id", userId).select("*").maybeSingle()`.

#### 3. PATCH route

**File**: `src/pages/api/applications/[id].ts` (new file)

**Intent**: First per-row API route in the repo. Validates the `id` path param as a UUID, validates the JSON body against the status-only schema, calls the service, maps the result to the established envelope. Mirrors the auth-first ordering S-02's impl review pinned (`401` before parsing).

**Contract**: `PATCH` handler exported uppercase per AGENTS.md. `export const prerender = false`. Status map:
- `401 { error: "Brak autoryzacji." }` when `context.locals.user` is missing
- `400 { error: "Nieprawidłowy identyfikator." }` when `params.id` is not a UUID
- `400 { error: "Nieprawidłowe żądanie" }` when JSON parse fails
- `422 { errors: { status: "..." } }` when the body fails the status schema
- `404 { error: "Nie znaleziono aplikacji." }` when the service returns `null`
- `500 { error: "Supabase nie jest skonfigurowany." }` when `createClient` returns `null`
- `500 { error: "Nie udało się zaktualizować aplikacji." }` on unexpected error
- `200 { application: <row> }` on success

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type-check passes: `npm run typecheck` (or `astro check` per scripts)
- Build passes: `npm run build`

#### Manual Verification:

- `curl -X PATCH http://localhost:4321/api/applications/<known-id> -H 'Content-Type: application/json' --cookie <session-cookie> -d '{"status":"Rozmowa"}'` returns `200` with the updated row whose `last_action_at` is newer than `created_at`.
- Same call with `-d '{"status":"Wrong"}'` returns `422` with `{ errors: { status: ... } }`.
- Same call without the session cookie returns `401`.
- Same call with a random UUID returns `404`.
- A second user's session cookie returns `404` for user A's row id (RLS-driven).
- Same `id` does not exist as a route file for the GET / DELETE methods yet (those return Astro's default 405 / 404).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the curl matrix above behaves as specified before starting Phase 2.

---

## Phase 2: Port board to React (no DnD wiring yet)

### Overview

Convert the three Astro board components into a single React island while preserving the exact visual layout and existing add flow. Switch the displayed timestamp source from `created_at` to `last_action_at`. No DnD behavior yet — the goal is a pure refactor whose only observable change is timestamp semantics.

### Changes Required:

#### 1. Install dnd-kit core

**File**: `package.json`

**Intent**: Add `@dnd-kit/core` so Phase 3 can wire DnD without an install step on the same diff. Skip `@dnd-kit/sortable` — within-column reordering is not in scope.

**Contract**: New `dependencies` entry `@dnd-kit/core` at a current stable major version (`^6.x`). No changes to other deps.

#### 2. React KanbanCard

**File**: `src/components/board/KanbanCard.tsx` (new file)

**Intent**: Faithfully reproduce `KanbanCard.astro` as a React component. Same Tailwind classes, same conditional rendering of "Link do oferty" / work-mode badge. The only behavioral delta is the timestamp source.

**Contract**: `export default function KanbanCard({ application }: { application: ApplicationRow })`. Renders the same `<article>` markup as the Astro version but calls `formatRelative(application.last_action_at)` instead of `application.created_at`. URL parsing logic for `sourceHref` is identical to `KanbanCard.astro:12-20`. No DnD hooks yet.

#### 3. React KanbanColumn

**File**: `src/components/board/KanbanColumn.tsx` (new file)

**Intent**: Reproduce `KanbanColumn.astro`'s layout (border container, title header, empty-state vs card-list body) as a React component. Accept the header action as a render prop / ReactNode so each addable column can host its `AddApplicationDialog`. No Droppable yet.

**Contract**: `export default function KanbanColumn({ title, applications, headerAction }: { title: string; applications: ApplicationRow[]; headerAction?: ReactNode })`. Empty-state shows "Brak aplikacji" identical to the Astro version. Cards render via the new React `KanbanCard`.

#### 4. React KanbanBoard (Phase 2 shape — no DnD)

**File**: `src/components/board/KanbanBoard.tsx` (new file)

**Intent**: Single client-side island that owns the board state and renders three React columns. In Phase 2 the state is a static mirror of the prop; Phase 3 will add mutation handlers. The `+` triggers are rendered as React children of the column's `headerAction` slot.

**Contract**: `export default function KanbanBoard({ applications }: { applications: Record<ApplicationStatus, ApplicationRow[]> })`. Maintains local `applications` state initialized from props (so Phase 3's mutations don't need an additional refactor). Renders three `<KanbanColumn />` instances in the order from `applicationStatusValues`. For Interesujące and Zaaplikowano passes an `<AddApplicationDialog targetStatus={status} />` as the `headerAction` prop (no `client:load` — it's a React child here).

#### 5. Dashboard wires the island

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the Astro `<KanbanBoard />` with the React `<KanbanBoard client:load />`; pass the same grouped applications object.

**Contract**: Import path changes from `@/components/board/KanbanBoard.astro` to `@/components/board/KanbanBoard.tsx`; the JSX uses `client:load`. The grouping logic in the frontmatter is unchanged.

#### 6. Remove obsolete Astro components

**Files**: `src/components/board/KanbanBoard.astro`, `src/components/board/KanbanColumn.astro`, `src/components/board/KanbanCard.astro`

**Intent**: Delete the three Astro components now superseded by their `.tsx` counterparts. Keeping them would create two sources of truth for the card face — when S-07's flag-rendering needs to update the card, only one version should exist.

**Contract**: Three file deletions. Grep for any remaining imports (there should be none after step 5).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type-check passes: `npm run typecheck`
- Build passes: `npm run build`
- No references remain to deleted files: `grep -r "KanbanCard.astro\|KanbanColumn.astro\|KanbanBoard.astro" src/` returns empty.

#### Manual Verification:

- The dashboard renders three columns with identical visual layout to S-02 (compare against a screenshot if available).
- Existing cards (created during S-02 testing) display in the correct columns by `status`.
- Card timestamps now reflect `last_action_at`. Verify by issuing a Phase-1 PATCH against an existing row and reloading the dashboard — the affected card's timestamp updates to "przed chwilą" (or the localized equivalent).
- The `+` button in Interesujące and Zaaplikowano headers still opens the add dialog; submitting still adds a card; modal still closes on success; banner still appears on error. Rozmowa still has no `+`.
- No React hydration warnings in the browser console.

**Implementation Note**: Pause here for manual confirmation that the board still looks and acts like S-02 (modulo the timestamp source) before starting Phase 3.

---

## Phase 3: Wire drag-and-drop with optimistic move + snap-back

### Overview

Make the cards draggable and the columns droppable. Implement the `onDragEnd` state machine: short-circuit same-column drops, optimistically move the card and update its `last_action_at`, fire the PATCH, and on failure snap back to the snapshot state and show a dismissible banner above the board.

### Changes Required:

#### 1. DnD context + pointer sensor at the board

**File**: `src/components/board/KanbanBoard.tsx`

**Intent**: Wrap the column row in a single `DndContext` configured with a `PointerSensor` (activation constraint of ~5px so accidental clicks don't initiate a drag) and the `onDragEnd` handler. Add board-level UI state for the in-flight error banner. Render a `DragOverlay` that shows the card under the cursor during drag.

**Contract**: New imports from `@dnd-kit/core`: `DndContext`, `DragOverlay`, `PointerSensor`, `useSensor`, `useSensors`, `DragEndEvent`, `DragStartEvent`. New local state: `applications` (already there from Phase 2), `error: string | null`, `activeDragId: string | null` (drives `DragOverlay`), `isMutating: boolean` (single-flight gate — true while a PATCH is in flight). `onDragStart` stores the active card id; `onDragEnd` runs the state machine described below. The `isMutating` flag is passed down to columns/cards so `useDraggable({ disabled: isMutating })` prevents a second drop while the first PATCH is still resolving. Error banner renders above the column flex row when `error` is non-null, with a dismiss button that clears it.

**Contract (drag-end state machine)**: pseudocode for the non-obvious ordering, since the snapshot/PATCH/revert sequence matters:

```ts
function onDragEnd(event: DragEndEvent) {
  const from = event.active.data.current?.from as ApplicationStatus | undefined;
  const to = event.over?.id as ApplicationStatus | undefined;
  if (!from || !to || from === to) return;          // same-column / no-drop short-circuit

  const snapshot = applications;
  const card = applications[from].find(c => c.id === event.active.id);
  if (!card) return;
  const movedAt = new Date().toISOString();
  setApplications({
    ...applications,
    [from]: applications[from].filter(c => c.id !== card.id),
    [to]:   [{ ...card, status: to, last_action_at: movedAt }, ...applications[to]],
  });

  setIsMutating(true);                              // single-flight gate: cards can't be picked up while in flight
  fetch(`/api/applications/${card.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: to }),
  }).then(async (res) => {
    if (!res.ok) {
      setApplications(snapshot);
      setError(await readError(res));
    }
  }).catch(() => {
    setApplications(snapshot);
    setError("Brak połączenia. Spróbuj ponownie.");
  }).finally(() => {
    setIsMutating(false);
  });
}
```

(This is the one snippet in the plan — the ordering "snapshot before mutate, revert before banner" and the optimistic-`last_action_at` write are exactly the things that would otherwise be reinvented wrong.)

#### 2. Draggable card

**File**: `src/components/board/KanbanCard.tsx`

**Intent**: Make the card a draggable handle. Pass the source column id via `data.current.from` so `onDragEnd` doesn't need a separate lookup. Hide the card visually while it's being dragged (the `DragOverlay` shows a clone).

**Contract**: `KanbanCard` accepts `application: ApplicationRow` and an optional `isOverlay?: boolean`. When `isOverlay` is true, the component returns the plain `<article>` without calling `useDraggable` (used by `<DragOverlay>` in `KanbanBoard.tsx` — see step 4). Otherwise it calls `useDraggable({ id: application.id, data: { from: application.status }, disabled: isMutating })` — the `isMutating` prop is passed down from `KanbanBoard.tsx` via `KanbanColumn.tsx` so a second drag cannot start while a PATCH is in flight (see Critical Implementation Details for the single-flight rationale). Apply the returned `attributes`, `listeners`, and `setNodeRef` to the `<article>`. When `isDragging`, set `opacity-0` (or `visibility-hidden` — the overlay renders the real one). Add a subtle cursor-grab style.

#### 3. Droppable columns

**File**: `src/components/board/KanbanColumn.tsx`

**Intent**: Make each column a drop target keyed by the status name (which doubles as the column id since `applicationStatusValues` is the canonical tuple). Visually highlight the column body when a draggable is over it.

**Contract**: Use `useDroppable({ id: title })` where `title` is the column's status. Apply `setNodeRef` to the column's outer `<div>`. Use the returned `isOver` flag to toggle a `ring-2 ring-blue-300` (or similar non-intrusive outline) class on the column body. The empty-state placeholder remains rendered when the list is empty so the drop area stays clickable even for empty columns (e.g., a fresh Rozmowa).

#### 4. Drag overlay content

**File**: `src/components/board/KanbanBoard.tsx`

**Intent**: Render the card under the cursor during a drag. Reuses `KanbanCard` but without the `useDraggable` wiring (a plain visual clone).

**Contract**: `<DragOverlay>{activeDragId ? <KanbanCard application={lookup(activeDragId)} isOverlay /> : null}</DragOverlay>`. `KanbanCard` accepts an optional `isOverlay?: boolean` prop; when true, it skips the `useDraggable` call (returning the plain `<article>` with no `attributes` / `listeners` / `setNodeRef`) so the overlay does not register a second draggable with the same id (which is a hard dnd-kit error). `lookup(activeDragId)` finds the card across all three columns of the current `applications` state.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type-check passes: `npm run typecheck`
- Build passes: `npm run build`

#### Manual Verification:

- With at least one card in Interesujące, drag it to Zaaplikowano. The card disappears from Interesujące, appears at the top of Zaaplikowano, and its timestamp reads "przed chwilą" (or localized equivalent).
- Reload the dashboard. The card stays in Zaaplikowano (server-persisted).
- Drag the same card back to Interesujące (backward move). Same behavior; reload preserves it.
- Drag Zaaplikowano → Rozmowa, then Rozmowa → Interesujące directly. Both work; both persist.
- Pick up a card and drop it on its own column. No network call fires (verify in DevTools Network); no flash; card stays where it was.
- With DevTools Network throttled to "Slow 3G", start a drag of card A → release on Zaaplikowano (PATCH-A in flight). Immediately try to drag card B. Cards cannot be picked up until PATCH-A resolves (single-flight gate); no snapshot stomp possible.
- With DevTools Network throttled to "Offline", drag a card to another column. The card snaps back to its origin within ~1s; a red banner above the board reads (e.g.) "Brak połączenia. Spróbuj ponownie." The banner's × button dismisses it; nothing else on the board changes.
- With DevTools Network set to send a 500 (e.g., by temporarily breaking the env), drag a card. Snap-back + banner with "Nie udało się zaktualizować aplikacji." or similar.
- The `BEFORE UPDATE` trigger ran on the database: query `select id, status, last_action_at, created_at from applications where id = <moved-card-id>` shows `last_action_at > created_at`.
- Two-user RLS check: log in as user B, attempt `curl -X PATCH ...` with user A's card id and B's cookie — receive 404, and user A's card remains untouched.
- No React hydration warnings, no DnD-related console errors during normal drag flow.

**Implementation Note**: Pause here for manual confirmation across the matrix above before closing the change.

---

## Testing Strategy

No automated test framework is configured in this repo (AGENTS.md hard rule). Verification is the success-criteria matrix in each phase plus the consolidated manual walk:

### Manual Testing Steps:

1. **Forward chain**: add a card to Interesujące → drag to Zaaplikowano → drag to Rozmowa. Reload between each step; each move persists.
2. **Backward chain**: from the Rozmowa card above, drag to Zaaplikowano, then to Interesujące. Reload between each step.
3. **Same-column drop**: pick up any card and release it back on its origin column. No PATCH in Network tab; no visible flash.
4. **Network failure**: Offline mode; attempt a drag; observe snap-back + banner; dismiss banner; come back online; drag works again.
5. **Server-side failure**: simulate a 500 (e.g., temporarily rename `SUPABASE_KEY` in `.dev.vars`); attempt a drag; observe snap-back + banner.
6. **Two-user RLS**: log in as user B; from the dev tools console, fire a PATCH against user A's card id with user B's cookie; expect 404. User A's row unchanged.
7. **DB-level audit**: after a sequence of moves, run `select created_at, last_action_at from applications where id = <id>` — `last_action_at` is monotonically more recent than `created_at` and bumps on each successful move.
8. **AddApplicationDialog still works**: open the `+` in Interesujące or Zaaplikowano, fill the form, submit. The page reloads and the new card appears at the top of the right column with timestamp "przed chwilą". Repeat for the other addable column.

## Performance Considerations

- The board is fully SSR'd; the React island hydrates with the same data. On a board with ~50 cards the hydration cost is well below the 500ms NFR on a typical desktop browser.
- The optimistic move avoids the full SSR round-trip that S-02's add flow incurs; the user-perceived latency of a status change is the local React state update (sub-frame) regardless of network conditions.
- A single PATCH per drop; no retry logic. The DB trigger runs in <1ms for a single-row update.

## Migration Notes

- No schema migration. The existing F-01 migration already defines `status`, `last_action_at`, and the `BEFORE UPDATE` trigger.
- No data backfill. Existing rows already have valid `last_action_at` values (defaulted to `now()` at insert time).
- The roadmap S-05 row in `context/foundation/roadmap.md` should flip from `proposed` to `done` when this slice ships — handled by `/10x-archive` at close time.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-05)
- Prior slice plans (write-path + schema precedent): `context/changes/applications-schema-and-rls/plan.md`, `context/changes/manual-add-application/plan.md`
- PRD business rules: `context/foundation/prd.md` §Business Logic (status transitions are unrestricted and bidirectional; `last_action_at` resets on status change)
- DB trigger: `supabase/migrations/20260526123145_applications_schema.sql:118`
- Existing endpoint envelope: `src/pages/api/applications/index.ts`
- Existing add island: `src/components/board/AddApplicationDialog.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: PATCH endpoint + service + schema

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 0c7a2c1
- [x] 1.2 Type-check passes: `npm run typecheck` (or `astro check`) — 0c7a2c1
- [x] 1.3 Build passes: `npm run build` — 0c7a2c1

#### Manual

- [x] 1.4 PATCH happy path returns 200 with updated row and bumped `last_action_at` — 0c7a2c1
- [x] 1.5 PATCH with invalid status body returns 422 with field-keyed errors — 0c7a2c1
- [x] 1.6 PATCH without session cookie returns 401 — 0c7a2c1
- [x] 1.7 PATCH with random UUID returns 404 — 0c7a2c1
- [x] 1.8 PATCH with user B's cookie against user A's id returns 404 (RLS) — 0c7a2c1
- [x] 1.9 GET / DELETE on `/api/applications/[id]` return Astro's default 405 / 404 (no route file) — 0c7a2c1

### Phase 2: Port board to React (no DnD wiring yet)

#### Automated

- [x] 2.1 Lint passes — a801964
- [x] 2.2 Type-check passes — a801964
- [x] 2.3 Build passes — a801964
- [x] 2.4 No references to deleted Astro board files remain in `src/` — a801964

#### Manual

- [x] 2.5 Dashboard renders three columns with identical layout to S-02 — a801964
- [x] 2.6 Existing cards appear in their correct columns by `status` — a801964
- [x] 2.7 Card timestamps reflect `last_action_at` (verify by PATCH + reload) — a801964
- [x] 2.8 `+` add flow still works in Interesujące and Zaaplikowano; Rozmowa has no `+` — a801964
- [x] 2.9 No React hydration warnings in the browser console — a801964

### Phase 3: Wire drag-and-drop with optimistic move + snap-back

#### Automated

- [x] 3.1 Lint passes
- [x] 3.2 Type-check passes
- [x] 3.3 Build passes

#### Manual

- [x] 3.4 Forward chain (Interesujące → Zaaplikowano → Rozmowa) works and persists across reload
- [x] 3.5 Backward chain (Rozmowa → Zaaplikowano → Interesujące) works and persists
- [x] 3.6 Multi-hop sequence Zaaplikowano → Rozmowa → Interesujące persists across reload
- [x] 3.7 Same-column drop is a no-op (no network call, no flash)
- [x] 3.8 Offline drag snaps the card back and shows a dismissible banner
- [x] 3.9 5xx drag snaps the card back and shows a dismissible banner
- [x] 3.10 DB shows `last_action_at > created_at` after a successful move
- [x] 3.11 Two-user RLS PATCH check (user B → user A's card id) returns 404
- [x] 3.12 Single-flight: while a PATCH is in flight, no card can be picked up (verified with Slow 3G throttling)
- [x] 3.13 No React hydration or DnD console errors during a normal drag
