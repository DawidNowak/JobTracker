<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Auth Page Rework

- **Plan**: context/changes/auth-page-rework/plan.md
- **Scope**: Phase 2 of 2 (full plan — both phases complete)
- **Date**: 2026-07-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

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

### F1 — Header + min-h-screen produces a vertical scrollbar

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/AuthLayout.astro:14-20
- **Detail**: The layout stacks a `header` above a `flex min-h-screen items-center justify-center` centering div. Since `header height + min-h-screen` exceeds the viewport, the auth pages show a small vertical scrollbar even with minimal content. The original cosmic pages had only the `min-h-screen` centered card and no header, so no scrollbar. Purely cosmetic; the plan called for the header explicitly, so this is an accepted side effect, not drift. Flag only if a no-scroll centered look is desired.
- **Fix**: If a no-scroll centered look is wanted, change the centering wrapper height from `min-h-screen` to `min-h-[calc(100vh-Nrem)]` (subtracting the header height) or make the outer element a `flex min-h-screen flex-col` with the card area as the growing row.
- **Decision**: FIXED — wrapped header + centering row in `flex min-h-screen flex-col`; card area now grows via `flex-1` instead of its own `min-h-screen` (AuthLayout.astro).

## Notes (verified, no finding)

- **XSS on `?error=`**: safe. The query value flows `Astro.url.searchParams.get("error")` → `serverError` prop → `<ServerError message={...} />` rendered as JSX text at ServerError.tsx:13. JSX auto-escapes; no `dangerouslySetInnerHTML`/`innerHTML` anywhere in `src/components/auth/`.
- **`prerender`**: the migrated pages export no `const prerender`, matching the originals. Correct — the AGENTS.md `prerender = false` rule targets API routes; these SSR pages are server-rendered by default under `output: "server"`.
- **Redundant `cn()` on single static strings** (AuthLayout.astro:20-21): harmless and consistent with existing precedent (KanbanCard.tsx:142). Not a finding.
- **Automated success criteria**: `npm run typecheck` 0 errors · `npm run lint` 0 errors (12 pre-existing `no-console` warnings in `scripts/`, unrelated) · `npm test` 251 passed / 25 files · grep for cosmic/purple/English remnants clean (only allowed hit: the dark-button `text-white` + spinner `border-white/30 border-t-white` in SubmitButton.tsx).
- **Manual success criteria**: all Progress items checked with commit shas; each has supporting diff evidence (light classes, wordmark `<a href="/">`, Polish copy present). No rubber-stamping concern.
