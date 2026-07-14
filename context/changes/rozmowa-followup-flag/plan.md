# S-09 Rozmowa Follow-up Flag Implementation Plan

## Overview

Applications in **Rozmowa** that have had no action (status change or note save) for **4 or more business days** (Monday–Friday; weekends excluded, no public holidays in MVP) should be visually flagged on the board as needing a follow-up after the interview. S-09 adds an on-card amber flag — **"Czas na follow-up po rozmowie"** — in the timestamp slot, plus a **"Napisz follow-up"** button that opens the existing card-detail/notes dialog. This is PRD **US-04** / **FR-012** / GitHub issue **#10**, the direct sibling of the shipped S-08 Zaaplikowano flag — differing only in the column, the label, and the business-day threshold.

The one genuinely new primitive is business-day staleness: the current `isStale()` helper is calendar-day only, and S-08 explicitly punted business-day math to S-09. S-09 adds `isStaleBusinessDays()` (with unit tests) and, now that two follow-up flags exist that differ only in `(status, predicate, label)`, extracts the shared follow-up render path into a small config — realizing the seam S-08 deferred.

## Current State Analysis

The board is a React `client:load` island (`KanbanBoard.tsx`) holding per-status columns of `ApplicationRow`. Every card carries `last_action_at` as a DB-owned ISO string, bumped on status change or note insert via triggers. `KanbanCard.tsx` currently renders the timestamp slot as a **three-way exclusive branch** (`KanbanCard.tsx:176-227`): `showFollowUp` (Zaaplikowano + calendar-7d, S-08) → `showPrompt` (Interesujące + calendar-1d, S-07) → plain relative timestamp.

Everything S-09 needs to reuse already exists:

- **`isStale(iso, days, now?)`** (`src/lib/format.ts:34`) — calendar-day-correct, unit-tested (`tests/unit/format.test.ts`). But it is **calendar-day only** — it cannot express the Rozmowa 4-business-day threshold. This is the new work.
- **The S-08 follow-up block** (`KanbanCard.tsx:176-193`) — an amber pill (`bg-amber-50 text-amber-700`) reading the flag label + a `Button size="sm"` "Napisz follow-up" that stops pointer propagation (drag isolation) and calls `onDetailOpenChange?.(true)`. Rozmowa's block is byte-identical except the label.
- **Note-writing end-to-end** — `CardNotes.tsx` inside `CardDetailDialog.tsx`. A note insert bumps `last_action_at` via the `application_notes_bumps_parent_last_action` trigger, and `CardDetailDialog` does `window.location.reload()` on close (`CardDetailDialog.tsx:13-18`), so a saved note clears the flag on reload — for free.
- **Status change clears the flag too** — a drag between columns (S-05) resets `last_action_at` and re-renders, so US-04's "or changing status" path already works without new UI.
- **The S-08 e2e spec** (`tests/e2e/followup-flag.spec.ts`) — the exact template for S-09's spec (seeding, auth via `./fixtures`, column scoping, note-clears-flag loop, reload-wait).

## Desired End State

A Rozmowa card whose `last_action_at` is ≥ 4 business days old shows, in place of its relative-time text, an amber flag reading **"Czas na follow-up po rozmowie"** and a **"Napisz follow-up"** button. Clicking the button opens `CardDetailDialog`; the user writes a note, saves it, closes the dialog — the page reloads and the flag is gone (because `last_action_at` advanced). A drag to another column also clears it (status change resets `last_action_at`). Fresh Rozmowa cards (< 4 business days) and cards in other columns show the normal timestamp with no flag. Saving a note never changes status. Zaaplikowano (S-08) and Interesujące (S-07) flags/prompts are unchanged.

### Key Discoveries:

