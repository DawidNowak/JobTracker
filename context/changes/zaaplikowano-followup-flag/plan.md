# S-08 Zaaplikowano Follow-up Flag Implementation Plan

## Overview

Applications in **Zaaplikowano** that have had no action (status change or note save) for **7 or more calendar days** should be visually flagged on the board as needing a recruiter follow-up. S-08 adds an on-card amber flag — **"Czas na follow-up z rekruterem"** — in the timestamp slot, plus a **"Napisz follow-up"** button that opens the existing card-detail/notes dialog so the user can write and save a follow-up note. This is PRD **US-02** / GitHub issue **#9**, the direct sibling of the shipped S-07 decision prompt.

## Current State Analysis

The board is a React `client:load` island (`KanbanBoard.tsx`) holding per-status columns of `ApplicationRow`. Every card already carries `last_action_at` as a DB-owned ISO string (bumped on status change or note insert via triggers). S-07 established the on-card gating pattern in `KanbanCard.tsx:110`: a `showPrompt` branch replaces the timestamp for stale Interesujące cards, with drag isolation via `onPointerDown` `stopPropagation`.

Everything S-08 needs already exists:

- **`isStale(iso, days, now?)`** (`src/lib/format.ts:34`) — calendar-day-correct, already unit-tested from S-07. The flag condition is `status === "Zaaplikowano" && isStale(last_action_at, 7)`.
- **Note-writing end-to-end** — `CardNotes.tsx` (add/edit/delete against `/api/applications/[id]/notes`) rendered inside `CardDetailDialog.tsx`. A note insert bumps `last_action_at` via the `application_notes_bumps_parent_last_action` trigger, and `CardDetailDialog` does `window.location.reload()` on close (`CardDetailDialog.tsx:16`), so a saved note naturally clears the flag on reload.
- **The detail dialog is already reachable** from `KanbanCard` via the `detailOpen` state and the "Szczegóły" dropdown item — S-08 adds a second trigger (the button) that flips the same `onDetailOpenChange?.(true)`.

## Desired End State

A Zaaplikowano card whose `last_action_at` is ≥ 7 calendar days old shows, in place of its relative-time text, an amber flag reading **"Czas na follow-up z rekruterem"** and a **"Napisz follow-up"** button. Clicking the button opens `CardDetailDialog` (notes already in view); the user writes a note, saves it, closes the dialog — the page reloads and the flag is gone (because `last_action_at` advanced). Fresh Zaaplikowano cards (< 7 days) and cards in other columns show the normal timestamp with no flag. Saving a note never changes the application's status.

### Key Discoveries:

- `isStale` already supports the 7-day threshold with no new date logic (`src/lib/format.ts:34`).
- S-07's card render already branches timestamp-vs-prompt (`KanbanCard.tsx:110`, `175-208`) — S-08 adds a third mutually-exclusive branch for the Zaaplikowano follow-up flag.
- `CardDetailDialog` reloads the window on close (`CardDetailDialog.tsx:13-18`), so the flag-clearing loop needs no board-state mutation — opening the dialog and saving a note is sufficient.
- Drag isolation pattern: buttons inside a draggable card call `e.stopPropagation()` in `onPointerDown` (`KanbanCard.tsx:125-127`, `182-184`) to avoid triggering dnd-kit.
- The PRD fixes the exact label: **"Czas na follow-up z rekruterem"** (`prd.md:96`), distinct from S-09's "Czas na follow-up po rozmowie".

## What We're NOT Doing

- No schema, migration, service, or API changes — `isStale`, the notes API, and the note UI all exist.
- No inline note editor on the card face — note-writing goes through the existing `CardDetailDialog`/`CardNotes`.
- No autofocus/scroll-to-notes behavior in the dialog — it opens as-is (notes already visible).
- No shared/parameterized `FollowUpFlag` component for S-09 yet — S-08 keeps the follow-up config local to `KanbanCard`; S-09 will refactor if a shared seam falls out naturally.
- No status change on note save (explicit US-02 constraint) — status is untouched.
- No business-day logic — that's S-09 (Rozmowa, 4 business days).
- No new unit test for the flag predicate — `isStale` boundaries are already covered.

## Implementation Approach

