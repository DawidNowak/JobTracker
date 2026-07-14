<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: S-08 Zaaplikowano Follow-up Flag Implementation Plan

- **Plan**: context/changes/zaaplikowano-followup-flag/plan.md
- **Scope**: Phase 1 of 2, Phase 2 of 2 (full plan — both complete)
- **Date**: 2026-07-14
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 0 observations

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

### F1 — E2E note-save wait doesn't assert POST response status

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/followup-flag.spec.ts:52-57
- **Detail**: The plan's Phase 2 contract says to "await the `POST /api/applications/[id]/notes` `201` response." The spec awaits a response matching URL + `method() === "POST"` but never checks `res.status()` or `.ok()`. The sibling S-07 spec (`tests/e2e/decision-prompt.spec.ts:59`) does assert `expect(response.ok()).toBe(true)` on its analogous await. The notes POST endpoint can return 400/401/404/422/500, all of which still satisfy this predicate, so a failing note-save wouldn't be caught at the point of the actual bug — it would only surface indirectly and confusingly at the later flag-cleared assertion.
- **Fix**: Capture the awaited response and assert success, matching the S-07 convention:
  ```ts
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes(`/api/applications/${staleApp.id}/notes`) && res.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "Dodaj notatkę" }).click(),
  ]);
  expect(response.ok()).toBe(true);
  ```
- **Decision**: FIXED — captured the response and added `expect(notePostResponse.ok()).toBe(true)`; re-ran `npm run test:e2e -- tests/e2e/followup-flag.spec.ts` (1 passed) and `npm run typecheck` (0 errors).

## Notes

- Both plan-drift and safety/pattern sub-agents independently converged on F1 as the only substantive issue; everything else (three-way branch exclusivity, exact flag text via `cn()`, drag-isolation `onPointerDown`, `disabled={isMutating}`, overlay-path unconditional render, no prop/API/schema changes, e2e seeding/reload-wait patterns) matched the plan exactly.
- `disabled={isMutating}` on the new button is inherited from the S-07 pattern; it guards against opening the dialog mid-drag-mutation rather than double-submitting the note itself (that's independently guarded by `CardNotes`'s own `submitting` state) — not a bug, just worth knowing if the prop's purpose is questioned later.
- Automated verification re-run and confirmed green: `npm run typecheck` (0 errors), `npm run lint` (0 errors, 12 pre-existing warnings in unrelated `scripts/` files), `npm run test` (226 passed), `npm run test:e2e -- tests/e2e/followup-flag.spec.ts` (1 passed).
