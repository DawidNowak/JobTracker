# E2E Suite Cleanup — Plan Brief

> Full plan: `context/changes/e2e-suite-cleanup/plan.md`

## What & Why

An audit of `tests/e2e/` against the `/10x-e2e` skill's principles found the suite largely compliant, but surfaced four pieces of drift: two files that violate the project's own "one test per file" rule, a locator/date helper duplicated five times (one copy dead code), an authorization boundary on the archive read pages that's manual-only, and an undocumented cleanup mechanism. This plan fixes all four.

## Starting Point

`tests/e2e/` has 6 spec files with strong fundamentals (role-based locators, no `waitForTimeout`, real DB assertions, per-test isolation via ephemeral users) but real drift: `decision-prompt.spec.ts` (3 tests) and `reject-application.spec.ts` (2 tests) both violate the stated one-test-per-file rule; a `column()` locator helper is copy-pasted in 5 places (including the suite's own "reference exemplar," `board-load.spec.ts`) with one copy entirely unused; and the `archive-view` feature (merged into `master` as PR #19 during this session) has an authorization boundary — 404 on another user's/an active/a random/a malformed id — that only a one-time manual pass ever verified.

## Desired End State

`tests/e2e/` holds 9 single-test files, all sharing one `column()`/`daysAgo()` helper pair from `tests/helpers/board-locators.ts`. `tests/http/archive-pages.test.ts` automatically proves the archive pages' auth-redirect and 404/ownership matrix. The cascade-cleanup mechanism is documented where a contributor would actually look. A closing pass confirms the whole directory still holds against the skill's 5 anti-patterns.

## Key Decisions Made

| Decision            | Choice                                                   | Why (1 sentence)                                                                                                   |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Multi-test files    | Split to conform to the stated rule                      | Removes a doc/code contradiction rather than special-casing the rule                                               |
| New HTTP test depth | Security-critical matrix only (redirect + 404/ownership) | Matches `test-plan.md`'s cost×signal principle; body-content assertions stay manual to avoid brittle copy-coupling |
| Phase order         | Coverage gap (Phase 1) before cleanup (Phases 2-4)       | The one fix that closes a real untested boundary should land even if later phases are cut                          |
| Final scope         | Add a closing anti-pattern re-verification phase         | Confirms the refactor didn't introduce a new instance of any of the 5 known agent-generated-test failure modes     |

## Scope

**In scope:**

- New `tests/http/archive-pages.test.ts` (auth-redirect + 404/ownership matrix)
- Splitting `decision-prompt.spec.ts` → 3 files, `reject-application.spec.ts` → 2 files
- Extracting `column()`/`daysAgo()` into `tests/helpers/board-locators.ts`, updating all 6 consuming files (incl. the exemplar `board-load.spec.ts`)
- Documenting cascade-cleanup in `fixtures.ts` + `AGENTS.md`
- A closing anti-pattern + one-test-per-file re-verification pass

**Out of scope:**

- Rewriting or tightening any existing test's assertions
- Response-body/content assertions on the new HTTP test
- A browser/Playwright test for the archive pages (they're pure SSR, no interactivity — HTTP-level is the right layer)
- Amending the "one test per file" rule itself

## Architecture / Approach

Five phases, ordered by risk: the one genuine coverage gap ships first and independently (Phase 1); the mechanical file split (Phase 2) happens before helper extraction (Phase 3) so each phase's diff stays focused — split first preserves local helper copies unchanged, extraction then replaces every copy (across old and newly-split files) in one pass; documentation (Phase 4) is independent; a closing re-verification (Phase 5) checks the whole directory against the skill's own checklist.

## Phases at a Glance

| Phase                          | What it delivers                                                     | Key risk                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1. Archive Pages HTTP Coverage | `tests/http/archive-pages.test.ts` — redirect + 404/ownership matrix | Redirect assertion must use `fetch`'s default `follow` mode, not `manual` (which returns an unreadable opaque response) |
| 2. Split Multi-Test E2E Specs  | 5 new single-test files replacing 2 multi-test files                 | Must preserve assertions byte-for-byte — this is a pure boundary split                                                  |
| 3. Extract Shared E2E Helpers  | `tests/helpers/board-locators.ts`; 6 files updated to import from it | Must correctly identify which split files actually call `column()` vs. only the date helper                             |
| 4. Document Cascade-Cleanup    | Comment in `fixtures.ts` + rule in `AGENTS.md`                       | None — doc-only                                                                                                         |
| 5. Final Re-Verification Gate  | Confirmed clean re-sweep of all 9 files                              | Low — no untouched file changes hands, so this is expected to confirm rather than find                                  |

**Prerequisites:** Local Supabase stack running (`npx supabase start`) and `.env.test` populated, per `tests/README.md`, for both the Vitest HTTP test (Phase 1) and the Playwright specs (Phases 2-3, 5).
**Estimated effort:** ~1 session across 5 phases — no architectural decisions remain; all technical facts (redirect behavior, exact 404 triggers, which files call `column()`) were verified against live code during planning.

## Open Risks & Assumptions

- Phase 1 assumes `fetch`'s default redirect-follow behavior in the Vitest/Node environment lands cleanly on `/auth/signin`'s `200` response; verified against `src/middleware.ts` but not yet run.
- None of the other phases carry open risk — they're mechanical, verified against the actual file contents during planning rather than assumed.

## Success Criteria (Summary)

- `tests/e2e/` has exactly 9 spec files, each with exactly one `test(` call.
- `tests/http/archive-pages.test.ts` passes and is part of `npm test` (the required CI gate).
- No duplicate `column()`/date-offset helper definitions remain anywhere in `tests/e2e/`.
- `npm run typecheck && npm run lint && npm test` all pass; `npm run test:e2e` passes locally.
