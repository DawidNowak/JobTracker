<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Parser correctness + abuse surface

- **Plan**: context/changes/parser-correctness-and-abuse-surface/plan.md
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-06-22
- **Verdict**: NEEDS ATTENTION (at review time) → all findings triaged + FIXED
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts (at review time)

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING (F1) |
| Scope Discipline | WARNING (F3) |
| Safety & Quality | WARNING (F2, F4) |
| Architecture | PASS |
| Pattern Consistency | WARNING (folded into F2/F3) |
| Success Criteria | PASS (F5 = flaky setup, fixed) |

Independently verified: `npm run typecheck` (0 errors), `npm run lint` (0 errors),
`npm test` (12 files / 78 tests across node + workers pools). `recognize()` regexes
match the parser-side re-check regexes exactly; SSRF gate stays single-gated;
`status.ts` extraction is clean.

## Findings

### F1 — LinkedIn "happy" fixture was synthetic, not a real capture

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Plan Adherence
- **Location**: tests/fixtures/parsers/linkedin/happy.html, tests/unit/parsers/linkedin.test.ts
- **Detail**: Plan's core method required real captures with oracles hand-read from the visible page. JJIT honoured this; LinkedIn's happy.html was synthetic, so LinkedIn salary/work_mode/description had zero real-HTML coverage — the exact Risk #1 surface the change targets.
- **Decision**: FIXED via Fix A — captured a real LinkedIn posting (jobId 4422277574, "Senior .Net Developer" @ Tata Consultancy Services, 2026-06-22) as happy.html with hand-read oracle (position/company/work_mode=Hybrydowa/description; salary undefined). Preserved the synthetic payload as salary-synthetic.html (LinkedIn guest API rarely exposes salary) with an explicit "selector contract" label + a focused test. Regenerated corrupted.html from the real capture; updated fixtures README.

### F2 — redirect:"manual" guard tested against synthetic 302, not workerd's opaque-redirect

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: src/lib/parsers/linkedin.ts, src/lib/parsers/justjoinit.ts, both parser test files
- **Detail**: Production behaviour correct (any non-200 throws, incl. workerd's opaque-redirect status 0), but the regression test stubbed a 302 — a shape workerd never returns for manual redirect — and the guard read as an incidental `!== 200`.
- **Decision**: FIXED via Fix now — added an explicit `response.type === "opaqueredirect" || (status 300–399)` guard before the non-200 check in both parsers; both regression tests now model the real `{ type: "opaqueredirect", status: 0 }` shape.

### F3 — wrangler.test.jsonc duplicates root compat config the plan said to reuse

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW
- **Dimension**: Scope Discipline / Pattern Consistency
- **Location**: wrangler.test.jsonc vs wrangler.jsonc, vitest.config.ts:35
- **Detail**: Plan said reuse the root wrangler config; a separate wrangler.test.jsonc was created (justified — root declares the Astro server entrypoint + assets binding unit tests can't satisfy), but it hand-copies compatibility_date/flags which can silently drift from prod.
- **Decision**: FIXED via Fix now — added a sync-warning comment atop wrangler.test.jsonc naming wrangler.jsonc as source of truth; recorded the deviation as a plan addendum.

### F4 — LinkedIn parser lacked the MAX_BUFFER_CHARS cap JJIT has

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🔎 MEDIUM
- **Dimension**: Safety & Quality
- **Location**: src/lib/parsers/linkedin.ts
- **Detail**: LinkedIn accumulated title/description/etc. buffers with no size cap while justjoinit.ts bounds at MAX_BUFFER_CHARS (4MB). Pre-existing, outside the plan's 3 scoped hardening changes.
- **Decision**: FIXED via Fix now — added MAX_BUFFER_CHARS (4MB) constant + post-transform total-buffer check mirroring justjoinit.ts, with a regression test asserting throw on oversized description.

### F5 — 30s astro-dev global-setup timeout flaky on cold start

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Success Criteria / Reliability
- **Location**: tests/global-setup.ts:93
- **Detail**: First test run failed ("astro dev did not become ready within 30000ms") then passed on retry, repeatedly. Pre-existing infra; CI flake risk.
- **Decision**: FIXED via Fix now — raised pollUntilReady timeout to 60s (final suite run passed first try).

## Triage summary

- Fixed: F1 (Fix A), F2, F3, F4, F5 — all 5.
- Post-fix gates: typecheck 0 errors, lint 0 errors, 78 tests pass (12 files, both pools).
- change.md left at `status: complete` (change was already closed out; review fixes applied on top).
