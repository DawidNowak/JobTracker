<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Manual Add Application (S-02)

- **Plan**: context/changes/manual-add-application/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-05-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 3 warnings · 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Automated Verification

- `npm run lint` — PASS (only deprecation notes from `astro-eslint-parser`, no errors/warnings).
- `npm run typecheck` — PASS (46 files, 0 errors, 0 warnings, 4 hints — all on `eslint.config.js` `tseslint.config()` deprecation, unrelated to this change).
- `npm run build` — PASS (server build complete, 29.22s).

All manual Progress checkboxes (1.4–1.8, 2.4–2.8, 3.4–3.12) are marked `[x]` against landed commits — no rubber-stamped items.

## Findings

### F1 — Anchor href accepts `javascript:` URLs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/board/KanbanCard.astro:14-15, 29
- **Detail**: `new URL(application.source)` parses `javascript:alert(1)` and `data:text/html,...` successfully, so the rendered anchor can carry an executable href. The plan's spec ("only show if `new URL()` parses") didn't constrain protocol. Real-world exposure is small — RLS isolates each user's rows, so this is self-XSS, not stored-XSS across tenants — but it's a cheap defense-in-depth hardening before S-03/S-04 reuse the card surface for parser-driven sources.
- **Fix**: After `new URL(application.source)`, also gate on `url.protocol === "http:" || url.protocol === "https:"` before setting `sourceHref`.
- **Decision**: FIXED

### F2 — API route validates body before checking auth

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (also: Plan — the plan itself prescribed this order)
- **Location**: src/pages/api/applications/index.ts:30-46
- **Detail**: Order is parse JSON → run Zod → check `locals.user`. An unauthenticated caller posting a malformed payload learns the schema (field names, Polish error messages) via a 422 before ever hitting the 401. The plan literally prescribed this order in Phase 2 §1, so the code MATCHES the plan — but the plan's order was suboptimal. No data leaks; this is a schema-disclosure / "auth first" hygiene issue that will compound as S-03 / S-04 add more JSON endpoints if it becomes the house pattern.
- **Fix**: Move the `const user = context.locals.user; if (!user) return 401` block above the JSON parse so unauthenticated callers get 401 regardless of payload.
- **Decision**: FIXED

### F3 — Dashboard read errors swallowed silently

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dashboard.astro:26-28
- **Detail**: Plan Phase 1 §1 explicitly says: "On service error… log the error and render an empty board." The catch block here renders empty (matches) but the body is just a comment — no `console.error`. A real DB outage or RLS misconfig produces zero diagnostic signal. The API route does log on its own catch (line 58); this catch should match.
- **Fix**: Add `console.error("Dashboard load failed", err)` (with an appropriate eslint-disable if your config requires it, matching the route at line 57).
- **Decision**: FIXED

### F4 — Sentinel value `__none__` deviates from plan's `value=""`

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: src/components/board/AddApplicationDialog.tsx:27, 207-216
- **Detail**: Plan §3 §2 said the "Nie wybrano" option uses `value=''`. Radix Select rejects empty-string values at runtime, so implementer used a sentinel `__none__` and maps back to `null` at submit (line 85). The on-wire contract is preserved. No fix needed — flagged for documentation only.
- **Fix**: None — accepted as a forced workaround. Note in plan if the same pattern appears in S-03/S-04.
- **Decision**: SKIPPED

### F5 — Service spreads `...input` into insert

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architecture
- **Location**: src/lib/services/applications.ts:27 (approx)
- **Detail**: `createApplication` spreads the Zod-validated DTO directly into `insert(...)`. Safe today (Zod `.object()` strips unknown keys by default and the schema is a closed set), but a future `.passthrough()` or extra schema field could forward unintended columns. Whitelisting fields explicitly is the defensive variant.
- **Fix**: None required for this slice. Revisit if the schema ever loosens.
- **Decision**: SKIPPED
