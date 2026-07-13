<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Manual Add Application (S-02)

- **Plan**: context/changes/manual-add-application/plan.md
- **Mode**: Deep
- **Date**: 2026-05-29
- **Verdict**: REVISE → SOUND (after triage; all 5 findings fixed in plan)
- **Findings**: 1 critical · 2 warnings · 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | FAIL    |

## Grounding

8/8 paths ✓ (`src/types.ts` absent — plan acknowledges with a skip clause), 3/3 symbols ✓ (`applicationCreateSchema`, `applicationStatusValues`, `workModeValues`), brief↔plan ✓.

## Findings

### F1 — Progress section drops 3 Success Criteria bullets

- **Decision**: FIXED (Fix in plan — added 2.8 + 3.5, renumbered 3.5–3.10 → 3.6–3.11, appended 3.12)
- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress section (lines 355–406) vs Phase 2/3 Manual Verification
- **Detail**: The Progress↔Phase consistency rule (references/progress-format.md) requires every Success Criteria bullet to have a matching `- [ ] N.M <title>` in Progress. Three are missing:
  - Phase 2 Manual bullet #5 (line 218) — cross-user/read-isolation smoke; no `2.8` in Progress.
  - Phase 3 Manual bullet #2 (line 300) — "Clicking the Interesujące `+` opens a modal titled 'Nowa aplikacja w kolumnie Interesujące' with all seven fields visible. Cancel and Save buttons appear." Progress jumps from `3.4` (button presence) to `3.5` (empty-Źródło error).
  - Phase 3 Manual bullet #9 (line 307) — "console shows no React warnings". No Progress item.
    `/10x-implement` parses Progress strictly; these checks won't get tracked.
- **Fix**: Add three Progress entries to mirror the plan body:
  - Phase 2 § Manual: add `2.8 Cross-user read isolation: user B sees only own rows, never user A's`.
  - Phase 3 § Manual: insert `3.5 Clicking + opens modal with correct title, all 7 fields, Cancel + Dodaj buttons` (renumber existing `3.5–3.10` to `3.6–3.11`) and append `3.11 No React warnings in browser console`.

### F2 — Service-layer convention bypassed for both Supabase calls

- **Decision**: FIXED (Fix A — added Phase 1 § 6 service module; updated Phase 1 § 1 and Phase 2 § 1 to call `listActiveApplications` / `createApplication`)
- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 § 1 (`dashboard.astro` query) + Phase 2 § 1 (API route insert)
- **Detail**: AGENTS.md hard rule: `"src/lib/ — pure utility functions only (no Supabase calls, no domain logic); src/lib/services/ — functions that query Supabase or orchestrate domain operations"`. Both new Supabase calls in this plan live inline: `dashboard.astro` does the `select('*').is('archived_at', null)...`, and `/api/applications/index.ts` does the `insert(...).select('*').single()`. The same shapes are needed by S-03 (edit page query + update), S-04 (parser-driven create reuses create), S-05 (status change update), S-10/11 (archive list/read). Inlining now means three or four sites will copy them over the next slices.
- **Fix A ⭐ Recommended**: Extract to `src/lib/services/applications.ts` now (`listActiveApplications(supabase)`, `createApplication(supabase, input, userId)`).
  - Strength: Matches AGENTS.md verbatim; one place to add column selection (e.g. when `application_notes_count` joins appear in S-06); RLS contract documented once.
  - Tradeoff: ~30 lines of indirection for two callers today.
  - Confidence: HIGH — convention is explicit and the read/write shapes are stable across foreseeable slices.
  - Blind spot: None significant.
- **Fix B**: Stay inline; extract on the second caller (S-03).
  - Strength: Less new code in this slice; lets the abstraction shape itself when we know two real caller signatures.
  - Tradeoff: Drifts from AGENTS.md and forces a refactor PR in S-03 that touches files outside that slice's natural scope.
  - Confidence: MEDIUM — depends on whether S-03 is shaped the same way.
  - Blind spot: Plan/brief for S-03 not yet written.

### F3 — Form-state reset wiring not pinned to onOpenChange

- **Decision**: FIXED (Fix in plan — pinned reset to `onOpenChange` in the contract bullet)
- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 § 2 — `AddApplicationDialog.tsx`
- **Detail**: Plan says: "When the dialog closes (any path), reset `errors`, `bannerError`, `submitting`, and `form` so reopening starts fresh." The dialog has three close paths (Cancel button, Escape, outside-click) — only Cancel goes through implementer-owned `onClick`. Escape/outside-click only fire `onOpenChange(false)`. If reset is wired to Cancel only, those two paths leak stale state. Phase 3 Manual bullet #8 covers it ("the form state resets between opens"), but the contract doesn't pin the implementation site.
- **Fix**: In the Contract bullet that owns reset, name the hook explicitly: "Reset all four state slices inside the `onOpenChange` callback when `open` transitions to false, so all close paths share the reset. Cancel just calls `setOpen(false)`."

### F4 — `src/types.ts` described as existing but isn't

- **Decision**: FIXED (Fix in plan — rephrased § 5 header and contract to remove the contradiction)
- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 § 5
- **Detail**: Plan says "src/types.ts (already exists per AGENTS.md project structure)" — the file is not in the repo. The same bullet then says "Skip this file change if `src/types.ts` is missing", which contradicts the parenthetical and reads confusingly.
- **Fix**: Rephrase to "Create `src/types.ts` if absent; otherwise skip the alias and use inline `import type` at each call site."

### F5 — JSON POST inherits cookie auth without explicit CSRF note

- **Decision**: FIXED (Fix in plan — added CSRF posture line under Critical Implementation Details)
- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 § 1 — `POST /api/applications`
- **Detail**: First JSON write endpoint in the repo, cookie-authenticated, no CSRF token. Supabase SSR cookies default to `SameSite=Lax`, which blocks cross-site POST from a foreign origin in modern browsers — so the practical risk is low. But the plan doesn't note it, and S-03/S-04 will cement the same shape. A one-line acknowledgement saves a future reviewer the re-derivation.
- **Fix**: Under Critical Implementation Details, add a line — "CSRF: relies on Supabase auth cookies' default `SameSite=Lax` to block cross-origin POSTs; if cookie attributes ever change, revisit."
