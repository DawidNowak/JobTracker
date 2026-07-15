<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Archive View (S-11)

- **Plan**: context/changes/archive-view/plan.md
- **Scope**: All 3 phases (full plan review)
- **Date**: 2026-07-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Notes-load failure silently renders as "Brak notatek."

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/archive/[id].astro:24-27
- **Detail**: `application = row` is assigned _before_ `listNotes` is awaited, both inside the same `try`. If `getOwnedApplication` succeeds (archived row found) but `listNotes` throws, `application` is already set, the `catch` only logs, and the page renders the full detail card with `ReadOnlyNotesList` showing "Brak notatek." — a notes-load failure is silently misrepresented as "no notes." This is graceful degradation consistent with `dashboard.astro`'s render-partial-on-error philosophy, so it is not a defect — just a slightly misleading edge case.
- **Fix**: Fetch notes into a local first, then assign both together: `const row = ...; if (row?.archived_at) { const n = await listNotes(...); application = row; notes = n; }` — so a notes fetch failure falls through to the 404 path rather than rendering an empty-notes card. Optional; leaving as-is matches the dashboard pattern.
- **Decision**: FIXED — reordered so `listNotes` runs before `application` is assigned (src/pages/archive/[id].astro:25-27); a notes failure now falls through to 404.

### F2 — cn() wraps a single static class string

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/archive.astro:31
- **Detail**: `<ul class={cn("mt-6 flex flex-col gap-2")}>` wraps a single static string in `cn()`, which performs no merge or conditional resolution here. The adjacent `<a>` (line 36) and every element in `[id].astro` use plain `class="..."`. Harmless and not a violation of the "merge only via cn()" rule (there is nothing to merge), but inconsistent with its siblings.
- **Fix**: Change to plain `class="mt-6 flex flex-col gap-2"` to match adjacent markup.
- **Decision**: FIXED — replaced `cn(...)` with a plain `class` attribute and dropped the now-unused `cn` import (src/pages/archive.astro:5,30).
