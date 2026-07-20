# E2E Suite Cleanup Implementation Plan

## Overview

An audit of `tests/e2e/` against the `/10x-e2e` skill's principles (role-based locators, one-test-per-file, no `waitForTimeout`, risk-tied assertions, real-vs-mocked boundaries) found the suite is largely compliant, but surfaced four concrete pieces of drift: two files that violate the project's own "one test per file" rule, a locator/date helper duplicated across five files (one copy dead code), an untested HTTP-level authorization boundary on the archive read pages, and an undocumented cleanup mechanism in the shared fixtures. This plan fixes all four, closing the real coverage gap first.

## Current State Analysis

`tests/e2e/AGENTS.md` states "One test per file... each `*.spec.ts` is a single named risk," but `decision-prompt.spec.ts` holds 3 `test()` calls and `reject-application.spec.ts` holds 2 — both contradict the written rule.

A `column(page, name)` locator-scoping helper (working around `KanbanColumn` rendering a plain `<div>` with no landmark role) is duplicated in **5** places: `board-load.spec.ts` (as an inline closure — the file the suite's own docs call "the reference exemplar"), `decision-prompt.spec.ts`, `followup-flag.spec.ts`, `rozmowa-followup-flag.spec.ts`, and `reject-application.spec.ts` (defined but never called — dead code, confirmed via `grep`). A `twoDaysAgo()`/`eightDaysAgo()` date-offset helper is separately duplicated in 3 files with different names for the same shape of function.

Since the `archive-view` feature (list page `/archive` + detail page `/archive/[id]`) was merged into `master` as part of this session (PR #19), its authorization boundary — 404 on another user's id, an active (non-archived) application's id, a random UUID, and a malformed UUID — exists only as a manual-verification checklist item in the now-archived plan. No automated test exercises it, even though `tests/http/archive-applications.test.ts` already proves the analogous boundary for the archive **mutation** endpoint at the HTTP level, with no browser needed.

`fixtures.ts`'s `account` fixture cleans up by deleting the ephemeral user (`cleanupUser`), relying on `applications`' `ON DELETE CASCADE` from `auth.users` to remove seeded rows transitively. This is documented in `context/foundation/test-plan.md` §6.2 (for the Vitest integration suite) but not in `tests/e2e/AGENTS.md`, where a contributor writing a new spec would actually look.

## Desired End State

- `tests/e2e/` contains 9 spec files, each with exactly one `test()` call, matching the stated one-test-per-file rule.
- `column()` and a generic `daysAgo(n)` helper exist once each, in `tests/helpers/`, imported by every spec that needs them; the dead copy in `reject-application.spec.ts` is gone.
- `tests/http/archive-pages.test.ts` proves the auth-redirect and 404/ownership matrix for both archive pages via HTTP, without a browser.
- `tests/e2e/AGENTS.md` documents the cascade-cleanup mechanism; `fixtures.ts` carries a matching inline comment.
- A closing pass confirms the full suite still holds against the 5 anti-patterns from `references/e2e-anti-patterns.md` and the one-test-per-file rule.

Verification: `npm run typecheck && npm run lint && npm test` all pass; `npm run test:e2e` passes locally against the running app; `tests/e2e/` contains exactly 9 `*.spec.ts` files, each with exactly one `test(` call (`grep -c "^test(" tests/e2e/*.spec.ts` reads 1 for every file).

### Key Discoveries:

- `column()` is duplicated 5x, not 4x — `board-load.spec.ts:24-28` has its own inline closure form (`const column = (name) => ...`) that was missed in the initial audit; as the suite's stated "reference exemplar," it should use the shared helper too.
- `reject-application.spec.ts:6-11` defines `column()` but never calls it (verified via `grep -n "column(page" tests/e2e/reject-application.spec.ts` → no matches) — pure dead code to delete, not migrate.
- `/archive` and `/archive/[id]` are both prefix-matched by `PROTECTED_ROUTES` in `src/middleware.ts:4` — an unauthenticated request gets a **302 redirect to `/auth/signin`**, not a 401 or 404.
- `src/pages/archive/[id].astro:20-38` collapses every failure mode (bad UUID format, no matching row, row belongs to another user, row is not archived) to a single `Astro.response.status = 404` — no distinguishable status codes to test between them, matching the existing IDOR-guard pattern (`tests/http/patch-applications.test.ts`'s "assert exactly 404, never a range" convention).
- `getOwnedApplication` (`src/lib/services/applications.ts:108-124`) filters by `.eq("user_id", userId)` explicitly — ownership is enforced at the query layer, independent of RLS, same defence-in-depth pattern as Risk #5 in `test-plan.md`.

## What We're NOT Doing

- Not re-writing or tightening the assertions inside the split test files — this is a mechanical file-boundary split, not a content review.
- Not adding response-body assertions (list ordering, empty-state copy, full field rendering) to the new HTTP test — scoped to the auth/ownership boundary only, per the cost×signal principle in `test-plan.md` §1.
- Not adding a Playwright/browser test for the archive pages — both are pure SSR with no client-side interactivity ("no React island" per the archive-view plan), so an HTTP-level test gives the same signal for less cost.
- Not amending the "one test per file" rule in `AGENTS.md` — conforming the code to it instead.
- Not touching `board-load.spec.ts`'s or `delete-application.spec.ts`'s test bodies beyond the helper-import swap in Phase 3.

## Implementation Approach

Coverage gap first (Phase 1), independent of everything else, so the highest-value fix lands even if later phases are cut. Then the mechanical split (Phase 2) before the helper extraction (Phase 3), so each phase's diff stays focused — split preserves local helper copies as a pure file-boundary change; extraction then replaces every local copy (including the newly-split files and the exemplar) with a shared import in one pass. Documentation (Phase 4) is independent and low-risk. A closing re-verification pass (Phase 5) confirms the whole directory holds against the skill's own checklist after all the churn.

## Phase 1: Archive Pages HTTP Coverage

### Overview

Add HTTP-level coverage for the `/archive` and `/archive/[id]` authorization boundary, currently verified only by a one-time manual pass.

### Changes Required:

#### 1. Archive pages authorization test

**File**: `tests/http/archive-pages.test.ts` (new)

**Intent**: Prove, at the HTTP layer, that both archive pages redirect unauthenticated requests and that the detail page enforces ownership + archived-state independently of RLS — closing the gap where this was manual-only.

**Contract**: Follow the two-user provisioning shape already used in `tests/http/archive-applications.test.ts` (`createAdminClient`, `provisionUser`/`cleanupUser` for two users in `beforeEach`/`afterEach`, `signInAndCaptureCookies`, `seedApplication` for fixtures, `process.env.TEST_BASE_URL`). Cases, one `it()` each:

- `GET /archive` with no `Cookie` header → follows the redirect (default `fetch` behavior) and lands on `/auth/signin`.
- `GET /archive/{id}` with no `Cookie` header → same redirect assertion.
- `GET /archive/{id}` for the requester's own archived application → `200`.
- `GET /archive/{id}` for another user's archived application, using the requester's cookie → `404`.
- `GET /archive/{id}` for the requester's own **active** (non-archived) application → `404`.
- `GET /archive/{id}` for a random, non-existent UUID, with a valid cookie → `404`.
- `GET /archive/not-a-uuid`, with a valid cookie → `404`.

Use `redirect: "follow"` (the `fetch` default) for the two redirect cases, not `redirect: "manual"` — WHATWG's `manual` mode returns an opaque-redirect response (`status: 0`, `type: "opaqueredirect"`, headers not readable) for any redirect regardless of origin, so it can't assert the landing path. Assert via `res.redirected === true` and `res.url` ending in `/auth/signin` instead.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] New test passes in isolation: `npx vitest run tests/http/archive-pages.test.ts`
- [ ] Full test suite passes: `npm test`

#### Manual Verification:

- [ ] Confirm in a browser that `/archive/{a real archived id}` still renders correctly for its owner (the automated 200 check only proves the status code, not the rendered content).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 2: Split Multi-Test E2E Specs

### Overview

Conform `decision-prompt.spec.ts` and `reject-application.spec.ts` to the "one test per file" rule already stated in `tests/e2e/AGENTS.md`. Pure file-boundary split — each new file keeps its source test's body, imports, and any locally-duplicated helpers unchanged.

### Changes Required:

#### 1. Split `decision-prompt.spec.ts`

**Files**: `tests/e2e/decision-prompt-visibility.spec.ts`, `tests/e2e/decision-prompt-aplikuj.spec.ts`, `tests/e2e/decision-prompt-pomin.spec.ts` (new); `tests/e2e/decision-prompt.spec.ts` (deleted)

**Intent**: One file per risk — prompt visibility, the Aplikuj action, and the Pomiń action are three independently named risks currently sharing a file.

**Contract**: `decision-prompt-visibility.spec.ts` gets the "Interesujące card past the 1-day threshold shows the decision prompt..." test (source lines 15-37) plus the local `twoDaysAgo` helper it uses — no `column()` needed (unused by this test). `decision-prompt-aplikuj.spec.ts` gets the "Aplikuj moves a stale card to Zaaplikowano" test (lines 39-71) plus both local helpers (`column()`, `twoDaysAgo`) — it's the only one of the three that calls `column()`. `decision-prompt-pomin.spec.ts` gets the "Pomiń opens the delete dialog..." test (lines 73-101) plus the local `twoDaysAgo` helper — no `column()` needed. Each file keeps its own `import { test, expect } from "./fixtures"` and `import { waitForBoardHydration } from "../helpers/hydration"`.

#### 2. Split `reject-application.spec.ts`

**Files**: `tests/e2e/reject-application.spec.ts` (keeps the primary risk), `tests/e2e/reject-application-no-affordance.spec.ts` (new)

**Intent**: Separate the two currently-cohabiting risks — the reject flow itself, and the absence of a reject affordance on non-Zaaplikowano cards.

**Contract**: `reject-application.spec.ts` keeps its filename and the "rejects a Zaaplikowano card off the board and preserves its row archived" test (source lines 5-36). `reject-application-no-affordance.spec.ts` gets the "shows no reject affordance on an Interesujące card" test (lines 38-52). Neither file's local `column()` definition (lines 6-11) carries forward into either split file — it's unused by both tests (see Key Discoveries); drop it here rather than migrate it in Phase 3.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] Every file in `tests/e2e/` has exactly one `test(` call: `grep -c "^test(" tests/e2e/*.spec.ts` reads `1` for all 9 files
- [ ] Split specs pass: `npm run test:e2e -- tests/e2e/decision-prompt-visibility.spec.ts tests/e2e/decision-prompt-aplikuj.spec.ts tests/e2e/decision-prompt-pomin.spec.ts tests/e2e/reject-application.spec.ts tests/e2e/reject-application-no-affordance.spec.ts`

#### Manual Verification:

- [ ] No test behavior changed — each split file's assertions are byte-identical to its source test, just relocated.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 3: Extract Shared E2E Helpers

### Overview

Replace the 5 duplicated `column()` copies and 3 duplicated date-offset helpers with single, shared implementations, following the precedent `tests/helpers/hydration.ts` already sets for Playwright-specific helpers living in `tests/helpers/` rather than inside `tests/e2e/`.

### Changes Required:

#### 1. Shared board-column locator helper

**File**: `tests/helpers/board-locators.ts` (new)

**Intent**: One `column(page, name)` implementation, replacing the 4 remaining duplicated/near-duplicated copies (the 5th, in `reject-application.spec.ts`, was already dropped in Phase 2 as dead code).

**Contract**: Export `column(page: Page, name: string): Locator`, body identical to the existing duplicated implementation (`page.locator("div").filter({ has: page.getByRole("heading", { name }) }).last()`), carrying the explanatory comment about `KanbanColumn` rendering a plain `<div>` with no landmark role — moved here once instead of repeated at every call site.

#### 2. Shared date-offset helper

**File**: `tests/helpers/board-locators.ts` (same file)

**Intent**: One `daysAgo(n: number): string` implementation, replacing `twoDaysAgo()` (2 call sites, post-split) and `eightDaysAgo()` (2 call sites) with parameterized calls (`daysAgo(2)`, `daysAgo(8)`).

**Contract**: Export `daysAgo(n: number): string`, returning `new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()`.

#### 3. Update consuming specs

**Files**: `tests/e2e/board-load.spec.ts`, `tests/e2e/decision-prompt-visibility.spec.ts`, `tests/e2e/decision-prompt-aplikuj.spec.ts`, `tests/e2e/decision-prompt-pomin.spec.ts`, `tests/e2e/followup-flag.spec.ts`, `tests/e2e/rozmowa-followup-flag.spec.ts`

**Intent**: Replace each file's local `column`/`twoDaysAgo`/`eightDaysAgo` definition with an import from `tests/helpers/board-locators.ts`, and update call sites to the new signature/name.

**Contract**: Add `import { column, daysAgo } from "../helpers/board-locators";` (only the symbols each file actually uses); delete the local definitions; `board-load.spec.ts`'s closure-form calls (`column("Interesujące")`) become `column(page, "Interesujące")` to match the shared function's parameter list. No test assertions change.

### Success Criteria:

#### Automated Verification:

- [ ] Type checking passes: `npm run typecheck`
- [ ] Linting passes: `npm run lint`
- [ ] No duplicate helper definitions remain: `grep -rn "function column\|const column =\|twoDaysAgo\|eightDaysAgo" tests/e2e/*.spec.ts` returns no matches
- [ ] Full e2e suite passes: `npm run test:e2e`
- [ ] Full test suite passes: `npm test`

#### Manual Verification:

- [ ] None — this phase is a pure refactor with no user-visible behavior; automated verification is sufficient.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 4: Document the Cascade-Cleanup Mechanism

### Overview

Make the `account` fixture's cleanup mechanism (delete the user, rely on `ON DELETE CASCADE` to remove seeded rows) discoverable from `tests/e2e/`, not just from `test-plan.md` §6.2.

### Changes Required:

#### 1. Inline comment on the fixture

**File**: `tests/e2e/fixtures.ts`

**Intent**: Explain, at the point of definition, why `account`'s teardown only deletes the user and not any seeded rows.

**Contract**: A short comment above the `account` fixture (around line 55) noting that `cleanupUser` deleting the Supabase Auth user cascades to remove every `applications` row it owns (`ON DELETE CASCADE`), so `seedApp`'s rows never need explicit teardown.

#### 2. AGENTS.md rule

**File**: `tests/e2e/AGENTS.md`

**Intent**: Surface the same fact where a contributor writing a new spec will actually look, next to the existing "Per-test isolation" rule.

**Contract**: Extend the "Per-test isolation" bullet (or add a new one immediately after it) stating that `seedApp` rows need no manual cleanup — they're removed transitively when the `account` fixture deletes its ephemeral user.

### Success Criteria:

#### Automated Verification:

- [ ] Linting passes: `npm run lint`
- [ ] Full test suite passes: `npm test`

#### Manual Verification:

- [ ] `tests/e2e/fixtures.ts` and `tests/e2e/AGENTS.md` both read clearly to someone who hasn't seen `test-plan.md` §6.2.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Phase 5: Final Re-Verification Gate

### Overview

Re-check the full, now-9-file `tests/e2e/` directory against the `/10x-e2e` skill's 5 anti-patterns and the one-test-per-file rule, as a closing gate on the whole change.

### Changes Required:

#### 1. Anti-pattern + rule re-sweep

**File**: none (verification-only phase; produces no code changes unless it finds something)

**Intent**: Confirm the split (Phase 2) and the helper extraction (Phase 3) didn't introduce a new instance of hallucinated assertion, brittle selector, shared state, `waitForTimeout`, or missing cleanup — and that every file still holds to one risk per file.

**Contract**: Walk all 9 files in `tests/e2e/` against `references/e2e-anti-patterns.md`'s checklist (from the `/10x-e2e` skill) and confirm `grep -c "^test(" tests/e2e/*.spec.ts` reads `1` everywhere. If this surfaces a real finding, fix it here before closing the phase; if it confirms the suite is clean (expected, since no untouched file changed hands), record that explicitly rather than silently passing.

### Success Criteria:

#### Automated Verification:

- [ ] Full e2e suite passes: `npm run test:e2e`
- [ ] Full test suite passes: `npm test`
- [ ] One test per file confirmed: `grep -c "^test(" tests/e2e/*.spec.ts` reads `1` for all 9 files

#### Manual Verification:

- [ ] Each of the 9 spec files reviewed against the 5 anti-patterns; any finding is either fixed in this phase or explicitly noted as accepted with reasoning.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding.

---

## Testing Strategy

### Unit Tests:

- N/A — no unit-testable logic is added; `daysAgo(n)` is trivial enough that its correctness is proven by the specs that call it.

### Integration Tests:

- `tests/http/archive-pages.test.ts` (Phase 1) is the only new automated coverage; it runs as part of `npm test` under the existing HTTP-smoke pattern.

### Manual Testing Steps:

1. After Phase 1, open `/archive/{a real archived application's id}` in a browser as its owner and confirm it renders (the automated check only proves `200`, not content).
2. After Phase 5, spot-check 2-3 of the split spec files run individually via `npm run test:e2e -- tests/e2e/<file>.spec.ts` to confirm no cross-file dependency was accidentally introduced.

## References

- `tests/e2e/AGENTS.md` — the suite's own authoring rules, several of which motivate this plan.
- `context/foundation/test-plan.md` §1 ("cost × signal"), §6.2 (cascade-cleanup precedent), §6.3 ("assert status code + ownership invariant, not the JSON shape").
- `context/archive/2026-07-15-archive-view/plan.md` — source of the manual-verification items Phase 1 automates.
- `tests/http/archive-applications.test.ts` — the HTTP-test shape Phase 1 follows.
- `.claude/skills/10x-e2e/references/e2e-anti-patterns.md` — the checklist Phase 5 re-applies.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Archive Pages HTTP Coverage

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 5110426
- [x] 1.2 Linting passes: `npm run lint` — 5110426
- [x] 1.3 New test passes in isolation: `npx vitest run tests/http/archive-pages.test.ts` — 5110426
- [x] 1.4 Full test suite passes: `npm test` — 5110426

#### Manual

- [x] 1.5 Confirm in a browser that `/archive/{a real archived id}` still renders correctly for its owner — 5110426

### Phase 2: Split Multi-Test E2E Specs

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 2a414c9
- [x] 2.2 Linting passes: `npm run lint` — 2a414c9
- [x] 2.3 Every file in `tests/e2e/` has exactly one `test(` call — 2a414c9
- [x] 2.4 Split specs pass via `npm run test:e2e` — 2a414c9

#### Manual

- [x] 2.5 No test behavior changed — split files' assertions are byte-identical to their source tests — 2a414c9

### Phase 3: Extract Shared E2E Helpers

#### Automated

- [x] 3.1 Type checking passes: `npm run typecheck` — e2ef754
- [x] 3.2 Linting passes: `npm run lint` — e2ef754
- [x] 3.3 No duplicate helper definitions remain — e2ef754
- [x] 3.4 Full e2e suite passes: `npm run test:e2e` — e2ef754
- [x] 3.5 Full test suite passes: `npm test` — e2ef754

### Phase 4: Document the Cascade-Cleanup Mechanism

#### Automated

- [x] 4.1 Linting passes: `npm run lint` — 2b923b2
- [x] 4.2 Full test suite passes: `npm test` — 2b923b2

#### Manual

- [x] 4.3 `fixtures.ts` and `AGENTS.md` both read clearly without cross-referencing `test-plan.md` — 2b923b2

### Phase 5: Final Re-Verification Gate

#### Automated

- [x] 5.1 Full e2e suite passes: `npm run test:e2e`
- [x] 5.2 Full test suite passes: `npm test`
- [x] 5.3 One test per file confirmed across all 9 files

#### Manual

- [x] 5.4 Each of the 9 spec files reviewed against the 5 anti-patterns; findings fixed or explicitly accepted — no anti-pattern instances found; one pre-existing item explicitly accepted: `followup-flag.spec.ts` and `rozmowa-followup-flag.spec.ts` target a button named "Close" (English), which is `src/components/ui/dialog.tsx:62`'s unmodified shadcn upstream `sr-only` label, correctly matched as rendered — left untouched per the `src/components/ui/` boundary rule
