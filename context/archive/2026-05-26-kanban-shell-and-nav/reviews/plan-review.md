<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Kanban Shell and Nav

- **Plan**: `context/changes/kanban-shell-and-nav/plan.md`
- **Mode**: Deep
- **Date**: 2026-05-28
- **Verdict**: SOUND
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | PASS    |
| Plan Completeness     | PASS    |

## Grounding

9/9 paths ✓ (`src/layouts/Layout.astro`, `src/middleware.ts`, `src/components/Topbar.astro`, `src/lib/utils.ts`, `src/lib/validation/applications.ts`, `src/pages/dashboard.astro`, `src/pages/api/auth/signin.ts`, `src/components/ui/button.tsx`, `src/env.d.ts`), 3/3 symbols ✓ (`PROTECTED_ROUTES`, `applicationStatusValues`, `Astro.locals.user` typing), brief↔plan ✓. Progress↔Phase mechanical contract holds: Phase 1 maps 5/5, Phase 2 cleanly splits one combined manual bullet into 2.4+2.5 (no parser issue).

## Findings

### F1 — KanbanColumn slot vs. empty-state pattern is ambiguous

- **Severity**: ℹ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — #1 `KanbanColumn.astro` contract
- **Detail**: The contract states both "No prop or slot for cards in this slice (S-02 will add it)" _and_ "Use a `<slot />` placeholder so later slices need only a one-line edit." That's self-contradicting, and it leaves the empty-state ↔ slot interaction undefined: if the slot is added now and S-02 fills it with cards, will "Brak aplikacji" render alongside them? An implementer could reasonably ship either shape and S-02 inherits the footgun.
- **Fix**: Pick one in the plan. Either (a) ship without `<slot />` and have S-02 add the slot together with an empty-state guard (`Astro.slots.has("default") ? <slot /> : <p>Brak aplikacji</p>`), or (b) ship the slot now with that conditional already in place. Option (a) is leaner for S-01; option (b) gets closer to a true one-line S-02 edit.
- **Decision**: FIXED via Fix A — plan now explicitly states no `<slot />` in S-01 and pushes the slot + guard pattern to S-02.

### F2 — Phase 1 produces dead code until Phase 2 imports it

- **Severity**: ℹ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 — Success Criteria / Manual Verification
- **Detail**: Phase 1 builds files that nothing imports yet. `npm run build` will succeed because Astro doesn't compile unreferenced components — a typo in `AppNav` (e.g., a malformed `Astro.locals.user` access) could pass Phase 1's automated gate and only surface when Phase 2 wires it up. The Phase 1 manual checks (files exist, alias usage) don't catch behaviour either. Not wrong — just an honest limitation; Phase 1 is effectively staged dead code until Phase 2.
- **Fix**: Acknowledge in the plan (extend the existing "Implementation Note" with: "Phase 1 compile/runtime errors will only surface after Phase 2 imports the components — proceed directly to Phase 2 to validate"), or accept the risk and rely on Phase 2's full check.
- **Decision**: ACCEPTED — implementer will rely on Phase 2's full check.