The flag is a client-side, computed-per-render signal — never persisted — exactly like S-07's prompt. In `KanbanCard`, introduce a small local notion of "which status gets a follow-up flag at which threshold with which label" (currently just Zaaplikowano → 7 → "Czas na follow-up z rekruterem"), compute `showFollowUp` alongside the existing `showPrompt`, and render a third mutually-exclusive branch in the timestamp slot: an amber badge + a "Napisz follow-up" button that opens the existing detail dialog. Because the dialog already reloads on close and note inserts already bump `last_action_at`, no board-state plumbing (no new callback through `KanbanColumn`/`KanbanBoard`) is required. Coverage is a Playwright e2e spec mirroring the S-07 decision-prompt spec.

## Critical Implementation Details

**State sequencing / branch exclusivity** — the three render states in the timestamp slot are mutually exclusive: S-07's `showPrompt` (Interesujące + stale-1d) and S-08's `showFollowUp` (Zaaplikowano + stale-7d) can never both be true because they gate on different statuses, but the render must still be an explicit `if / else if / else` (follow-up → prompt → plain timestamp) so a future status can't accidentally show two blocks.

## Phase 1: Follow-up Flag + Button

### Overview

Add the amber "Czas na follow-up z rekruterem" flag and "Napisz follow-up" button to stale Zaaplikowano cards, reusing the existing detail dialog for note entry.

### Changes Required:

#### 1. KanbanCard render

**File**: `src/components/board/KanbanCard.tsx`

**Intent**: Flag stale Zaaplikowano cards and give them a one-click path to write a follow-up note. Compute a `showFollowUp` signal next to the existing `showPrompt`, and render an amber badge + "Napisz follow-up" button in the timestamp slot when it's true. The button reuses the existing detail-dialog state, so no new callbacks are threaded through the board.

**Contract**:

