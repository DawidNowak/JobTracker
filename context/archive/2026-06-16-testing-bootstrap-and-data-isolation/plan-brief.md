# Test Bootstrap + Data-Isolation Guard — Plan Brief

> Full plan: `context/changes/testing-bootstrap-and-data-isolation/plan.md`
> Research: `context/changes/testing-bootstrap-and-data-isolation/research.md`

## What & Why

Phase 1 of the project's test rollout. Two coupled goals: (1) land the test runner (Vitest, Node pool) and the `tests/` directory convention, replacing the `AGENTS.md:13` hard rule that currently forbids tests; (2) prove the incident-class data-isolation guardrail — user A's session cannot SELECT/UPDATE/DELETE user B's rows in either `applications` or `application_notes` — using the real Supabase SSR auth surface against a local Supabase. The PRD calls a Risk #2 failure "an incident, not a P2 bug"; this plan gives us a regression suite that fails loudly the next time a migration or session-handling change drifts.

## Starting Point

The codebase ships zero test infrastructure (`package.json` has no test deps; no `vitest.config.*`; `AGENTS.md:13` reads "no test framework — do not scaffold tests"). One Supabase client surface exists (`src/lib/supabase.ts`) with no service-role path anywhere in `src/` — confirmed by grep. RLS policies are tight after the four migrations to date, including the `application_notes` hardening that fixed a real cross-user write leak (F-01). Local Supabase is one `npx supabase start` away (the CLI is already a devDependency).

## Desired End State

After this plan ships, a contributor runs `npx supabase start && npm test` and sees a green PostgREST suite proving the row-level isolation matrix on both tables (plus the F-01 regression), plus a thin HTTP smoke that locks the 401 / 404-collapse contract on `POST /api/applications` and `PATCH /api/applications/[id]`. `AGENTS.md` now names Vitest, the `tests/` location, and the no-mock / no-service-role-commit rules. CI is untouched — Phase 4 of the rollout owns wiring `npm test` into GitHub Actions.

## Key Decisions Made

| Decision | Choice | Why | Source |
|---|---|---|---|
| Test runner | Vitest with `getViteConfig` from `astro/config`, Node pool | Canonical Astro setup; inherits Cloudflare adapter + `astro:env/server` for free; no `HTMLRewriter` modules under test in Phase 1 | Research |
| Endpoint drive path | PostgREST (B) + thin HTTP smoke (A) | Covers Risk #2 at the SQL row level (no mocking) AND locks the 404-collapse existence-leak invariant cheaply | Plan |
| Coverage scope | Minimal must-have (~7 cases) | Smallest surface that proves Risk #2 + F-01 regression + anon smoke; balanced matrix and trigger-chain tests are deferred to rollout Phase 3 | Plan |
| Service-role key location | `.env.test` (git-ignored) + `tests/setup.ts` hard guard on `127.0.0.1` | Clear separation from `.dev.vars`; setup guard refuses to construct admin client against non-local URL | Plan |
| Test user lifecycle | Per-test ephemeral users with `crypto.randomUUID()` emails | Supabase-recommended; `ON DELETE CASCADE` from `auth.users` makes teardown one call per user; survives `--watch` cleanly | Research |
| `AGENTS.md` revision | Concrete contract: name runner + location + no-mock + no-SR-commit rules | AI agents read AGENTS.md hard-rules; load-bearing rules go where they get enforced | Plan |
| CI wiring | Deferred to Phase 4 | Matches test plan §3 phase split; keeps Phase 1 footprint reviewable | Plan |
| `@cloudflare/vitest-pool-workers` | Deferred to Phase 2 | Only `HTMLRewriter` (parsers) needs it; adding now is wasted churn until parser tests exist | Research |
| Two-client pattern | Always two `supabase-js` clients per user, both `persistSession: false` | Sharing storage between admin + user clients caused real flakiness in the wild | Research |

## Scope

