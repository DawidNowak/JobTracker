<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: S-09 Rozmowa Follow-up Flag Implementation Plan

- **Plan**: context/changes/rozmowa-followup-flag/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-07-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 0 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Unplanned global `playwright.config.ts` retries change

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: playwright.config.ts:11 (commit c88f002)
- **Detail**: Phase 3's commit bumps `retries: 0` → `retries: 1` for the _entire_ e2e suite, with a comment attributing it to `client:load` island hydration races. This file isn't mentioned anywhere in the plan (Changes Required, What We're NOT Doing, or References). The justification checks out — `tests/e2e/decision-prompt.spec.ts` and `tests/e2e/delete-application.spec.ts` already wrap the same click-before-hydration race in `toPass()` loops, so this is a known, pre-existing flake class, not a hidden regression being papered over. However, it's a blast-radius-widening change to shared test infra slipped into a feature commit with no plan documentation, and independent verification during this review shows it isn't fully sufficient: re-running the full suite reproduced a failure in `decision-prompt.spec.ts`'s "Aplikuj moves a stale card to Zaaplikowano" test on **both** the original attempt and the retry under 6-worker parallelism (it passed reliably with `--workers=1`), so the fix doesn't fully close the gap it targets.
- **Fix A ⭐ Recommended**: Document the change as an addendum — add a short note to the plan's References/Implementation Approach (or `change.md` Notes) recording the `playwright.config.ts` retries bump and its rationale, since it's already shipped and does provide a real (if partial) benefit for the pre-existing flake class.
  - Strength: Preserves already-working, evidence-backed infra without another PR; keeps the plan as an accurate record of what actually shipped.
  - Tradeoff: A global retry can still mask a rare regression that only fails once — real but small residual risk, and e2e is explicitly not a CI gate per AGENTS.md, which caps the blast radius.
  - Confidence: MED — good evidence the flake class is real and pre-existing, but this review's own rerun shows the fix doesn't fully solve it (failed on both attempts under load), so "document as sufficient" slightly overstates its effect.
  - Blind spot: Root cause (dev-server contention under parallel workers) isn't addressed by either fix option and wasn't investigated further here.
- **Fix B**: Revert to `retries: 0` and scope retry behavior per-spec via `test.describe.configure({ retries: 1 })` only where needed.
  - Strength: Keeps the global pass/fail signal crisp; a spec has to declare its own flakiness rather than raising blast radius suite-wide.
  - Tradeoff: Nearly every e2e spec already independently wraps this same race in `toPass()`, so per-spec scoping would touch most files for a race that appears to be nearly suite-wide — likely more churn for the same protection level, and this review's rerun suggests the underlying contention persists regardless of retry scoping.
  - Confidence: LOW — since the observed failure recurred even with the global retry active, neither option is verified to actually fix the root cause; this is a scope-discipline call, not a correctness one.
  - Blind spot: Haven't profiled why the dev server can't keep up under 6 parallel workers.
- **Decision**: FIXED via Fix A — documented as addendum in `context/changes/rozmowa-followup-flag/change.md` Notes.

### F2 — Inline status type instead of existing `ApplicationStatus` alias

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/board/KanbanCard.tsx:20
- **Detail**: The new `FollowUpFlag.status` field is typed as `(typeof applicationStatusValues)[number]`, derived inline from the const array. `src/lib/validation/applications.ts:9` already exports `ApplicationStatus` (`z.infer<typeof applicationStatusSchema>`) for exactly this purpose, and every other consumer in the codebase (`KanbanBoard.tsx`, `KanbanColumn.tsx`, `src/lib/services/applications.ts`) imports that named type rather than re-deriving it. The plan itself specified typing against `applicationStatusValues` "rather than `ApplicationRow["status"]`" but didn't call out the existing `ApplicationStatus` alias as the more idiomatic middle path.
- **Fix**: Replace `import { applicationStatusValues } from "@/lib/validation/applications"` with `import type { ApplicationStatus } from "@/lib/validation/applications"` and change `status: (typeof applicationStatusValues)[number]` to `status: ApplicationStatus` in the `FollowUpFlag` interface (KanbanCard.tsx:20).
- **Decision**: FIXED — swapped to `ApplicationStatus` import; `npm run typecheck` and `npm run lint` both clean.
