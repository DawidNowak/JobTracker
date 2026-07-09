<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Notes and Card Detail (S-06)

- **Plan**: context/changes/notes-and-card-detail/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-07-09
- **Verdict**: NEEDS ATTENTION → resolved (all warnings fixed during triage)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension           | Verdict                                      |
| ------------------- | -------------------------------------------- |
| Plan Adherence      | PASS                                         |
| Scope Discipline    | PASS                                         |
| Safety & Quality    | WARNING (F1 fixed)                           |
| Architecture        | PASS                                         |
| Pattern Consistency | WARNING (F4 fixed; F3 skipped)               |
| Success Criteria    | WARNING → PASS (F2: full suite re-run green) |

All 9 planned files matched their contracts with zero drift and zero scope
creep. The four highest-risk design decisions verified correct:
parseSourceHref shared (not duplicated); RLS/FK→404 catch in POST;
edit/delete skip board reload; anyOpen guard includes detailOpen.

## Findings

### F1 — Note load effect crashes the modal on any HTTP error response

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/board/CardNotes.tsx:39-45
- **Detail**: The mount GET read `data.notes` without checking `res.ok`. On a non-200 (e.g. 401 after session expiry) the body is `{ error: ... }`, so `data.notes` is undefined → `setNotes(undefined)` → `notes.length` at :170 throws → the modal white-screens. The `.catch` only handled network/parse errors.
- **Fix**: Added `if (!res.ok) throw new Error(...)` in the fetch `.then` so an error status routes into the existing catch/banner, mirroring the status-code gating in handleAdd.
- **Decision**: FIXED

### F2 — Test suite could not be verified green in this environment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: N/A (environment)
- **Detail**: Initial `npm run test` showed 53 failed / 169 passed, all in the provisionUser/cleanupUser helpers because Docker Desktop was down and local Supabase wasn't running — not a code regression.
- **Fix**: Started Docker Desktop + `npx supabase start`, re-ran `npm run test` → 222 passed / 222, including the notes-specific tests (PATCH/DELETE do not advance last_action_at, non-owner 404s).
- **Decision**: FIXED (verified green)

### F3 — Modal reloads the whole board on every close, even read-only opens

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/board/CardDetailDialog.tsx:13-18
- **Detail**: `handleOpenChange` calls `window.location.reload()` unconditionally on close, including pure views and edit/delete (which don't change last_action_at). Siblings reload only after a confirmed mutation. Plan.md:168 explicitly specified reload-on-close, so this is a deliberate plan decision, not drift.
- **Fix**: Track whether a note was added and reload only then.
- **Decision**: SKIPPED (plan-sanctioned; acceptable for MVP)

### F4 — Unused + duplicate note validation schemas

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/validation/applications.ts:42-48
- **Detail**: `applicationNoteBodySchema` and `applicationNoteUpdateSchema` were byte-identical; `applicationNoteCreateSchema` (with application_id) was referenced only in unit tests, not in any route.
- **Fix**: Collapsed to a single `applicationNoteBodySchema` used by both POST and PATCH routes; removed `applicationNoteUpdateSchema`, `applicationNoteCreateSchema`, and their types; repointed the unit test at `applicationNoteBodySchema`.
- **Decision**: FIXED

### F5 — Deleting a note while its edit textarea is open leaves stale edit state

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/board/CardNotes.tsx:84-140
- **Detail**: Mutations aren't optimistic, so there's no rollback bug. But if a note is deleted while its inline edit is open, a later Save hits 404 and only shows a banner; editingId can point at a removed row. Low probability, degrades gracefully.
- **Fix**: Clear editingId when the edited note disappears from the notes list.
- **Decision**: SKIPPED (low probability; already degrades gracefully)
