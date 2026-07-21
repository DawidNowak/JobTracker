<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Landing Page Implementation Plan

- **Plan**: context/changes/landing-page/plan.md
- **Scope**: Phase 1 of 1 (full plan)
- **Date**: 2026-07-21
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Unplanned repo-wide disable of `@typescript-eslint/no-misused-promises` for all `.astro` files

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: eslint.config.js:80
- **Detail**: The commit added `"@typescript-eslint/no-misused-promises": "off"` to `astroConfig`, which applies to **every** `.astro` file — not just the page whose top-level `return Astro.redirect(...)` triggered the parser crash. This change is not in the plan (which explicitly listed its files: `Welcome.astro`, `index.astro`, `Topbar.astro`, `landing.test.ts`) and is not in "What We're NOT Doing". Turning a lint rule off repo-wide weakens the lint CI gate across the whole `.astro` surface. The rationale is genuine and well-documented in both the commit message and an inline config comment (astro-eslint-parser gives frontmatter no enclosing function, so the rule null-derefs/crashes — an inline `eslint-disable` comment can't suppress a rule that crashes during the AST walk, so a config-level opt-out is the realistic fix). The concern is the **breadth**, not the decision to opt out.
- **Fix A ⭐ Recommended**: Narrow the disable to a page-scoped override (a config block matching `src/pages/**/*.astro`, where top-level frontmatter `return`s actually occur) instead of the whole `.astro` glob.
  - Strength: Preserves `no-misused-promises` coverage for feature components under `src/components/**/*.astro` while still working around the parser crash where it happens; shrinks the gate's blast radius.
  - Tradeoff: Adds a second astro override block; if a future page-level component ever hits the same crash it would need to be added too.
  - Confidence: MED — the crash is tied to top-level `return` in page frontmatter, which is a `src/pages` idiom; components rarely `return` at top level, but this hasn't been exhaustively verified across the repo.
  - Blind spot: Haven't confirmed no existing `src/components/**/*.astro` file relies on the rule being off.
- **Fix B**: Keep the repo-wide disable, but record it in the plan as an addendum so the source of truth reflects the actual change surface.
  - Strength: Zero code churn; the rationale is already captured in-config; `no-misused-promises` has limited value in pure-SSR `.astro` (no React-style async event-handler surface).
  - Tradeoff: Leaves the gate weakened repo-wide; future `.astro` code loses the check silently.
  - Confidence: HIGH — the suite is green and the rule's practical yield in `.astro` is low.
  - Blind spot: A later `.astro` island or handler that would benefit from the rule won't be caught.
- **Decision**: FIXED via Fix A — moved the disable out of the repo-wide `astroConfig` into a new `astroPagesConfig` scoped to `src/pages/**/*.astro`; `npm run lint` re-run green (0 errors).

### F2 — Landing HTTP smoke assertion matches on the generic brand string "JobTracker"

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: tests/http/landing.test.ts:11
- **Detail**: The test asserts `body.toContain("JobTracker")`. The plan allowed "the JobTracker wordmark / a hero string", so this is within plan — but "JobTracker" is the app-wide brand token and would also appear on other rendered pages, so it weakly proves that the _landing_ specifically rendered. The status/`redirected` checks already carry most of the signal; a hero-specific string would make the body assertion prove the landing, not just "some page mentioning the brand".
- **Fix**: Additionally assert a hero-unique Polish string, e.g. `expect(body).toContain("Śledź swoje aplikacje o pracę")`.
- **Decision**: FIXED — added `expect(body).toContain("Śledź swoje aplikacje o pracę")` to `tests/http/landing.test.ts`; test re-run green.
