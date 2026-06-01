<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Parser-driven add (full re-review)

- **Plan**: context/changes/parser-driven-add/plan.md
- **Scope**: All 4 phases + 3 post-triage fix commits (d45d704, 142dc93, 1a2edf6)
- **Date**: 2026-06-01
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical, 4 warnings, 2 observations

> This report supersedes the prior 2026-06-01 review (5 findings, all triaged: F1 FIXED, F2 FIXED, F3 SKIPPED, F4 FIXED, F5 SKIPPED). New findings below are numbered F1–F7 from scratch in this re-review.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL |

`npm run build` passes (37 s). `npm run lint` **fails** — 3 errors in `src/lib/parsers/justjoinit.ts`. See F1.

## Findings

### F1 — Lint regressed since last impl-review pass

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/lib/parsers/justjoinit.ts:81, 191, 214
- **Detail**: `npm run lint` (success criterion for every phase) now reports 3 errors:
  - **81:18** `@typescript-eslint/no-unnecessary-type-assertion` — `(value as { value: unknown }).value` in `mapWorkplaceType`; `value` is already narrowed to `object` here, the assertion is redundant.
  - **191:10** `@typescript-eslint/no-unnecessary-condition` — `while (true)` in `extractOfferObject` (the schema-drift-fix candidate loop); eslint wants an explicit exit condition.
  - **214:1** `prettier/prettier` — trailing blank line between `extractOfferObject` and `parseJustJoinIT`.

  Plan progress marks `2.1 Lint passes — b441a6b` as `[x]`, so lint was green when phase 2 landed. Triage commit `2b9e722` (schema-drift rewrite of `extractOfferObject`) and the type-narrowing tweak in `mapWorkplaceType` regressed it. `npm run build` still passes.
- **Fix**: Run `npm run lint -- --fix` (handles 81 + 214 automatically) and replace `while (true)` on line 191 with a bounded `while (searchStart < flight.length)` (or equivalent) so the exit condition is explicit.
- **Decision**: FIXED — ran `npm run lint -- --fix` (auto-removed the `as { value: unknown }` assertion at line 81 and the trailing blank line at 214), then manually changed `while (true)` to `while (searchStart < flight.length)` at line 191. Lint and build both pass.

### F2 — No request body / source length cap on parse endpoint

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/validation/applications.ts:39-41
- **Detail**: `applicationParseSchema` is `z.object({ source: z.string().min(1) })` with no upper bound. `context.request.json()` in `parse.ts` buffers the full body before Zod runs, so a multi-MB JSON payload from an authenticated user is fully read into Worker memory. Plan §"What We're NOT Doing" excluded response-body caps and rate-limiting (Q8), but request-side input bounding is a Zod-level concern, not infra. A URL never exceeds ~2 KB in practice.
- **Fix**: Change to `source: z.string().min(1).max(2048)`.
- **Decision**: SKIPPED — accepted as deferred; auth-gated endpoint, no observed abuse, Q8 "timeout only" stance still applies.

### F3 — SSRF allowlist accepts any *.linkedin.com subdomain

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/parsers/recognize.ts:18-22
- **Detail**: `host === "linkedin.com" || host.endsWith(".linkedin.com")` accepts arbitrary subdomains. The actual SSRF gate holds because the LinkedIn parser builds its outbound URL from the extracted `jobId` only and hard-codes `www.linkedin.com` — a crafted host never reaches `fetch()`. But the allowlist is wider than the surface that actually visits LinkedIn, and it's the documented security boundary.
- **Fix**: Replace `endsWith(".linkedin.com")` with an explicit small set: `["linkedin.com", "www.linkedin.com", "pl.linkedin.com"]`.
- **Decision**: FIXED — replaced suffix match with explicit 3-host equality check at recognize.ts:18.

