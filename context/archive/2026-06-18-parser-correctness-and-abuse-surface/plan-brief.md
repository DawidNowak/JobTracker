# Parser correctness + abuse surface — Plan Brief

> Full plan: `context/changes/parser-correctness-and-abuse-surface/plan.md`
> Research: `context/changes/parser-correctness-and-abuse-surface/research.md`

## What & Why

Lock the test-plan §3 Phase 2 wedge: prove the LinkedIn + JustJoinIT parsers don't silently save wrong fields when portal HTML drifts (Risk #1), and prove `recognize()` is a real gate that keeps `/api/applications/parse` from being coerced into outbound fetches to non-portal URLs (Risk #4). Two history-proven silent-drift bugs have already shipped from this surface and were only caught by humans noticing wrong values; today there are zero parser tests and zero captured HTML fixtures.

## Starting Point

`src/lib/parsers/` has the parsers + `recognize()` + the post-F3 narrowed allowlist; `src/pages/api/applications/parse.ts` owns the per-portal status-classification matrix; `AddApplicationDialog.tsx` reads that envelope. Phase 1 + 3 of the test rollout (`testing-bootstrap-and-data-isolation` + HTTP smoke) shipped reusable helpers (`tests/helpers/{users,cookies,supabase-clients}.ts`, `tests/global-setup.ts` spawning `astro dev`); `vitest.config.ts` is single-project, node environment.

## Desired End State

A two-pool Vitest setup runs parser unit tests under `@cloudflare/vitest-pool-workers` (native `HTMLRewriter`) and everything else under node. Six captured HTML fixtures (3 per portal: happy / field-missing / corrupted) ship with hand-typed oracle assertions read from the visible job page, never from the parser's own output. A `recognize()` classifier table locks the post-F3 SSRF allowlist plus every bypass shape from research §B. An endpoint-level test on `POST /api/applications/parse` confirms the `unsupported` envelope short-circuits before `fetch`. Three small defence-in-depth changes land in the parsers, each paired with a regression test.

## Key Decisions Made

| Decision                        | Choice                                                      | Why (1 sentence)                                                                                                   | Source   |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| Hardening in scope?             | Bundle hardening + tests                                    | Each hardening line ships with its own regression test, avoiding a follow-up change folder for ~10 lines of code   | Plan     |
| Parser unit test runner         | Add `@cloudflare/vitest-pool-workers`                       | Native `HTMLRewriter` in-process; no cross-process `fetch`-stubbing dance; matches production runtime              | Plan     |
| Fixtures per portal             | 3 (happy + field-missing + corrupted) = 6 total             | Covers all three status branches per portal with minimal maintenance burden                                        | Plan     |
| Redirect policy                 | `redirect: "manual"` (3xx → throw → `fetch_failed`)         | Symmetry with the fail-closed posture; SSRF "redirect to internal" test passes trivially                           | Plan     |
| JJIT slug interpolation         | Add `encodeURIComponent`                                    | Symmetry with LinkedIn parser; future-proof against any loosening of `recognize.ts:31` regex                       | Plan     |
| Fixture capture procedure       | Manual `curl` + README documenting URL + date per file      | Versioned ground truth; a re-capture script would mask the drift the suite is designed to catch                    | Plan     |
| Phase ordering                  | Infra → Risk #4 → Risk #1 → hardening regressions           | Cheapest signal lands first; fixtures only required once the workers pool is proven; hardening pairs with its test | Plan     |
| Scheduled drift canary          | Defer to test-plan §3 Phase 4 (CI quality-gate wiring)      | Phase 4 already owns the cron + GH Actions secret + LinkedIn-HTTP-999 question                                     | Plan     |
| `recognize()` post-F3 narrowing | Lock in as regression rows in the classifier table          | Documented as FIXED in `parser-driven-add/reviews/impl-review.md` F3; the table now guards against re-widening     | Research |
| Test oracle for fixtures        | Hand-typed values read from the visible job page at capture | Snapshot-against-self is the test-plan §2 anti-pattern for Risk #1                                                 | Research |

## Scope

**In scope:**

