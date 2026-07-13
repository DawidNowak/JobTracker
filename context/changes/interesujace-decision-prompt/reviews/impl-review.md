<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: S-07 Interesujące Decision Prompt

- **Plan**: context/changes/interesujace-decision-prompt/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-07-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Aplikuj/Pomiń buttons not gated on `isMutating` (single-flight parity break)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/board/KanbanBoard.tsx:94; src/components/board/KanbanCard.tsx:51,92-107
- **Detail**: The drag path is single-flighted because `useDraggable({ disabled: isMutating || anyOpen })` (KanbanCard.tsx:51) blocks a new drag while a PATCH is in flight. The new `onApply` handler (KanbanBoard.tsx:94-125) faithfully mirrors `onDragEnd`'s snapshot→optimistic→PATCH→rollback flow, but has **no equivalent guard**: it does not early-return on `isMutating`, and `isMutating` is not threaded into `KanbanCardBody`, so the Aplikuj/Pomiń buttons cannot disable themselves. Consequences: (a) a double-click on Aplikuj can fire two PATCHes; (b) more importantly, an Aplikuj (or Pomiń) overlapping an in-flight drag-PATCH captures a `snapshot` that already reflects the first action's optimistic change — if the first PATCH then fails and rolls back to _its_ snapshot, the second action's optimistic move is lost and the board desyncs from the DB until reload. The window is narrow and self-heals on reload, so this is minor, not blocking.
- **Fix**: Restore single-flight parity — add `if (isMutating) return;` at the top of `onApply` (and `onDragEnd`), and/or thread `isMutating` into `KanbanCardBody` and set `disabled={isMutating}` on the Aplikuj/Pomiń buttons.
  - Strength: Matches the existing drag-path guard, closing the concurrent-optimistic-mutation desync class with a few-line change; no new machinery.
  - Tradeoff: `isMutating` must be threaded board→column→card→body for the button-disable variant (the early-return variant is a one-liner but leaves buttons visually active mid-flight).
  - Confidence: HIGH — the drag path already demonstrates the intended guard in this same component.
  - Blind spot: Haven't measured how often two mutations realistically overlap in practice; may be rare enough to defer.
- **Decision**: FIXED — added `if (isMutating) return;` guard to onApply and onDragEnd (KanbanBoard.tsx:55,95) and threaded `isMutating` into KanbanCardBody with `disabled={isMutating}` on both Aplikuj/Pomiń buttons (KanbanCard.tsx). typecheck + lint green.

### F2 — `isStale` day-delta uses fixed-ms division (DST off-by-one, untested)

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/format.ts:37
- **Detail**: `isStale` floors both dates to local midnight (correct) but computes the day delta as `Math.round((today - then) / 86_400_000)`. Across a DST transition the real span between two local midnights is 23h or 25h, giving 0.958/1.042 days — `Math.round` snaps both back to the correct integer, so the 1-day and 7-day thresholds are safe. The concern is purely theoretical (drift would need dozens of DST transitions inside one span, unreachable for these thresholds). Unit tests use DST-neutral July dates, so the transition path is untested.
- **Fix**: Acceptable as-is; optionally add one March/October boundary case to `tests/unit/format.test.ts` to lock the behavior, or compute the delta from civil date components if you want it bulletproof.
- **Decision**: SKIPPED — accepted as-is; `Math.round` keeps the 1/7-day thresholds correct across DST, benign for these thresholds.