- `isStale` is **calendar-only** (`src/lib/format.ts:34`, uses `startOfLocalDay` + a raw day delta) — a new `isStaleBusinessDays` is required; there is no reuse path.
- The counting convention is pinned by the PRD's own example (`prd.md:144`): a **Friday** interview fires on **Tuesday** at a naïve 4-_calendar_-day threshold having elapsed **2 business days** — i.e. business days elapsed = weekdays in the half-open interval `(startOfDay(then), startOfDay(now)]` (days strictly after the anchor day, through today, counting only Mon–Fri). Fri→Tue = {Sat,Sun,Mon,Tue} → 2. Fri→Thu = 4 → fires Thursday.
- The S-08 and (new) S-09 follow-up blocks differ only in `(status, predicate, label)` — a clean config seam (`FOLLOWUP_FLAGS`) that S-08 deliberately deferred (`context/archive/2026-07-13-zaaplikowano-followup-flag/plan.md:34`).
- `CardDetailDialog` reloads the window on close (`CardDetailDialog.tsx:13-18`), so the flag-clearing loop needs no board-state mutation — opening the dialog and saving a note is sufficient (same as S-08).
- Drag isolation pattern: buttons inside a draggable card call `e.stopPropagation()` in `onPointerDown` (`KanbanCard.tsx:184-186`).
- The PRD fixes the exact label: **"Czas na follow-up po rozmowie"** (`prd.md:96`, `prd.md:89`), distinct from S-08's "Czas na follow-up z rekruterem".

## What We're NOT Doing

- No schema, migration, service, or API changes — the notes API, triggers, and note UI all exist.
- No public-holiday awareness — explicitly out of MVP scope (`prd.md:144`, roadmap parking lot). Weekends (Sat/Sun) only.
- No inline note editor on the card face — note-writing goes through the existing `CardDetailDialog`/`CardNotes`.
- No new status-change affordance on the flag — US-04's "or changing status" path is already served by the existing drag-between-columns (S-05). The flag exposes only the "Napisz follow-up" button, matching S-08.
- No autofocus/scroll-to-notes behavior in the dialog — it opens as-is.
- No change to `isStale` or its tests — it stays calendar-only; `isStaleBusinessDays` is additive.
- No status change on note save (US-04 constraint) — status is untouched by the note path.
- No e2e coverage of the status-change-clears-flag path — that transition is already covered by S-05's tests; S-09's e2e mirrors S-08's note-clears-flag lifecycle.

## Implementation Approach

Two additive pieces plus a small refactor. **(1)** Add `isStaleBusinessDays(iso, n, now?)` to `src/lib/format.ts` as a sibling of `isStale`, with unit tests covering weekend-spanning boundaries. **(2)** In `KanbanCard`, replace the two hard-coded follow-up conditions with a single `FOLLOWUP_FLAGS` config — an array of `{ status, isStale: (iso, now?) => boolean, label }` — and compute the active follow-up entry by `find`. Render one shared follow-up block (amber pill + "Napisz follow-up" button) driven by that entry's label; the S-07 decision-prompt branch and the plain-timestamp branch are untouched. The Rozmowa entry uses `isStaleBusinessDays(iso, 4)` and the `"Czas na follow-up po rozmowie"` label; the Zaaplikowano entry uses `isStale(iso, 7)` and its existing label. **(3)** Add a Playwright spec mirroring the S-08 spec for Rozmowa. Because the dialog reloads on close and note inserts bump `last_action_at`, no board-state plumbing (no new callback through `KanbanColumn`/`KanbanBoard`) is required — exactly as in S-08.

## Critical Implementation Details

**Business-day counting convention** — `isStaleBusinessDays(iso, n, now?)` returns true when the number of business days elapsed since the local day of `iso` is `>= n`, where "business days elapsed" counts only Mon–Fri days in the half-open interval `(startOfDay(iso), startOfDay(now)]`. Anchor the implementation and tests on the PRD vector: a Friday `last_action_at` viewed the following **Tuesday** = **2** business days (not stale at n=4); the following **Thursday** = **4** (stale at n=4). Same-day and future timestamps return `< n` (not stale). Reuse the existing `startOfLocalDay` helper for the day-boundary normalization so behavior matches `isStale`.

