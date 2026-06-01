<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Parser-driven add

- **Plan**: context/changes/parser-driven-add/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-01
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Backward brace walk mishandles escape sequences inside strings

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/parsers/justjoinit.ts:88-114
- **Detail**: `extractOfferObject` runs the same escape-tracking state machine in both directions, but the logic only works forward. A backslash escapes the character that follows it (forward), so when walking backward, the `escape` flag should be set AFTER seeing the escaped character (look one step further left and find a `\`), not when the `\` itself is encountered. Concrete failure: a JSON string containing `\"` inside JJIT's `body` HTML, walked backward, toggles `inString` on the escaped `"` instead of skipping it, and then "skips" the `\` further left. String state inverts, and a stray `}` inside a string body can prematurely zero `depth`. Mitigated by: (1) post-slice sanity check at justjoinit.ts:151 (`includes('"title"') && includes('"workplace_type"')`); (2) `JSON.parse` of the slice at line 154; (3) Phase 2 manual verification passed against the reference URL. The forward walk (line 121-148) has the same shape but is correct for forward traversal — `escape` is set immediately before the next character is consumed, matching JSON's escape semantics.
- **Fix**: Drop the escape tracking in the backward walk and rely on toggling `inString` on every `"` plus the post-slice JSON.parse for correctness — or properly: when walking backward, peek one position left on every `"` and skip the toggle if the prior char is an unescaped `\`.
  - Strength: Removes a latent bug that one weirdly-formed JJIT description body away from a hard parse failure. The forward sanity-check + JSON.parse only catch it after the fact.
  - Tradeoff: Adds peek-back logic to a hot loop; complexity for a bug that hasn't bitten in practice.
  - Confidence: HIGH on the diagnosis; MEDIUM on whether to fix now — the safety net is real.
  - Blind spot: How often JJIT bodies contain `\"` inside HTML strings (e.g. `<a href=\"...\">` is common).
- **Decision**: FIXED — rewrote both backward and forward brace walks to count preceding backslashes at each `"` (odd = escaped), removing the broken forward-only escape state machine.

### F2 — Duplicate HTMLRewriter type declarations

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/parsers/linkedin.ts:7-19, src/lib/parsers/justjoinit.ts:157-168
- **Detail**: Both parser modules independently declare local `HTMLRewriterTextChunk`, `HTMLRewriterInstance`, `HTMLRewriterCtor`, and `declare const HTMLRewriter`. Identical shapes (linkedin's chunk adds `lastInTextNode`).
- **Fix**: Move the ambient declaration to `src/lib/parsers/types.ts` (or a sibling `html-rewriter.d.ts`) and import from both parsers. The `declare const` only needs to exist once.
- **Decision**: FIXED — created `src/lib/parsers/html-rewriter.d.ts` with the ambient declaration (interfaces are global, `declare const HTMLRewriter` lives once); dropped the duplicate blocks from `linkedin.ts` and `justjoinit.ts`. Unused `lastInTextNode` field dropped.

### F3 — recognize() tightens currentJobId beyond what plan specified

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/parsers/recognize.ts:19-22
- **Detail**: Plan §1 specified `searchParams.get("currentJobId")` with no validation; implementation adds `/^\d{8,}$/.test(fromQuery)`. Tighter than plan, consistent with the path fallback regex, prevents garbage being passed to LinkedIn. No user-visible regression.
- **Fix**: None needed — divergence improves safety. Leave as-is.
- **Decision**: SKIPPED — tightening accepted as a safety improvement; no action.

### F4 — Backward brace walk literal text in plan was inverted

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/parsers/justjoinit.ts:106-113 vs plan.md:174
- **Detail**: Plan said "decrementing depth on `}` and incrementing on `{`" when walking backward — that's reversed. Implementation correctly increments on `}` and treats `{` as the target when depth reaches 0 (else decrements). Implementation is right; plan literal was a typo worth noting so future re-reads don't trust the plan over the code.
- **Fix**: Optionally add a note to plan.md clarifying brace-counting direction. No code change.
- **Decision**: FIXED — plan.md:174 corrected to "incrementing depth on `}` and decrementing on `{`" with a short intuition note.

### F5 — JJIT skills handler accepts object form not in plan

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/parsers/justjoinit.ts:217-225
- **Detail**: Plan said `required_skills.join(", ")` — implementation handles both string members and objects with `.name`, filtering anything else. Sensible widening given JJIT's payload isn't a stable contract.
- **Fix**: None — keep the defensive variant.
- **Decision**: SKIPPED — defensive variant accepted as-is.
