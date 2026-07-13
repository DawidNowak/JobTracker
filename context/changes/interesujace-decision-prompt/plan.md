# S-07 Interesujące Decision Prompt Implementation Plan

## Overview

Cards in the **Interesujące** column that have had no action for **≥ 1 calendar day** must show a decision prompt — **"Zdecyduj — aplikujesz?"** — on the board face, with two actions:

- **Aplikuj** — single click moves the card to **Zaaplikowano** (reuses S-05's `PATCH { status }` transition, optimistically).
- **Pomiń** — opens a confirmation dialog, then permanently deletes the card (reuses S-03's hard-delete path via the existing `DeleteApplicationDialog`, no archive entry).

This is the **first threshold slice** in the roadmap. Its lasting deliverable beyond the UI is a reusable **calendar-day threshold helper** (`isStale`) that S-08 (7-day, Zaaplikowano) and S-09 (4-business-day, Rozmowa) will consume.

## Current State Analysis

Verified against the live tree at commit `bca510b`:

- **No backend work needed.** Both endpoints, services, and the delete dialog already exist and do exactly what S-07 needs:
  - `PATCH /api/applications/[id]` (`src/pages/api/applications/[id].ts:12`) with `{ status: "Zaaplikowano" }` — the same call drag-drop makes.
  - `DELETE /api/applications/[id]` (`:53`) → `deleteApplication` (`src/lib/services/applications.ts:60-67`) — a real hard SQL delete, does **not** touch `archived_at`.
  - `DeleteApplicationDialog` (`src/components/board/DeleteApplicationDialog.tsx`) already renders S-07's exact required copy for Interesujące — _"Usunąć tę aplikację? Tej akcji nie można cofnąć."_ (`:22-23`) — verbatim.
- **`last_action_at` is DB-owned** (`supabase/migrations/20260526123145_applications_schema.sql:26`), advanced only by two triggers: `BEFORE UPDATE` on status change, and `AFTER INSERT` on `application_notes`. So "no action ≥ 1 day" = no status change **and** no note added since `last_action_at`. It arrives on the client as an ISO string (`src/lib/database.types.ts:75`), already present on every card.
- **No calendar-day / start-of-day logic and no date library exist.** The one time helper, `formatRelative` (`src/lib/format.ts:30`), buckets on **elapsed 24h** (`day = 86400s`, `:25`) — this is **wrong** for "calendar day" and must NOT be reused.
- **The board owns state and threads `isMutating` down** (`KanbanBoard.tsx:43,125` → `KanbanColumn.tsx:15,38` → `KanbanCard.tsx:21`), but **no action callback is threaded today** — optimistic Aplikuj requires new prop plumbing board→column→card.
- **Status-conditional rendering is an established pattern** (add-button only on Interesujące/Zaaplikowano, `KanbanBoard.tsx:127`).
- **Drag isolation pattern exists:** on-card triggers call `onPointerDown` stopPropagation (kebab at `KanbanCard.tsx:109`); the `anyOpen` flag disables the draggable (`:37,42`).
- **Test tooling:** Vitest with a **node** project (`tests/unit/**`, `tests/http/**`, `tests/integration/**`) plus Playwright e2e (`tests/e2e/*.spec.ts`). **There is no React Testing Library / jsdom harness** — no component-render tests exist. Board UI is verified via Playwright e2e (`tests/e2e/delete-application.spec.ts`).

## Desired End State

On the dashboard board, any Interesujące card whose `last_action_at` is ≥ 1 calendar day in the past displays the prompt text and two buttons in place of the muted relative timestamp. Clicking **Aplikuj** instantly moves the card to Zaaplikowano (rolling back with an error banner on failure). Clicking **Pomiń** opens the confirmation dialog and, on confirm, permanently removes the card and its DB row. Cards acted on within the last calendar day show the normal timestamp with no prompt. Adding a note (which bumps `last_action_at`) dismisses the prompt on next load.

Verify: seed an Interesujące card with `last_action_at` two days ago → prompt shows; Aplikuj moves it; Pomiń deletes it. `isStale` unit tests and the e2e spec pass; `npm run typecheck`, `npm run lint`, `npm run test` green.

### Key Discoveries:

- `src/lib/format.ts:30` — `formatRelative`'s injectable `(iso, now = new Date())` signature is the testability convention to mirror; its `day` bucket is elapsed-24h and must NOT be reused for calendar-day.
- `src/components/board/KanbanBoard.tsx:65-92` — the snapshot→optimistic-mutate→PATCH→rollback pattern (with `isMutating` single-flight) to replicate for Aplikuj, including the optimistic `last_action_at: new Date().toISOString()` rewrite (`:66,70`).
- `src/components/board/KanbanCard.tsx:94,159` — timestamp call site; the prompt replaces the `<p>{relative}</p>` at `:159`.
- `src/components/board/DeleteApplicationDialog.tsx:22-23` — Interesujące copy already matches S-07's Pomiń wording verbatim; open it unchanged.
- `tests/helpers/seed.ts:15-19` + `tests/e2e/fixtures.ts:30,71` — `seedApp(overrides)` accepts a `last_action_at` override via the admin client (no INSERT trigger overrides it), so a stale card can be seeded directly.
- `context/foundation/business-logic-notes.md:11-21` — thresholds 1/7/4; `requiresFollowUp` computed on-the-fly, never persisted.

## What We're NOT Doing

- No new API route, service method, schema change, or migration.
- No change to how `last_action_at` is computed or stored — S-07 is a pure consumer.
- No new date library.
- No copy change to `DeleteApplicationDialog`; the confirm button stays **"Usuń"** (label mismatch with the card's "Pomiń" verb is accepted for MVP).
- No business-day logic (that is S-09) — `isStale` handles calendar days only.
- No RTL/jsdom component-test harness; gating is covered by Playwright e2e instead.
- No caching/persistence of the stale flag — it is derived live on each render.

## Implementation Approach

Build the reusable calendar-day primitive first and lock its boundary contract with unit tests (Phase 1), since S-08/S-09 inherit it and the local-midnight logic is the only genuinely tricky part. Then add the on-card prompt and wire the two actions to their matching state idioms (Phase 2): Aplikuj mirrors the drag optimistic path (new `onApply` callback threaded board→column→card), Pomiń reuses the existing delete dialog. Finally, cover the board-level behavior with a Playwright e2e spec seeded with a stale card (Phase 3), matching how the repo already tests board UI.

## Critical Implementation Details

- **Calendar-day, not elapsed-24h.** `isStale` must floor both `last_action_at` and `now` to **local midnight** and compare the integer day delta with inclusive `>=`. An action at 23:00 yesterday is ≥ 1 calendar day old at 00:30 today (~1.5h elapsed). Client-side `Date` methods use the user's local timezone, which is what "calendar day" means to the user — this is the decisive reason the helper lives client-side.
- **Optimistic `last_action_at` rewrite.** Aplikuj must mirror `KanbanBoard.tsx:66,70` and set the moved card's `last_action_at` to `new Date().toISOString()` in the optimistic update, so the card lands in Zaaplikowano fresh (no phantom prompt) even before the server responds.
- **Drag isolation.** Both prompt buttons must `stopPropagation` on `onPointerDown` (like the kebab, `KanbanCard.tsx:109`) so a click never starts a dnd-kit drag. The Pomiń dialog already participates in `anyOpen`; ensure Aplikuj's in-flight state does not leave the card draggable mid-mutation (honor `isMutating`).

## Phase 1: Calendar-day threshold helper

### Overview

Add a reusable, timezone-correct `isStale` helper and lock its boundary behavior with unit tests. This is the primitive S-08/S-09 depend on.

### Changes Required:

#### 1. Threshold helper

**File**: `src/lib/format.ts`

**Intent**: Add a calendar-day staleness helper that S-07 (and later S-08/S-09) use to decide whether a card is idle past its threshold. Must compute calendar days via local-midnight boundaries, not elapsed time — deliberately distinct from `formatRelative`.

**Contract**: `export function isStale(iso: string, days: number, now: Date = new Date()): boolean`. Floors both `new Date(iso)` and `now` to local midnight (zero out hours/min/sec/ms), computes the integer difference in days, returns `dayDelta >= days`. Mirrors `formatRelative`'s injectable-`now` convention. Returns `false` for a future `iso`.

#### 2. Unit tests

**File**: `tests/unit/format.test.ts` (new; `tests/unit/**` is on the node vitest project)

**Intent**: Lock the calendar-boundary contract that downstream slices inherit, using injected `now` so tests are deterministic and timezone-stable.

**Contract**: Cases — same calendar day → `false`; 23:00 yesterday vs 00:30 today (days=1) → `true` (crosses at ~1.5h elapsed); exactly at the local-midnight boundary → `true` (inclusive `>=`); ~20h elapsed but same calendar day → `false`; multi-day (days=7) true/false pair for S-08 readiness; future `iso` → `false`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`

#### Manual Verification:

- Spot-check `isStale` boundary reasoning against `context/foundation/business-logic-notes.md:11-21` thresholds.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: On-card decision prompt + action wiring

### Overview

Render the prompt on stale Interesujące cards and wire Aplikuj (optimistic status move) and Pomiń (existing delete dialog).

### Changes Required:

#### 1. Thread the Aplikuj callback through the board

**File**: `src/components/board/KanbanBoard.tsx`

**Intent**: Add an `onApply(cardId)` handler that performs the same optimistic snapshot→mutate→PATCH→rollback flow as `onDragEnd`, moving the card from Interesujące to Zaaplikowano, and pass it down to columns/cards. Reuse the existing `error`, `isMutating`, and `readError` machinery.

**Contract**: New handler mirrors `onDragEnd` (`:54-92`): find card in `applications["Interesujące"]`, snapshot state, optimistically move to `Zaaplikowano` with `last_action_at` rewritten to `new Date().toISOString()`, set `isMutating`, `PATCH { status: "Zaaplikowano" }`, rollback + `setError` on failure. Pass `onApply` into each `<KanbanColumn>` (`:121-131`).

#### 2. Pass the callback through the column

**File**: `src/components/board/KanbanColumn.tsx`

**Intent**: Forward the `onApply` callback from board to each card without other behavior change.

**Contract**: Add `onApply?: (id: string) => void` to `Props` (`:8-13`); forward to `<KanbanCard>` (`:38`).

#### 3. Render the prompt and wire both actions

**File**: `src/components/board/KanbanCard.tsx`

**Intent**: On a stale Interesujące card, replace the relative timestamp with the decision prompt and two buttons. Aplikuj calls the threaded `onApply`; Pomiń opens the existing delete dialog via the current `deleteOpen` state.

**Contract**: Accept `onApply?: (id: string) => void` on `Props`/`CardBodyProps` and thread through `KanbanCardDraggable`. Compute `const showPrompt = application.status === "Interesujące" && isStale(application.last_action_at, 1)` (import `isStale` from `@/lib/format`). At the timestamp render (`:159`): when `showPrompt`, render an inline block — prompt text "Zdecyduj — aplikujesz?" + `<Button size="sm">Aplikuj</Button>` + `<Button size="sm" variant="outline">Pomiń</Button>`; otherwise render the existing `<p>{relative}</p>`. Aplikuj's `onClick` calls `onApply?.(application.id)`; Pomiń's `onClick` calls `onDeleteOpenChange?.(true)` (reusing the existing dialog at `:167-169`, unchanged). Both buttons stop `onPointerDown` propagation (pattern from `:109`). Style the block with existing card tokens (muted/neutral text, `text-xs`); do not introduce new color primitives.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Existing tests still pass: `npm run test`

#### Manual Verification:

- Seed/age an Interesujące card ≥ 1 calendar day → prompt shows in place of the timestamp; a fresh card shows the normal timestamp and no prompt.
- Aplikuj moves the card to Zaaplikowano instantly; on a forced server error the card rolls back and the banner shows.
- Pomiń opens the dialog with the correct Interesujące copy; confirm removes the card.
- Neither button starts a drag; dragging is suppressed while an action is in flight or the dialog is open.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: E2E coverage

### Overview

A Playwright spec that seeds a stale Interesujące card and drives both prompt actions, matching the repo's board-UI test pattern.

### Changes Required:

#### 1. Decision-prompt e2e spec

**File**: `tests/e2e/decision-prompt.spec.ts` (new)

**Intent**: Verify the prompt renders on a stale Interesujące card and that both actions work end-to-end against the running app and DB. Follow `tests/e2e/delete-application.spec.ts` structure (fixtures, web-first retry for the cold client:load island, admin DB assertions).

**Contract**: Use `seedApp({ status: "Interesujące", company, last_action_at: <ISO ~2 days ago> })`. Two tests: (a) **Aplikuj** — assert prompt + "Aplikuj" visible on the card, click, assert the card now sits under the Zaaplikowano column (and/or the prompt is gone), verify via `admin` that the row's `status === "Zaaplikowano"`; (b) **Pomiń** — click "Pomiń", scope the confirm to the `alertdialog` (both card menu and dialog can read "Usuń"), confirm with the reload-wait pattern (`Promise.all([page.waitForEvent("load"), ...])`), assert the card is gone and `admin` shows zero rows. Add a negative check that a freshly-seeded Interesujące card (default `last_action_at`) shows no "Aplikuj" button.

### Success Criteria:

#### Automated Verification:

- E2E spec passes: `npm run test:e2e` (or the project's Playwright invocation)
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Run the spec against a fresh dev server (per the e2e-browser playbook) and confirm no flakiness on the client:load island.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `isStale` calendar-boundary cases with injected `now` (see Phase 1 contract): same-day false, 23:00→00:30 crossing true, exact-midnight inclusive true, ~20h same-day false, 7-day pair, future false.

### Integration / E2E Tests:

- `tests/e2e/decision-prompt.spec.ts`: prompt visibility gate + Aplikuj (status move, DB assert) + Pomiń (delete, DB assert) + negative fresh-card check.

### Manual Testing Steps:

1. Seed an Interesujące card with `last_action_at` two days ago; load `/dashboard` → prompt replaces the timestamp.
2. Click Aplikuj → card moves to Zaaplikowano immediately; verify no phantom prompt on the moved card.
3. Force a PATCH failure (offline/devtools) → card rolls back, error banner shows.
4. Click Pomiń → dialog shows Interesujące copy; confirm → card and row gone.
5. Confirm a card acted on today shows no prompt; add a note to a stale card and reload → prompt dismissed.
6. Verify neither button initiates a drag.

## Performance Considerations

`isStale` is O(1) per card, called during render for Interesujące cards only — negligible. The flag is derived live (never cached), matching the `requiresFollowUp`-computed-on-the-fly convention, so there is no staleness/drift risk under optimistic updates.

## Migration Notes

None — no schema or data changes.

## References

- Related research: `context/changes/interesujace-decision-prompt/research.md`
- Business rules: `context/foundation/business-logic-notes.md:11-21`
- Roadmap slice: `context/foundation/roadmap.md:160-170`
- Optimistic pattern to mirror: `src/components/board/KanbanBoard.tsx:54-92`
- Delete-dialog reuse: `src/components/board/DeleteApplicationDialog.tsx:22-23`
- E2E pattern: `tests/e2e/delete-application.spec.ts`; seed override: `tests/helpers/seed.ts:15-19`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Calendar-day threshold helper

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Unit tests pass: `npm run test`

#### Manual

- [ ] 1.4 Spot-check `isStale` boundary reasoning against business-logic-notes thresholds

### Phase 2: On-card decision prompt + action wiring

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 Existing tests still pass: `npm run test`

#### Manual

- [ ] 2.4 Prompt shows on stale Interesujące card, hidden on fresh card
- [ ] 2.5 Aplikuj moves card optimistically; rolls back + banner on server error
- [ ] 2.6 Pomiń opens dialog with correct copy; confirm removes the card
- [ ] 2.7 Buttons don't start a drag; drag suppressed while action in flight / dialog open

### Phase 3: E2E coverage

#### Automated

- [ ] 3.1 E2E spec passes: `npm run test:e2e`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes: `npm run lint`

#### Manual

- [ ] 3.4 Spec runs against a fresh dev server without client:load flakiness
