# Plan: HTMLRewriter WASM polyfill for Node project

## Context

`linkedin.test.ts` and `justjoinit.test.ts` currently run only in the `workers` vitest project because both parsers call the `HTMLRewriter` global (a Cloudflare Workers built-in), which is undefined in Node.js. As a workaround, `vitest.config.ts` explicitly lists every unit test file in the node project's `include` instead of using a glob — so each new unit test file must be added manually.

The fix: install `html-rewriter-wasm`, which is Cloudflare's own WASM build of the same `lol-html` Rust library that powers the native Workers runtime. Polyfill `globalThis.HTMLRewriter` from it in a vitest setup file. Parser tests can then run under Node.js with the same underlying engine as production.

## API surface used by the parsers

Knowing exactly what needs to work narrows the risk:

| API | Used by |
|-----|---------|
| `new HTMLRewriter()` | both |
| `.on(selector, { text(chunk) })` | both |
| `.on(selector, { element(el) })` | LinkedIn only |
| `element.onEndTag(fn)` | LinkedIn only — tracks `inSkippable` counter for button text suppression |
| `.transform(response)` | both |
| `await result.text()` | both |

`element.onEndTag` is the only non-trivial call and is the **key risk** to verify in Step 2.

## Step 1 — Install `html-rewriter-wasm`

```
npm install --save-dev html-rewriter-wasm
```

Published by `wrangler-publisher` (Cloudflare's npm account). Latest version: 0.4.1. No transitive dependencies. It is not a behavioral mock — it runs `lol-html` compiled to WASM, so parsing behavior is identical to the Workers runtime.

## Step 2 — Verify `onEndTag` support before writing any code

Check the `html-rewriter-wasm@0.4.1` README or changelog to confirm `element.onEndTag()` is exposed.

**If supported** → proceed to Step 3.

**If not supported**, two options:
- a) Check whether a newer version exists with the API.
- b) Fall back to the behavioral mock approach (see "Fallback" section at the bottom). Only LinkedIn is affected — JustJoinIT uses no `element()` handlers and would move to Node cleanly regardless.

## Step 3 — Write `tests/setup-html-rewriter.ts`

```typescript
import { HTMLRewriter, init } from "html-rewriter-wasm";
await init();
(globalThis as unknown as Record<string, unknown>).HTMLRewriter = HTMLRewriter;
```

`init()` loads the WASM binary. Top-level `await` is valid here because vitest setup files are ES modules. The assignment makes `HTMLRewriter` available as a bare global, exactly as the parsers reference it.

## Step 4 — Update `vitest.config.ts`

Two targeted changes to the node project definition:

**a) Add the new setup file to `setupFiles`:**

```typescript
setupFiles: ["./tests/setup.ts", "./tests/setup-html-rewriter.ts"],
```

**b) Replace the four explicit unit test paths with the glob:**

```typescript
// before
include: [
  "tests/integration/**/*.test.ts",
  "tests/http/**/*.test.ts",
  "tests/unit/parsers/recognize.test.ts",
  "tests/unit/parsers/resolve-status.test.ts",
  "tests/unit/validation/applications.test.ts",
  "tests/unit/services/applications.test.ts",
],

// after
include: [
  "tests/integration/**/*.test.ts",
  "tests/http/**/*.test.ts",
  "tests/unit/**/*.test.ts",
],
```

## Step 5 — Decide what to do with the `workers` project

The `workers` project currently lists `linkedin.test.ts` and `justjoinit.test.ts` explicitly.

**Option A — Remove from `workers`:** Tests run only in Node via WASM. Simpler, faster.

**Option B — Keep in both:** Tests run twice — once under Node (WASM) and once under the real `workerd` runtime. The second run is a confidence check that WASM and production behave identically.

Recommendation: keep both for now; remove from `workers` only if build time becomes a concern.

## Step 6 — Run `npm test` and confirm

Expected outcome: all 7 previously-failing parser tests now pass under the `node` project. If kept in `workers`, they continue passing there too.

---

## Fallback: behavioral mock (only if `onEndTag` is unavailable)

If `html-rewriter-wasm` does not expose `onEndTag`, a hand-rolled mock is needed for the LinkedIn tests. Scope:

1. A `HTMLRewriter` class that stores `{ selector, handlers }` pairs via `.on()`.
2. `.transform(response)` reads the full body and parses it with `node-html-parser` or `cheerio`.
3. For each matching element: call `handlers.element(el)` with a shim that has `.onEndTag(fn)` calling `fn()` after the element's subtree is walked.
4. For text content inside matched elements: call `handlers.text({ text, lastInTextNode: true })`. Since DOM parsers deliver full text at once, `lastInTextNode` is always `true` — this is fine because neither parser branches on it.
5. Return a fake `Response`-like whose `.text()` / `.arrayBuffer()` resolves once the walk completes.

Estimated effort: 3–5 hours. CSS selector matching must cover multi-selectors (comma-separated) and descendant selectors (e.g., `.show-more-less-html__markup br`). The WASM path is preferred because a mock always carries a risk of subtle behavioral divergence from the real engine.