**Branch exclusivity** — after the refactor, the timestamp slot renders exactly one of: the shared follow-up block (when `FOLLOWUP_FLAGS.find(...)` matches), else the S-07 `showPrompt` block, else the plain timestamp. Keep it an explicit `if / else if / else` so no card can show two blocks. The config statuses (Zaaplikowano, Rozmowa) and the prompt status (Interesujące) are disjoint, so the follow-up/prompt ordering is safe, but the structure must stay explicit.

## Phase 1: Business-day Staleness Helper

### Overview

Add `isStaleBusinessDays` to `src/lib/format.ts` and unit-test its weekend-spanning boundaries. This is the only genuinely new logic in S-09 and the highest-risk piece (off-by-one around weekends), so it lands first and standalone.

### Changes Required:

#### 1. Business-day staleness predicate

**File**: `src/lib/format.ts`

**Intent**: Provide a business-day-aware staleness predicate for the Rozmowa follow-up threshold, since `isStale` is calendar-only and cannot express "4 business days". Additive — `isStale` is untouched.

**Contract**: Export `isStaleBusinessDays(iso: string, businessDays: number, now?: Date): boolean`. Returns `true` when the count of Mon–Fri days in the half-open interval `(startOfLocalDay(iso), startOfLocalDay(now)]` is `>= businessDays`. Reuse the existing `startOfLocalDay` helper. Same-day and future `iso` return `false` (count is 0/negative). Signature mirrors `isStale` (positional `now` default `new Date()`) so it slots into the config the same way.

#### 2. Unit tests for the predicate

**File**: `tests/unit/format.test.ts`

**Intent**: Lock the business-day counting convention — especially weekend-spanning boundaries — before it drives the flag. Mirror the existing `describe("isStale", …)` structure and fixed-`now` style.

**Contract**: Add a `describe("isStaleBusinessDays", …)` block. Cover at least: the PRD Friday vector (Friday anchor → following Tuesday is `false` at n=4 (2 business days), following Thursday is `true` at n=4); a Monday anchor viewed the same week (e.g. Friday = 4 business days → `true` at n=4, Thursday = 3 → `false`); a weekend anchor (Saturday/Sunday) counting only subsequent weekdays; same-day returns `false`; a future timestamp returns `false`. Use fixed `now` dates with known weekdays (state the weekday in each test name/comment).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass (including the new `isStaleBusinessDays` block): `npm run test`

#### Manual Verification:

- Spot-check the Friday-interview scenario against a calendar: a Friday `last_action_at` is not flagged on the following Monday/Tuesday but is flagged by the following Thursday.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes live in the `## Progress` section at the bottom.

---

## Phase 2: Config-driven Follow-up Flag (Zaaplikowano + Rozmowa)

### Overview

Extract the follow-up render path in `KanbanCard` into a small `FOLLOWUP_FLAGS` config driving one shared block, and add the Rozmowa entry (business-day predicate + "Czas na follow-up po rozmowie"). Folds in the existing S-08 Zaaplikowano flag with no behavior change to it.

### Changes Required:

#### 1. Follow-up flag config + shared render branch

**File**: `src/components/board/KanbanCard.tsx`

**Intent**: Replace the hard-coded S-08 `showFollowUp` condition with a config-driven follow-up render path that covers both Zaaplikowano and Rozmowa, realizing the seam S-08 deferred. Add the Rozmowa entry using the new business-day predicate. No new callbacks are threaded through the board — the button reuses the existing detail-dialog state.

**Contract**:

- Define a module-level `FOLLOWUP_FLAGS` array of `{ status: (typeof applicationStatusValues)[number]; isStale: (iso: string, now?: Date) => boolean; label: string }`, with two entries. Type the `status` key against `applicationStatusValues` (imported from `@/lib/validation/applications`) rather than `ApplicationRow["status"]`: the DB column generates as `string` (`database.types.ts:80`), so the validation const is the only source that makes a typo'd status literal (e.g. `"Rozmowah"`) a compile error instead of a silently-never-matching entry.
  - `{ status: "Zaaplikowano", isStale: (iso, now) => isStale(iso, 7, now), label: "Czas na follow-up z rekruterem" }` (existing behavior, unchanged).
  - `{ status: "Rozmowa", isStale: (iso, now) => isStaleBusinessDays(iso, 4, now), label: "Czas na follow-up po rozmowie" }` (new).
