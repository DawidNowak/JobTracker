<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Kanban Shell and Nav

- **Plan**: context/changes/kanban-shell-and-nav/plan.md
- **Scope**: All phases (1 & 2)
- **Date**: 2026-05-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence summary

- **Diff scope**: 8 source files in the planned set; `git diff e217c67^..cbe534a` shows no source files outside the plan, and `signup.ts`/`signout.ts` were not touched as required.
- **All 8 planned items MATCH** the plan's contracts (props, structure, copy, route paths, redirect change, middleware allowlist). The only extra is an `<h1>Archiwum</h1>` heading inside `archive.astro` — explicitly anticipated by the plan ("heading `Archiwum` and copy `Wkrótce...`").
- **Automated checks**: `npm run lint` → 0 errors, 2 warnings (both new, see F1); `npm run typecheck` → 0 errors; `npm run build` → success.
- **Safety/quality**: no injection, XSS, authn/authz, performance, or reliability issues identified. AppNav uses Astro's auto-escaping for `user.email`; middleware enforces protection on both routes; signout uses the existing POST-form pattern.
- **Pattern compliance**: `cn()` used as planned, `@/*` aliases throughout, conditional render `{user && ...}` (no non-null assertion), Polish strings verbatim, no `bg-cosmic` on authenticated surfaces (preserved on `index.astro`, `auth/signin.astro:9`, `auth/signup.astro:9`).

## Findings

### F1 — class={cn(...)} triggers astro/prefer-class-list-directive

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/app/AppNav.astro:20-21
- **Detail**: `npm run lint` reports two warnings on the new nav anchors:
  - `20:28  warning  Unexpected 'class' using expression. Use 'class:list' instead  astro/prefer-class-list-directive`
  - `21:26  warning  Unexpected 'class' using expression. Use 'class:list' instead  astro/prefer-class-list-directive`

  These are the only project-introduced lint warnings on the slice. The plan explicitly required `cn()` from `@/lib/utils` for class merging (citing AGENTS.md), but the project's own ESLint config prefers Astro's native `class:list` directive inside `.astro` templates. The rule lands as `warn` (not `error`), so lint "passes" in the success-criteria sense, but `AppNav.astro` is the first new file to surface this rule — worth setting precedent deliberately.

- **Fix A ⭐ Recommended**: Convert the two anchors to `class:list` with the same condition. Drop or pass the `linkBase/linkInactive/linkActive` strings as arrays to `class:list`.
  - Strength: Removes the only new lint warnings in this slice; matches Astro's idiomatic in-template directive; no runtime/visual change. AGENTS.md's `cn()` rule covers "class name merging" — `class:list` is the Astro-native equivalent inside templates, so the two coexist cleanly (React islands keep `cn()`).
  - Tradeoff: Two patterns coexist: `class:list` inside `.astro`, `cn()` inside `.tsx` — both idiomatic in their respective contexts but a small mental-model split.
  - Confidence: HIGH — this is the documented Astro recommendation and the project's lint config already encodes it.
  - Blind spot: AGENTS.md may have intended `cn()` to cover `.astro` too; worth a quick AGENTS.md addendum noting `class:list` as the in-template equivalent.
- **Fix B**: Leave as-is; suppress `astro/prefer-class-list-directive` in `eslint.config.js`.
  - Strength: Honors the literal text of the plan and AGENTS.md; one consistent API (`cn()`) everywhere.
  - Tradeoff: Disables an idiomatic Astro lint rule project-wide based on a single file; out of scope for this slice.
  - Confidence: MEDIUM — works, but changes shared config based on one occurrence.
  - Blind spot: Future slices (S-02+) may want the directive back when they add interactive class toggles inside columns.
- **Decision**: FIXED via Fix B — disabled `astro/prefer-class-list-directive` in `eslint.config.js` and added an AGENTS.md note. Project now unified on `cn()` everywhere (`.astro` + `.tsx`).

### O1 — Cosmic banner backdrop visible above neutral shell

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/layouts/AppShell.astro:13
- **Detail**: `Layout.astro` always renders `<Banner>` config-warning strips at the top of `<body>`. They sit above the `bg-neutral-50` container in AppShell, so when a config banner is shown the area above the nav inherits Layout's body styling, not the neutral surface Phase 1 decided on. Not a defect — Layout's contract is unchanged — but worth noting for visual QA on misconfig states.
- **Fix**: No action recommended. If banner visuals on authenticated pages become an issue, move the `bg-neutral-50` wrapper one level up (into `Layout`) or render banners inside `AppShell`.
- **Decision**: SKIPPED — only visible in misconfigured states; not worth structural change.