- `@cloudflare/vitest-pool-workers` added as devDep; `vitest.config.ts` split into node + workers projects
- `tests/fixtures/parsers/{linkedin,justjoinit}/` with 6 captured HTML files + README documenting each capture
- `tests/unit/parsers/recognize.test.ts` (classifier table), `linkedin.test.ts` + `justjoinit.test.ts` (fixture-driven), `resolve-status.test.ts` (status matrix)
- `tests/http/parse-applications.test.ts` (endpoint envelope assertions for unauthenticated / disallowed / allowed / malformed)
- `tests/helpers/fetch.ts` (`withFetchStub` wrapper around `vi.stubGlobal`)
- Extraction: `src/lib/parsers/status.ts` (moves `EXPECTED_KEYS` + `resolveStatus` out of `parse.ts` for unit testing)
- Three hardening changes in `src/lib/parsers/{linkedin,justjoinit}.ts`: `redirect: "manual"`, JJIT `encodeURIComponent`, parser-side input regex re-check
- Documentation: `tests/README.md` pool layout; `context/foundation/test-plan.md` §4 + §6.4 fill-in + Phase 2 status flip

**Out of scope:**

- Scheduled HTML drift canary against live URLs (deferred to test-plan §3 Phase 4)
- Snapshot-style tests against captured fixtures (Risk #1 anti-pattern)
- End-to-end parse → save → re-read row flow
- Live LinkedIn fetch in CI (HTTP 999 from Workers egress IPs)
- Refactor of `parse.ts` or `AddApplicationDialog.tsx`
- `@cloudflare/vitest-pool-workers` for non-parser tests
- Coverage thresholds

## Architecture / Approach

Two-pool Vitest layout: **node project** runs Supabase integration + HTTP smoke + pure-function tests (`recognize`, `resolveStatus`); **workers project** runs parser unit tests that need `HTMLRewriter`. Shared `globalSetup` spawns `astro dev` once for the HTTP suite. A `withFetchStub` helper stubs `globalThis.fetch` per-test so parsers (which call `fetch` as the global) can be driven against captured HTML payloads without DI. The endpoint SSRF guarantee is encoded structurally: the `unsupported` envelope short-circuits at `parse.ts:65-72` before the parser is even called, so the assertion is "envelope shape is `unsupported`" rather than a cross-process `fetch`-call count. Hardening changes sit inside each parser entry function (regex re-check) and each `fetch` call (redirect policy, slug encoding), keeping `recognize()` as the single security gate at the route level while the parsers fail-closed on inconsistent input.

## Phases at a Glance

| Phase                                                 | What it delivers                                                                                                       | Key risk                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1. Workers test pool infrastructure                   | `@cloudflare/vitest-pool-workers` added; vitest split into node + workers projects; one-line `HTMLRewriter` smoke test | pool-workers vs `@astrojs/cloudflare` v13.5 compatibility — risk-front-loaded by landing this first    |
| 2. Risk #4 — `recognize()` classifier + endpoint SSRF | Pure-function table + endpoint envelope test; `withFetchStub` helper                                                   | Endpoint test's "zero outbound" claim is structural (via `unsupported` envelope), not call-count-based |
| 3. Risk #1 — fixture suite + parser tests             | 6 HTML fixtures + 3 parser test files + `resolveStatus` matrix test; `status.ts` extraction                            | Oracle integrity — values must be hand-typed from the visible page, not from parser output             |
| 4. Defence-in-depth hardening + regression tests      | `redirect: "manual"`, `encodeURIComponent` on JJIT slug, parser-side input re-check; one regression test per change    | `redirect: "manual"` behaviour under workerd — needs to be verified by a stubbed-302 test              |

**Prerequisites:** Phase 1 + Phase 3 of the test rollout shipped (`testing-bootstrap-and-data-isolation` + HTTP smoke); local Supabase running for the HTTP suite; `@astrojs/cloudflare` v13.5 stays the build adapter.
**Estimated effort:** ~3-4 sessions across 4 phases. Phase 1 is the smallest (infra wiring); Phase 3 is the largest (HTML capture + oracle writing per portal).

## Open Risks & Assumptions

- `@cloudflare/vitest-pool-workers` may have a compat issue with `@astrojs/cloudflare` v13.5 or vitest v3.2 — risk-front-loaded by Phase 1 (discovered before any fixture work).
- `redirect: "manual"` under workerd may surface as `response.type === "opaqueredirect"` rather than a 3xx status — the redirect regression test will verify this empirically when written.
- LinkedIn / JJIT will eventually change HTML enough to red the happy fixtures — this is the _signal_ the suite is designed to produce, and the drift canary in test-plan §3 Phase 4 will catch it on a cron.

## Success Criteria (Summary)

- A user pasting a real LinkedIn or JJIT URL into the AddApplicationDialog still gets correctly pre-filled fields (no regression from hardening).
- A maintainer mutating the post-F3 `recognize()` allowlist back to suffix-match immediately reds at least one test (regression guard for the SSRF narrowing is real).
- A maintainer mutating the LinkedIn description selector or the JJIT marker key immediately reds a fixture test (the silent-drift bug class that shipped twice before is now caught).
