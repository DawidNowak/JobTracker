<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Kanban Status Transitions (S-05)

- **Plan**: context/changes/kanban-status-transitions/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-05-29
- **Verdict**: APPROVED
- **Findings**: 0 critical | 1 warning | 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Summary

All 13 planned items verified as MATCH (drift agent). All 7 plan invariants hold (safety agent):

- PATCH body excludes `last_action_at` (DB trigger owns it) — `applications.ts:28`.
- Service scopes `.eq("user_id", userId)` defensively — `applications.ts:30`.
- Same-column drop short-circuits before snapshot — `KanbanBoard.tsx:59`.
- `isMutating` cleared in `.finally()` — `KanbanBoard.tsx:89-91`.
- Snapshot captured before mutating — `KanbanBoard.tsx:65`.
- PATCH validates UUID + auth before parsing body — `[id].ts:29,34`.
- Auth-first ordering (401 before parse) — `[id].ts:29-32`.

Automated checks: `npm run lint` clean; `npm run typecheck` clean (4 unrelated hints in `eslint.config.js`).

## Findings

### F1 — Unguarded cast of `over.id` to `ApplicationStatus`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/board/KanbanBoard.tsx:58
- **Detail**: `const to = event.over?.id as ApplicationStatus | undefined;` is a silent type contract. Safe today because every droppable is created from `applicationStatusValues.map(...)` on line 120, but a future droppable that isn't a status column (archive zone, trash target) would cause the optimistic mutation on lines 67-71 to dereference `applications[to]` for an undefined key and throw in the render path before the PATCH ever runs.
- **Fix**: After extracting `to`, add `if (!applicationStatusValues.includes(to as ApplicationStatus)) return;`. The tuple is already imported on line 40 — zero new imports.
  - Strength: Closes the silent-cast trap before any future droppable can trigger it; matches the defensive style used elsewhere (`.eq("user_id", userId)` in the service).
  - Tradeoff: One extra line for a scenario that doesn't exist today.
  - Confidence: HIGH — single call site, type-checked.
  - Blind spot: None significant.
- **Decision**: SKIPPED

### F2 — Duplicate `jsonResponse` / `formatXxxErrors` helpers across route files

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/applications/[id].ts; src/pages/api/applications/index.ts
- **Detail**: Both route files define their own inline `jsonResponse` helper and near-identical `formatXxxErrors`. Not actionable with only two routes — wait for the third (S-03 edit/delete) and lift to `src/lib/http.ts` then.
- **Fix**: Defer until a third API route lands.
- **Decision**: FIXED — lifted `jsonResponse` and `formatZodErrors(error, messageFor?)` to `src/lib/http.ts`; both routes now import. `formatApplicationErrors` in `index.ts` rewrapped around the shared base with the `source` override passed through `messageFor`. Lint + typecheck clean.

### F3 — Rollback-during-second-drag race is theoretically possible

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: src/components/board/KanbanBoard.tsx:65-91
- **Detail**: The `isMutating` single-flight gate disables drag-start, not drag-end. A card that was mid-drag at the moment `isMutating` flipped true could in theory complete and then be overwritten by snapshot rollback. In practice extremely unlikely — `PointerSensor` only emits drag-end on pointer release, and a card already being dragged cannot fire a _new_ drag-end mid-flight. Flagged for traceability if a future bug ever looks like "second move disappeared after first move failed."
- **Fix**: None needed; consider noting in the change epilogue if a paper trail is desirable.
- **Decision**: SKIPPED — paper trail lives in this review file.
