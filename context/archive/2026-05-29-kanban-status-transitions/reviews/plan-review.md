<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Kanban Status Transitions (S-05)

- **Plan**: context/changes/kanban-status-transitions/plan.md
- **Mode**: Deep
- **Date**: 2026-05-29
- **Verdict**: REVISE → SOUND after triage (all 3 findings fixed in plan)
- **Findings**: 1 critical · 1 warning · 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | FAIL    |

## Grounding

10/10 paths ✓ · `@dnd-kit/*` absent from `package.json` ✓ · `BEFORE UPDATE` trigger at `supabase/migrations/20260526123145_applications_schema.sql:118` confirmed ✓ · brief↔plan consistent ✓
Blast radius: `KanbanBoard.astro` consumed only by `dashboard.astro`; `KanbanColumn.astro` and `KanbanCard.astro` consumed only by their parents — three Astro deletions in Phase 2 are safe.

## Findings

### F1 — Progress section misses two Manual Verification bullets

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress section vs Phase 1 / Phase 3 Manual Verification
- **Detail**: The skill's mechanical contract requires every Success Criteria bullet under `#### Manual Verification:` to have a matching `- [ ] N.M …` entry in Progress. Two bullets are unmatched:
  - Phase 1 manual bullet at `plan.md:117` ("Same `id` does not exist as a route file for the GET / DELETE methods yet (those return Astro's default 405 / 404)") has no Progress entry — Phase 1 Manual stops at 1.8.
  - Phase 3 manual bullet at `plan.md:289` ("Drag Zaaplikowano → Rozmowa, then Rozmowa → Interesujące directly. Both work; both persist.") has no Progress entry — Progress jumps from 3.5 to 3.6.
- **Fix**: Add the missing entries to Progress:
  - Phase 1 Manual: `- [ ] 1.9 GET / DELETE on /api/applications/[id] return Astro's default 405 / 404 (no route file)` — or drop the observational note from Phase 1 Manual Verification if it isn't a check the implementer should perform.
  - Phase 3 Manual: `- [ ] 3.6 Multi-hop sequence Zaaplikowano → Rozmowa → Interesujące persists across reload`, renumbering subsequent items.
- **Decision**: FIXED — added 1.9 and inserted new 3.6, renumbered 3.6→3.7…3.11→3.12.

### F2 — Concurrent in-flight drops can stomp each other on revert

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 `onDragEnd` state machine (`plan.md:218–248`)
- **Detail**: The state machine captures `snapshot = applications` at the top of `onDragEnd` and, on failure, does `setApplications(snapshot)`. This assumes one PATCH in flight at a time. Realistic single-tab self-collision under a slow network:
  - t=0 drag A from Interesujące → Zaaplikowano (PATCH-A in flight; snapshot1 = state-before-A)
  - t=1 drag B from Zaaplikowano → Rozmowa (PATCH-B in flight; snapshot2 = state-after-A, before-B)
  - t=2 PATCH-A rejects (e.g., slow Supabase 5xx) → `setApplications(snapshot1)` wipes BOTH A's move AND B's move, because snapshot1 predates B as well.
    The user sees B's card silently teleport back to its original column with no banner about B at all, only the banner for A. PRD's single-user model justifies last-write-wins for tab-vs-tab; this is a different case.
- **Fix A ⭐ Recommended**: Single-flight — disable drag while a PATCH is in flight (`isMutating` flag); release on completion.
  - Strength: Trivial to add; one boolean; PRD's single-user model makes serializing drops acceptable UX. Mirrors `AddApplicationDialog`'s `submitting` flag (`AddApplicationDialog.tsx:51`).
  - Tradeoff: On slow networks the board feels less snappy; user perceives latency that optimistic UI would otherwise hide.
  - Confidence: HIGH — pattern already proven in the same codebase.
  - Blind spot: None significant.
- **Fix B**: Per-card snapshot — store `Map<cardId, snapshotSlice>` and on failure revert only that card's slice, not the whole board.
  - Strength: Lets multiple drops proceed in parallel; no perceived serialization.
  - Tradeoff: More state plumbing; revert logic gets non-trivial when the same card is dropped twice quickly.
  - Confidence: MEDIUM — correct but adds complexity for a non-PRD case.
  - Blind spot: Same-card double drop ordering not specified.
- **Decision**: FIXED via Fix A — added single-flight `isMutating` gate (Critical Implementation Details, KanbanBoard.tsx contract, useDraggable contract, pseudocode, Phase 3 manual verification 3.12).

### F3 — DragOverlay clone path leaves an implementation fork open

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, "Drag overlay content" (`plan.md:268–274`)
- **Detail**: Plan says "implement `KanbanCardClone` either as a prop on `KanbanCard` (`isOverlay?: boolean`) that skips the draggable wiring, or as a tiny inline clone. Either approach is fine." Leaving the choice open means `/10x-implement` has to invent it; the "must not call `useDraggable`" constraint is hard (duplicate id error), not stylistic.
- **Fix**: Pin the decision — extend `KanbanCard` with an `isOverlay?: boolean` prop that bypasses `useDraggable`. Reusing the same component keeps the visual identical without duplicating Tailwind class lists.
- **Decision**: FIXED — Phase 3 drag-overlay contract and `KanbanCard` contract updated to require `isOverlay?: boolean` that skips `useDraggable`.