- In `KanbanCardBody`, replace the existing `const showFollowUp = …` line with `const followUp = FOLLOWUP_FLAGS.find((f) => f.status === application.status && f.isStale(application.last_action_at));`. Import `isStaleBusinessDays` alongside the existing `isStale` import.
- The timestamp slot (`KanbanCard.tsx:176-227`) stays a three-way exclusive branch: `followUp` → shared follow-up block (renders `followUp.label` in the amber pill); else `showPrompt` → existing S-07 prompt block; else → plain `relative` timestamp. Reuse the exact amber pill + "Napisz follow-up" button markup already present for S-08 (label text comes from `followUp.label`); merge classes via `cn()`, never string concat.
- The button keeps `disabled={isMutating}`, `onPointerDown` `e.stopPropagation()` (drag isolation), and `onClick={() => onDetailOpenChange?.(true)}`.
- No change to `KanbanColumn`/`KanbanBoard`/props. The overlay render path (`isOverlay` → `KanbanCardBody` with no `showActions`) renders the whole follow-up block unconditionally, exactly as the S-08/S-07 blocks already do (`onDetailOpenChange?.(true)` is a safe no-op when the prop is undefined).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test`
- E2E suite passes, incl. the S-08 follow-up spec (`tests/e2e/followup-flag.spec.ts`) as this refactor's regression guard: `npm run test:e2e`

#### Manual Verification:

- A Rozmowa card with `last_action_at` ≥ 4 business days old shows the amber "Czas na follow-up po rozmowie" flag and a "Napisz follow-up" button instead of the timestamp.
- A fresh Rozmowa card (< 4 business days) shows the normal timestamp and no flag/button.
- No regression: Zaaplikowano stale cards still show "Czas na follow-up z rekruterem"; Interesujące stale cards still show the S-07 decision prompt.
- Clicking "Napisz follow-up" on a Rozmowa card opens the detail dialog; writing and saving a note then closing the dialog reloads the board and the flag is gone; the card is still in Rozmowa (status unchanged).
- Dragging a flagged Rozmowa card to another column clears the flag (status change resets `last_action_at`).
- The button does not initiate a drag; dragging the card body still works.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: E2E Coverage

### Overview

Add a Playwright e2e spec that drives the Rozmowa flag lifecycle, mirroring the S-08 follow-up-flag spec.

### Changes Required:

#### 1. Rozmowa follow-up flag e2e spec

**File**: `tests/e2e/rozmowa-followup-flag.spec.ts` (new — sibling of `tests/e2e/followup-flag.spec.ts`)

**Intent**: Verify the Rozmowa flag gating and the note-clears-flag loop against the running app, reusing the S-08 spec's seeding + auth + column-scoping helpers.

**Contract**: Adapt `tests/e2e/followup-flag.spec.ts` verbatim except:

- Seed the stale and fresh applications with `status: "Rozmowa"` (the S-08 spec seeds `"Zaaplikowano"`).
- Assert the flag text `"Czas na follow-up po rozmowie"` (not "…z rekruterem").
- Keep the stale seed at **8+ calendar days ago** (`eightDaysAgo()` as-is): 8 calendar days is always ≥ 4 business days regardless of the weekday the test runs, so the spec is weekend-stable without business-day arithmetic in the test.
- Assert the reloaded stale card is still under the **Rozmowa** heading (status unchanged) via the `column(page, "Rozmowa")` helper.
- Reuse the existing note-save interaction verbatim: fill `getByPlaceholder("Dodaj notatkę…")`, await the `POST /api/applications/[id]/notes` `201`, click `getByRole("button", { name: "Dodaj notatkę" })`, then `Promise.all([page.waitForEvent("load"), <Close click>])` for the dialog-close reload.

### Success Criteria:

#### Automated Verification:

- E2E spec passes: `npm run test:e2e` (see `@tests/README.md`)
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- The new spec is stable across two consecutive runs (no flaky client:load timing).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- New `describe("isStaleBusinessDays", …)` in `tests/unit/format.test.ts` — the PRD Friday vector, an intra-week Monday anchor, a weekend anchor, same-day, and a future timestamp. This is where business-day precision is guaranteed.

### Integration / E2E Tests:

- Playwright spec: stale Rozmowa card is flagged; fresh one is not; "Napisz follow-up" opens the dialog; saving a note clears the flag on reload; status stays Rozmowa.

### Manual Testing Steps:

1. Seed or age a Rozmowa application to ≥ 4 business days since `last_action_at`; confirm the amber "Czas na follow-up po rozmowie" flag + button render.
2. Confirm a recent Rozmowa card shows the plain timestamp.
3. Click "Napisz follow-up", add a note, close the dialog; confirm reload clears the flag and status stayed Rozmowa.
4. Drag a flagged Rozmowa card to another column; confirm the flag clears.
5. Confirm S-08 Zaaplikowano flags and S-07 Interesujące prompts are unaffected.
6. Confirm the button doesn't start a drag.

## Performance Considerations

Negligible — one extra predicate call per card per render (`FOLLOWUP_FLAGS.find` over 2 entries), same order as the existing S-08 `showFollowUp` computation. `isStaleBusinessDays` counts at most a small number of days for realistic card ages.

## Migration Notes

None — no schema or data changes.

## References

- PRD user story: `context/foundation/prd.md` → US-04 (`prd.md:85-96`), FR-012 (`prd.md:143-144`), Business Logic (`prd.md:166`), label at `prd.md:96`
- Roadmap slice: `context/foundation/roadmap.md:184-187`
- GitHub issue: #10 (`context/foundation/gh-issues-process.md:36`)
- Sibling implementation: `context/archive/2026-07-13-zaaplikowano-followup-flag/plan.md`
- Stale helper (calendar): `src/lib/format.ts:34`
- Card render pattern: `src/components/board/KanbanCard.tsx:176-227`
- S-08 e2e template: `tests/e2e/followup-flag.spec.ts`
- Note UI: `src/components/board/CardNotes.tsx`, `src/components/board/CardDetailDialog.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Business-day Staleness Helper

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — b4e4500
- [x] 1.2 Linting passes: `npm run lint` — b4e4500
- [x] 1.3 Unit tests pass (including new `isStaleBusinessDays` block): `npm run test` — b4e4500

