<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Reject to Archive

- **Plan**: context/changes/reject-to-archive/plan.md
- **Scope**: Phase 3 of 3 (full plan)
- **Date**: 2026-07-15
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

Automated gates re-run during review: `npm run typecheck` (0 errors), `npm run lint` (0 errors, only pre-existing `no-console` warnings in scripts), `npm test -- archive-applications rls-applications` (11/11 pass). Phase 3 E2E (`reject-application.spec.ts`) is local-only and not a CI gate; left as marked-complete (commit 82fa6f2), not re-run.

## Findings

### F1 — 422 fallback assumes the only non-archivable status is Interesujące

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/applications/[id]/archive.ts:37-42
- **Detail**: After `archiveApplication` returns null, the endpoint classifies the owned row: `archived_at !== null` → "już odrzucona", **else** unconditionally returns the „Interesujące" copy. This is correct today only because `applicationStatusValues` has exactly three members (`Interesujące`, `Zaaplikowano`, `Rozmowa`) — so an owned, non-archived row that failed the `status in (Zaaplikowano, Rozmowa)` filter can only be Interesujące. If a fourth status is ever added (e.g. „Oferta"), such a row would silently receive the wrong „Interesujące" message. The plan specified exactly these two branches, so the implementation faithfully matches intent; this is a latent coupling to the enum, not a current defect. Verified: the status enum has only three values (src/lib/validation/applications.ts:3), and the HTTP suite covers both live branches.
- **Fix**: Guard the fallback explicitly on `owned.status === "Interesujące"` and return a neutral message for any other unexpected state, or add a one-line comment documenting the three-status exhaustiveness assumption so a future enum change trips a review.
- **Decision**: DISMISSED — Intentional domain invariant. Interesujące is the only non-archivable status: if the candidate never applied for the position, there is nothing to archive. The three-status enum exhaustiveness is by design, so the fallback copy is correct. No code change.
