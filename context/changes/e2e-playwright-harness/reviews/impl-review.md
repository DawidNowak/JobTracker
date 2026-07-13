<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Playwright E2E Harness

- **Plan**: context/changes/e2e-playwright-harness/plan.md
- **Scope**: Full plan (Phase 1–3 of 3)
- **Date**: 2026-07-13
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 1 observation

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

### F1 — Stale `.dev.vars.e2e-backup` can overwrite the developer's real `.dev.vars`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: scripts/e2e-webserver.ts:81-82
- **Detail**: `main()` unconditionally reads the current `.dev.vars` and overwrites `DEV_VARS_BACKUP` with it, with no guard for an already-existing backup. Normal exit paths are well covered (SIGTERM/SIGINT `shutdown`, `server.on("exit")`, `process.on("exit")`, and the authoritative `global-teardown.ts` restore). But if a prior run died hard enough to skip all of them AND globalTeardown (e.g. the Playwright runner itself is `kill -9`'d / terminal window closed on Windows), `.dev.vars` is left holding the test credentials while `.dev.vars.e2e-backup` still holds the developer's real content. The next `npm run test:e2e` then reads the test-cred `.dev.vars` and overwrites the backup with it — the real content is permanently lost, and every subsequent restore writes test creds back. The in-memory backup in `tests/global-setup.ts` cannot be poisoned this way; the on-disk backup is what introduces the cross-run exposure. Trigger is uncommon and the file is usually reconstructable from Supabase, hence WARNING not CRITICAL.
- **Fix**: At the top of `main()`, before backing up, recover from any orphaned backup first: `if (existsSync(DEV_VARS_BACKUP)) { restoreDevVars(); restored = false; }` — so a leftover backup is applied (and cleared) before the fresh backup is written, and a stale test-cred `.dev.vars` can never be captured as the "original".
  - Strength: Closes the only path found that can silently destroy real `.dev.vars` content; small, localized change reusing the existing idempotent `restoreDevVars()`.
  - Tradeoff: Minor — a few lines at the entry of `main()`; must reset the `restored` flag after the pre-restore so the run's own teardown still fires.
  - Confidence: HIGH — mechanism confirmed by reading the wrapper; restore helper already exists and is idempotent.
  - Blind spot: None significant. (Refuse-to-start-and-prompt is a stricter alternative but hurts ergonomics; auto-recover is the better default.)
- **Decision**: FIXED — orphaned-backup recovery added at top of main() (scripts/e2e-webserver.ts:78-84)

### F2 — Cookie parser mangles a valueless cookie (no `=`)

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/e2e/fixtures.ts:37-38
- **Detail**: `parseCookieString` splits each pair on the first `=` via `indexOf`. For a pair with no `=`, `eqIndex` is `-1`, yielding `name = slice(0, -1)` (drops the last character) and `value = slice(0)` (the whole string) — a malformed cookie. Purely theoretical: `@supabase/ssr` (via `signInAndCaptureCookies`, which joins with `"; "`) never emits a valueless cookie, and chunked `sb-…-auth-token.N` cookies are handled correctly. Noted for hardening only.
- **Fix**: Guard the edge — `if (eqIndex === -1) return null` and `.filter(Boolean)` the result (or skip empty pairs), so a malformed pair is dropped rather than injected.
- **Decision**: FIXED — added `eqIndex === -1` guard + typed null-filter (tests/e2e/fixtures.ts:34-45)