### F4 — Flight buffer / candidate loop unbounded in JJIT parser

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/parsers/justjoinit.ts:185-212, 239 (Flight regex over scriptBuffer)
- **Detail**: Two compounding bounds gaps. (1) `extractOfferObject` walks every `"workplaceType"` occurrence and per candidate calls `sliceObjectAround` which scans the full flight string in both directions — worst case O(candidates × |flight|). (2) The `matchAll` regex over `scriptBuffer` has no length cap; a pathologically large JJIT page could grow Worker memory until the 8 s `AbortSignal` fires. Realistic JJIT pages are 100–500 KB compressed, so this is a defensive concern, not an observed bug.
- **Fix A ⭐ Recommended**: Cap `candidatesTried` (e.g. 8) and bail early if `scriptBuffer.length` or `flight.length` exceeds a ~4 MB ceiling (throw, caught by endpoint as `fetch_failed`).
  - Strength: Trivial defensive caps; happy path unchanged; aligns with the 8 s timeout philosophy ("bound everything").
  - Tradeoff: One more arbitrary constant in the parser; the cap could mask a legitimate JJIT change that grows pages.
  - Confidence: HIGH — candidate cap is already implied by the schema-drift-fix loop.
  - Blind spot: How JJIT page sizes have actually trended.
- **Fix B**: Leave as-is, document in plan's "What We're NOT Doing"
  - Strength: No code change; matches the slice's Q8 "timeout only" posture.
  - Tradeoff: Postpones a near-zero-cost fix to a future incident.
  - Confidence: MEDIUM — depends on JJIT page-size stability.
  - Blind spot: Same as above.
- **Decision**: FIXED via Fix A — added `MAX_BUFFER_CHARS = 4_000_000` and `MAX_OFFER_CANDIDATES = 8` constants, candidate cap inside `extractOfferObject`'s while loop, size bails after `scriptBuffer` is collected and after `flight = chunks.join("")`. All bail-outs throw and are caught by the endpoint as `fetch_failed`.

### F5 — Response stream not drained when HTMLRewriter throws

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/parsers/linkedin.ts:96-101, src/lib/parsers/justjoinit.ts:232-244
- **Detail**: Both parsers call `await rewritten.text()` to drain the rewritten response. If any HTMLRewriter handler throws synchronously, the underlying `response.body` may not be cancelled — workerd's docs flag this as a potential resource hold. Current handlers are simple string appends so the risk is theoretical; flagging because it's the boundary pattern that will be copied if a third parser is added.
- **Fix**: Wrap drain in `try { await rewritten.text(); } finally { response.body?.cancel().catch(() => {}); }` in both parsers, or extract a `consumeAndCancel(response, rewriter)` helper into `src/lib/parsers/util.ts` and call it from both.
- **Decision**: SKIPPED — current handlers are simple string appends; theoretical leak only, no observed issue.

### F6 — Phase 2 plan body still references "title" as the offer marker

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:163, 173-176 vs src/lib/parsers/justjoinit.ts:192
- **Detail**: Plan Phase 2 §"Find the offer object" instructs the implementation to locate `"title"` and walk backward. Implementation now searches `"workplaceType"` (commit `2b9e722`, schema-drift fix). The fact is captured in the plan's Post-merge follow-up entry, but readers of Phase 2 will see stale instructions before reaching the follow-up section. Same pattern as F4 of the previous review (plan body inverted backward-walk direction).
- **Fix**: Optionally add a one-line forward-pointer at plan.md:173 to the Post-merge entry. No code change.
- **Decision**: FIXED — added a blockquote callout immediately above plan.md:173 pointing to the Post-merge entry and noting the marker key changed to `"workplaceType"` plus the candidate-loop reshape (commit 2b9e722).

### F7 — formatParseErrors near-duplicate of formatApplicationErrors

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/applications/parse.ts:18-30 vs src/pages/api/applications/index.ts:16-28
- **Detail**: Both routes implement the same "source is required" error formatter with identical envelope shapes. Intentional sibling consistency — flagging so the next field addition doesn't drift one without the other.
- **Fix**: Optionally extract a shared `formatSourceFieldErrors(zodError)` helper into `src/lib/validation/applications.ts`. No urgency.
- **Decision**: FIXED — added `formatApplicationFieldErrors` to `src/lib/validation/applications.ts`; deleted the duplicated `formatApplicationErrors` / `formatParseErrors` from both route handlers and replaced the call sites with the shared import. Dropped the now-unused `z` import from both routes. Lint + build pass.