#### Manual

- [x] 1.4 Friday-interview scenario spot-checked against a calendar (not flagged Mon/Tue, flagged by Thursday) — b4e4500

### Phase 2: Config-driven Follow-up Flag (Zaaplikowano + Rozmowa)

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck`
- [x] 2.2 Linting passes: `npm run lint`
- [x] 2.3 Unit tests pass: `npm run test`
- [x] 2.4 E2E suite passes, incl. S-08 follow-up spec as refactor regression guard: `npm run test:e2e`

#### Manual

- [x] 2.5 Stale (≥ 4 business days) Rozmowa card shows amber "Czas na follow-up po rozmowie" flag + "Napisz follow-up" button
- [x] 2.6 Fresh (< 4 business days) Rozmowa card shows normal timestamp, no flag/button
- [x] 2.7 No regression: Zaaplikowano (S-08) flag and Interesujące (S-07) prompt render correctly
- [x] 2.8 "Napisz follow-up" opens detail dialog; saving a note then closing reloads and clears the flag; status stays Rozmowa
- [x] 2.9 Dragging a flagged Rozmowa card to another column clears the flag
- [x] 2.10 Button does not initiate a drag; card body drag still works

### Phase 3: E2E Coverage

#### Automated

- [ ] 3.1 E2E spec passes: `npm run test:e2e`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes: `npm run lint`

#### Manual

- [ ] 3.4 New spec is stable across two consecutive runs