**In scope:**
- Vitest + helpers + `.env.test` flow + setup guard
- Cross-user negative cases on both `applications` and `application_notes` (SELECT/UPDATE/DELETE)
- F-01 regression test (B inserts note pointing at A's app → policy violation)
- Unauthenticated anon smoke (no rows visible without sign-in)
- HTTP smoke: 401 + 404-collapse + 200 on `POST` and `PATCH` `/api/applications`
- `AGENTS.md` and `README.md` doc updates

**Out of scope:**
- CI integration (Phase 4 of the rollout)
- `@cloudflare/vitest-pool-workers` (Phase 2)
- Parser tests, fixtures, URL allowlist tests (Phase 2)
- Full IDOR matrix — verb × owner × actor (Phase 3)
- `last_action_at` trigger invariants (Phase 3)
- Unit tests of helpers or utility modules
- Coverage thresholds

## Architecture / Approach

```
                          ┌─────────────────────┐
   npm test  ──────────►  │   Vitest (Node)     │
                          │   getViteConfig     │
                          └──────────┬──────────┘
                                     │
              ┌──────────────────────┼─────────────────────────┐
              │                      │                         │
   tests/setup.ts           tests/global-setup.ts     tests/integration/**
   • load .env.test         • spawn astro dev once    • PostgREST via two
   • guard SUPABASE_URL       (only Phase 3+)           supabase-js clients
     starts with 127.0.0.1                            • per-test users
                                                       (admin.createUser)
                                     │
                                     ▼
                            tests/http/**
                            • fetch + Cookie jar
                            • captured via signIn

   All clients: persistSession: false
   All assertions: at the row level (no service-layer abstraction)
```

The harness drives a real local Postgres via two anon `supabase-js` clients per test, one signed in as each user. The HTTP suite adds one `astro dev` instance per Vitest run, cookie-jar extracted from a `supabase-js` sign-in and replayed verbatim on `fetch` so the request flows through middleware → handler → service → RLS exactly as production does.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Test bootstrap | `vitest.config.ts`, `tests/setup.ts` with no-leak guard, helpers, `.env.test` + `.env.example` + `.gitignore`, `AGENTS.md` + `README.md` rewrites, `npm test` script | The guard message must be obvious enough that a misconfigured contributor diagnoses it without reading source |
| 2. PostgREST isolation suite | 4 files, ~7 tests: cross-user SELECT/UPDATE/DELETE on both tables + F-01 attack + anon smoke | "Test passes by coincidence" — manual mutation check (drop a policy, see the test go red) is the antidote |
| 3. HTTP smoke (thin Option A) | Programmatic `astro dev` lifecycle, cookie-jar helper, 401 + 404-collapse + 200 tests on POST/PATCH | Process management for `astro dev` (port binding, clean teardown, watch-mode survival) |

**Prerequisites:** `npx supabase start` must work locally (Docker required); `supabase@^2.101.0` is already installed.
**Estimated effort:** ~1–2 focused sessions across the 3 phases. Each phase is independently shippable.

## Open Risks & Assumptions

- **Astro 6 programmatic `dev` API in `globalSetup`.** The plan assumes `import('astro').then(m => m.dev(...))` exposes the chosen port when `port: 0` is passed; if it doesn't, the fallback is `child_process.spawn('npx', ['astro', 'dev', '--port', '0'])` + port detection from stdout. Decision is left to the implementer with both paths called out.
- **`email_confirm: true` flag dependency.** Project-level email confirmations are off in `config.toml:209`, but `admin.createUser` requires `email_confirm: true` explicitly anyway (separate switches). The plan encodes this in the `provisionUser` helper.
- **Local-only service-role key handling.** The `.env.test` + setup-guard combo is the only line of defense. A contributor who copies `.env.test` to a teammate including the SR key is a real, ungated risk; mitigated by the loud git-ignore + sentinel in `.env.example` + (later) Phase 4 CI doc on secrets management.

## Success Criteria (Summary)

- A reviewer reading `AGENTS.md` understands tests exist, where they live, what they must not mock, and what must never be committed.
- `npx supabase start && npm test` exits 0 with the cross-user isolation matrix and the HTTP smoke green.
- Manually dropping any `applications_*_own` policy or commenting out the `application_notes_insert_own` EXISTS clause turns the targeted test red — proving the suite actually catches regressions rather than passing by coincidence.
