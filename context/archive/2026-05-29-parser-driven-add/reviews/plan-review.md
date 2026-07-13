<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Parser-driven add

- **Plan**: context/changes/parser-driven-add/plan.md
- **Mode**: Deep
- **Date**: 2026-05-29
- **Verdict**: REVISE → **SOUND after triage** (all 4 findings fixed in plan)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

5/5 paths exist (`AddApplicationDialog.tsx`, `applications.ts`, `applications/index.ts`, `KanbanCard.astro`, `20260526123145_applications_schema.sql`). Schema line range (13–28) matches. `@astrojs/cloudflare` adapter present in `astro.config.mjs` → HTMLRewriter is available as a workerd global in production. brief↔plan consistent.

## Findings

### F1 — JJIT offer-JSON extraction algorithm is hand-waved

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Completeness / Blind Spots
- **Location**: Phase 2 — Implementation Approach (§"Find the offer object")
- **Detail**: Plan says "locate the smallest balanced JSON object substring containing both `\"title\"` and `\"workplace_type\"` keys; JSON.parse it." Research §line 151 also only prose-describes this. The brief itself flags this as Phase 2's "one fragile step", yet plan supplies a code snippet for the _other_ tricky bit (Flight chunk extraction) while leaving this prose-only. A naive brace counter that ignores JSON string-literal context will mis-close on `{`/`}` characters inside string values (HTML `body`, arbitrary description text). Failure mode is silent: wrong-but-parseable substring → `JSON.parse` succeeds → `ParseResult` returns wrong fields → endpoint returns `status: "ok"` with garbage. The endpoint catch-all only saves us if parsing throws.
- **Fix A ⭐ Recommended**: Specify the algorithm in the plan
  - Approach: Document a string-aware brace counter — scan backward from `"title"` index for the enclosing `{`, walk forward tracking depth while respecting JSON string state (`"`, `\\"`, `\\\\`). Stop at depth zero. Validate captured object contains both keys before `JSON.parse`.
  - Strength: Deterministic and testable; matches what the success criterion implicitly demands. Implementer doesn't have to invent it under pressure.
  - Tradeoff: ~25 LOC of careful code; slightly more plan content.
  - Confidence: HIGH — standard primitive for this problem; no exotic deps needed.
  - Blind spot: Nested escapes in HTML body; worth one extra sanity check post-parse.
- **Fix B**: Pivot to RSC-aware extraction via the Flight tree
  - Approach: Parse Flight chunks as proper RSC wire payload (each chunk is `<index>:<payload>`), walk the tree to find the offer object by shape.
  - Strength: Structurally correct rather than substring-based.
  - Tradeoff: Significantly more code; RSC wire format is unstable, undocumented, and brittle to React version bumps on JJIT's side.
  - Confidence: LOW — RSC format is a moving target.
  - Blind spot: Would need its own research pass.
- **Decision**: FIXED via Fix A — Phase 2 §"Find the offer object" now specifies the string-aware brace-matching algorithm (backward scan for `{`, forward scan for `}`, string-state tracking, post-slice sanity check before `JSON.parse`).

### F2 — `formatSalary` doesn't specify `to: null` behavior

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Critical Implementation Details (§Salary normalization), research.md §line 130–136
- **Detail**: Format is `"{from} – {to} {currency}/{unit} ({contract-label})"`. JJIT postings often have `to: null` (single-point or "from only" salaries); plan and research example both show two-sided ranges only. Naive interpolation produces `"18 000 – null PLN/mies. (B2B)"` shipped verbatim to the user.
- **Fix**: Specify: when `to` is null, format `"{from}+ {currency}/{unit} ({contract-label})"`; otherwise the existing dual-bound format. Apply per entry before joining with `"; "`.
- **Decision**: FIXED — Phase 2 §Salary normalization now branches on `to` being null vs non-null.

### F3 — HTMLRewriter availability in `astro dev` is assumed, not verified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1–3 Manual Verification (`localhost:4321`)
- **Detail**: Plan correctly identifies HTMLRewriter as a workerd global, but all manual verification (1.4–1.8, 2.3–2.6, 3.3–3.5) runs against `localhost:4321` / `astro dev`. Whether `@astrojs/cloudflare` v13.5 runs dev in workerd or in Node-with-shims determines whether HTMLRewriter exists at all in dev. If dev mode is Node-shimmed and the shim doesn't include HTMLRewriter, every manual step fails with a `ReferenceError`, masking real bugs. Production deploy is fine; the risk is wasted iteration during local validation.
- **Fix**: Add a 30-second smoke check before Phase 1 implementation — a one-line route returning `typeof HTMLRewriter`, hit via `curl http://localhost:4321/...`. Document the result. If missing, fall back to `npm run preview` or `wrangler dev` for verification from Phase 2 onward.
- **Decision**: FIXED — added "Dev-runtime preflight" bullet under Critical Implementation Details with the probe route, expected output, and fallback strategy.

### F4 — Phase 4 §2 is documentation, not work

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 — §2 "Server-side defensive recognition"
- **Detail**: "(already covered in Phase 1) ... No code change in Phase 4 — covered by Phase 1" — this is a note dressed as a numbered Changes Required item. Adds confusion (two subsections in Phase 4, only one is real work).
- **Fix**: Move the invariant into an "Architectural Notes" line under Phase 4 overview; drop the numbered subsection.
- **Decision**: FIXED — invariant moved to an "Architectural note" line in Phase 4 overview; numbered §2 removed.