- Add `const showFollowUp = application.status === "Zaaplikowano" && isStale(application.last_action_at, 7);` in `KanbanCardBody` (alongside `showPrompt` at `KanbanCard.tsx:110`). `isStale` is already imported.
- The timestamp slot (`KanbanCard.tsx:175-208`) becomes a three-way exclusive branch: `showFollowUp` → follow-up block; else `showPrompt` → existing prompt block; else → plain `relative` timestamp.
- Follow-up block: an amber flag label with text exactly `Czas na follow-up z rekruterem` (use an amber Tailwind token, e.g. `text-amber-700` / `bg-amber-50` pill or left-accent, merged via `cn()` — never manual string concat), and a `Button size="sm"` labeled `Napisz follow-up`. The button calls `e.stopPropagation()` in `onPointerDown` (drag isolation, mirroring `KanbanCard.tsx:182-184`) and `onClick={() => onDetailOpenChange?.(true)}`. Gate the button `disabled={isMutating}` for consistency with the prompt buttons.
- No change to `KanbanColumn`/`KanbanBoard`/props — the flag and button use only `application`, `isMutating`, and the existing `onDetailOpenChange`.
- The overlay render path (`isOverlay` → `KanbanCardBody` with no `showActions`) renders the whole follow-up block — label **and** button — unconditionally, exactly like the existing S-07 prompt block, which is NOT gated on `showActions` (`KanbanCard.tsx:175-208`) and whose Aplikuj/Pomiń buttons already render in the overlay as harmless no-ops (`onApply`/`onDeleteOpenChange` are `undefined`). Do the same here: `onDetailOpenChange?.(true)` is a safe no-op in the overlay because the prop is undefined, so no `showActions` branch is needed inside the block. This keeps the dragged flagged card consistent and avoids introducing a gating branch with no precedent in the file.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`

#### Manual Verification:

- A Zaaplikowano card with `last_action_at` ≥ 7 days old shows the amber "Czas na follow-up z rekruterem" flag and a "Napisz follow-up" button instead of the timestamp.
- A Zaaplikowano card < 7 days old shows the normal timestamp and no flag/button.
- Cards in Interesujące (stale) still show the S-07 decision prompt; cards in Rozmowa show only the timestamp — no regressions.
- Clicking "Napisz follow-up" opens the detail dialog with the note textarea visible; writing and saving a note then closing the dialog reloads the board and the flag is gone.
- The button does not initiate a drag; dragging the card body still works.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: E2E Coverage

### Overview

Add a Playwright e2e spec that drives the flag lifecycle, mirroring the S-07 decision-prompt spec.

### Changes Required:

#### 1. Follow-up flag e2e spec

**File**: `tests/` (new Playwright spec, sibling of the S-07 decision-prompt spec — follow the existing e2e directory layout and seeding helpers in `@tests/README.md`)

**Intent**: Verify the flag gating and the note-clears-flag loop against the running app, using the same authenticated-session + data-seeding approach the S-07 spec uses.

**Contract**: Seed one Zaaplikowano application with `last_action_at` set 7+ days in the past and one set "today". Assert: the stale card shows the "Czas na follow-up z rekruterem" flag and the "Napisz follow-up" button; the fresh card shows neither. Click "Napisz follow-up", write and save a note in the dialog, close it; after reload assert the flag is gone and the application is still in the Zaaplikowano column (status unchanged). Reuse the S-07 spec's seeding/auth helpers rather than inventing new ones.

**Note-save interaction (new — NOT covered by the S-07 spec, which never opens the dialog):** the decision-prompt spec is a valid template only for seeding, auth, and column scoping — the note-write half is new. Drive it explicitly:

1. Click the "Napisz follow-up" button to open `CardDetailDialog`.
2. Fill the notes `Textarea` (placeholder `Dodaj notatkę…`) and click the **button** named `Dodaj notatkę` (`CardNotes.tsx:167`). Scope by `getByRole("button", { name: "Dodaj notatkę" })` so it doesn't match the placeholder substring, and await the `POST /api/applications/[id]/notes` `201` response so the later assertion doesn't race the note insert / trigger.
3. Close the dialog. `CardDetailDialog.handleOpenChange` fires `window.location.reload()` on close (`CardDetailDialog.tsx:13-18`), so wrap the close in `Promise.all([page.waitForEvent("load"), <close>])` — mirror the reload-wait pattern the delete test uses at `tests/e2e/decision-prompt.spec.ts:92`, rather than asserting synchronously.
4. After the reload, assert the flag/button are gone and the card is still under the Zaaplikowano heading (status unchanged).

### Success Criteria:

#### Automated Verification:

- E2E spec passes: run the project's Playwright e2e command (see `@tests/README.md`)
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- The new spec is stable across two consecutive runs (no flaky client:load timing).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- None new — `isStale` boundary behavior is already unit-tested from S-07, and the flag condition is a one-line predicate over it.

### Integration / E2E Tests:

- Playwright spec: stale Zaaplikowano card is flagged; fresh one is not; "Napisz follow-up" opens the dialog; saving a note clears the flag on reload; status is unchanged.

### Manual Testing Steps:

1. Seed or age a Zaaplikowano application to ≥ 7 days since `last_action_at`; confirm the amber flag + button render.
2. Confirm a recent Zaaplikowano card shows the plain timestamp.
3. Click "Napisz follow-up", add a note, close the dialog; confirm reload clears the flag and status stayed Zaaplikowano.
4. Confirm S-07 Interesujące prompts and Rozmowa cards are unaffected.
5. Confirm the button doesn't start a drag.

## Performance Considerations

Negligible — one extra `isStale` call per card per render, same order as the existing S-07 `showPrompt` computation.

## Migration Notes

None — no schema or data changes.

## References

- PRD user story: `context/foundation/prd.md` → US-02 (`prd.md:60-70`), flag label at `prd.md:96`
- GitHub issue: #9 (`context/foundation/gh-issues-process.md:35`)
- Sibling implementation: `context/archive/2026-07-13-interesujace-decision-prompt/plan.md`
- Stale helper: `src/lib/format.ts:34`
- Card render pattern: `src/components/board/KanbanCard.tsx:110`, `175-208`
- Note UI: `src/components/board/CardNotes.tsx`, `src/components/board/CardDetailDialog.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Follow-up Flag + Button

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Unit tests pass: `npm run test`

#### Manual

- [ ] 1.4 Stale (≥ 7d) Zaaplikowano card shows amber flag + "Napisz follow-up" button instead of timestamp
- [ ] 1.5 Fresh (< 7d) Zaaplikowano card shows normal timestamp, no flag/button
- [ ] 1.6 No regression: Interesujące prompt (S-07) and Rozmowa cards render correctly
- [ ] 1.7 "Napisz follow-up" opens detail dialog; saving a note then closing reloads and clears the flag
- [ ] 1.8 Button does not initiate a drag; card body drag still works

### Phase 2: E2E Coverage

#### Automated

- [ ] 2.1 E2E spec passes (Playwright command per `@tests/README.md`)
- [ ] 2.2 Type checking passes: `npm run typecheck`
- [ ] 2.3 Linting passes: `npm run lint`

#### Manual

- [ ] 2.4 New spec is stable across two consecutive runs
