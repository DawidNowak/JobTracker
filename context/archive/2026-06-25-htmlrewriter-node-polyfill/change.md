---
id: htmlrewriter-node-polyfill
title: "Move parser unit tests to Node project via HTMLRewriter WASM polyfill"
status: archived
created: 2026-06-25
archived_at: 2026-06-30T11:28:12Z
updated: 2026-06-30
---

## Goal

`linkedin.test.ts` and `justjoinit.test.ts` currently run only in the `workers` project (Cloudflare Workers runtime) because the parsers call the `HTMLRewriter` global, which does not exist in Node.js. This forces two explicit file paths in the node project's `include` list and means new unit tests under `tests/unit/` must be added manually.

Install `html-rewriter-wasm` as a dev dependency and polyfill `globalThis.HTMLRewriter` in a vitest setup file so the parser tests can run under the `node` project. Replace the four explicit `include` paths with the `tests/unit/**/*.test.ts` glob.
