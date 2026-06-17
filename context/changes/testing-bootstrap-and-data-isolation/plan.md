# Test Bootstrap + Data-Isolation Guard Implementation Plan

## Overview

Phase 1 of `context/foundation/test-plan.md`. Two coupled goals:

1. **Test bootstrap** — pick the runner (Vitest, Node pool), establish the `tests/` directory convention, replace the `AGENTS.md:13` "no test framework" hard rule with a concrete contract, and add an `npm test` script that works locally against `npx supabase start`.
2. **Data-isolation guard (Risk #2)** — prove at the SQL row level via the real Supabase SSR auth surface that user A's session cannot SELECT/UPDATE/DELETE rows owned by user B on both `applications` AND `application_notes`. Land the F-01 regression test (B inserts a note pointing at A's application → policy violation). Add a thin HTTP smoke that locks the 401 / 404-collapse contract on the two DB-touching application endpoints.

CI wiring is **out of scope** — Phase 4 of the rollout owns it.

## Current State Analysis

- **No test infrastructure exists.** Zero test dependencies in `package.json`; no `vitest.config.*`; no `**/*.test.*`; no `__tests__/`. `AGENTS.md:13` and `README.md:152-154` actively forbid scaffolding tests.
- **Single Supabase client surface.** `src/lib/supabase.ts` exports one `createClient(headers, cookies)` returning a `@supabase/ssr` `createServerClient` bound to the anon `SUPABASE_KEY`. Grep over `src/` confirms zero service-role / `SERVICE_ROLE` paths. Risk #2 is testable through the anon-only attack surface.
- **API surface is narrow.** Two DB-touching endpoints: `POST /api/applications` (server-stamps `user_id`) and `PATCH /api/applications/[id]` (defence-in-depth `.eq("user_id", …)` + `maybeSingle()` that collapses "not found" and "exists-but-owned-by-other" into 404). No endpoints for `application_notes` — its isolation can only be exercised at the PostgREST layer.
- **RLS final state is tight.** Both tables have authenticated-only `*_own` policies keyed on `auth.uid()`. The hardened `application_notes_insert_own` requires `user_id = auth.uid()` AND `EXISTS (SELECT 1 FROM applications WHERE id = application_id AND user_id = auth.uid())` — the patch for the past cross-user write leak (F-01).
- **Local Supabase is ready.** `supabase@^2.101.0` is already a devDependency; `supabase/config.toml` ships standard ports (API 54321, DB 54322), email/password auth on, **email confirmations disabled** (so `admin.createUser` + `signInWithPassword` is one round trip — no Inbucket polling).
- **Astro 6 + Vite + Cloudflare adapter; Node 22.** `getViteConfig` from `astro/config` is the canonical way to feed the existing `astro.config.mjs` (including `astro:env/server` and the Cloudflare adapter) into Vitest. Node pool is sufficient — `HTMLRewriter` (the only workerd-only API in `src/`) lives in `src/lib/parsers/**` which is Phase 2 scope.
- **CI today:** `npm ci → npx astro sync → npm run typecheck → npm run lint → npm run build`. No Docker, no Supabase, no service-role secret. Unchanged by this phase.

## Desired End State

After this plan ships:

- `npm test` exists and runs Vitest against `tests/**/*.test.ts`. Local prerequisite: `npx supabase start` is running and `.env.test` is populated.
- `tests/` directory holds: a setup file that hard-asserts the `SUPABASE_URL` points at `http://127.0.0.1:54321` before any admin client is constructed; helpers for the two-client-per-user pattern and per-test user lifecycle; one integration suite proving the cross-user isolation matrix on both tables (minimal must-have set, ~7 tests); one HTTP smoke suite for the two DB-touching endpoints (cookie-jar over programmatic `astro dev`).
- `AGENTS.md:13` no longer forbids tests; it names Vitest, the `tests/` location, the no-mock-Supabase rule, and the never-commit-service-role-key rule.
- `README.md` "Testing" section documents the local prereq and the `.env.test` setup; the existing "CI" section is annotated that test gating arrives in Phase 4.
- `.env.example` shows sentinel test entries; `.gitignore` covers `.env.test`.
- `package.json` declares `vitest`, `@vitest/coverage-v8`, `dotenv` as devDependencies; `test` and `test:watch` scripts.
- CI workflow is **unchanged**.

### Verification

- `npx supabase start && npm test` exits 0 with the cross-user isolation suite green.
- `npx supabase stop && npm test` exits non-zero with a clear "local Supabase not reachable" message from `tests/setup.ts`.
- Pointing `SUPABASE_URL` at a non-`127.0.0.1` host in `.env.test` causes `tests/setup.ts` to throw before any admin client is constructed (manual verification — flip the env, re-run, restore).
- `npm run typecheck` and `npm run lint` still pass.
- A reviewer reading `AGENTS.md` understands they can write tests, where they live, and what they must not do.

### Key Discoveries

- Single SSR client factory at `src/lib/supabase.ts:1-25` makes Risk #2 testable through one anon-only surface (no service-role audit needed).
- `PATCH /api/applications/[id]` returns 404 for both "not found" and "exists-but-owned-by-other" via `maybeSingle()` ([src/pages/api/applications/[id].ts:12-51](src/pages/api/applications/[id].ts#L12-L51)) — load-bearing existence-leak guard, tested explicitly in Phase 3.
- `application_notes_insert_own` WITH CHECK is the F-01 patch ([supabase/migrations/20260526132205_harden_application_notes_rls.sql:20-44](supabase/migrations/20260526132205_harden_application_notes_rls.sql#L20-L44)); the regression test is the canonical Phase 2 case in this plan.
- `ON DELETE CASCADE` from `auth.users` ([supabase/migrations/20260526123145_applications_schema.sql:13-28](supabase/migrations/20260526123145_applications_schema.sql#L13-L28)) lets `afterEach` teardown be one `admin.deleteUser(...)` call per user — all `applications` and `application_notes` rows cascade away.
- Two `supabase-js` clients with `persistSession: false` is the supported isolation pattern; sharing storage between admin and user clients caused real flakiness in community write-ups — encoded as a helper constraint, not a comment.

## What We're NOT Doing

- **No CI wiring.** `.github/workflows/ci.yml` is untouched. Phase 4 of the rollout owns `npm test` in CI plus the Docker / `supabase start` action choice.
- **No `@cloudflare/vitest-pool-workers`.** Deferred to Phase 2 (parser tests need `HTMLRewriter`). Adding it now would force `vitest.workspace.ts` or per-file pool overrides for zero current benefit.
- **No coverage thresholds.** Per test plan §7. `@vitest/coverage-v8` is installed so `npm run test -- --coverage` is one flag away, but no gate.
- **No full IDOR matrix (verb × owner × actor → status).** Phase 3 owns Risk #5. Phase 1 ships only the 401-no-cookie smoke and the PATCH-wrong-owner-returns-404 invariant — the minimum needed to lock the existence-leak contract while the harness is in place.
- **No trigger-invariant tests** (`last_action_at` reset / non-reset semantics). Phase 3 owns Risk #3.
- **No `application_notes` HTTP smoke.** No endpoint exists; PostgREST tests are the only route.
- **No service-role usage outside `tests/helpers/admin.ts`.** The admin client exists for one purpose: provisioning two ephemeral users per test. Every assertion runs through an authenticated anon client.
- **No `supabase db reset` per test.** Per-test ephemeral users with `crypto.randomUUID()` emails + `ON DELETE CASCADE` is the teardown.
- **No seeded `supabase/seed.sql` users.** Same reason — seeded users make `--watch` flaky (leftover rows on re-run).
- **No `tests/unit/**`** in this phase. We're not blocking future unit tests, but Phase 1 ships zero unit tests because the only modules small enough to unit-test cheaply (`src/lib/utils.ts`, validation schemas) carry near-zero regression risk vs. Risk #2.

## Implementation Approach

Three independently shippable phases, in order:

1. **Bootstrap** — runner config, helpers scaffold, env handling, docs. Empty integration tests folder; `npm test` passes against an empty suite. Gate: typecheck + lint + `npm test` (no DB tests yet).
2. **PostgREST isolation suite** — two `supabase-js` clients per test, minimal must-have matrix on both tables, F-01 regression. Gate: above + `npx supabase start && npm test` green.
3. **HTTP smoke** — programmatic `astro dev` in `globalSetup`, cookie-jar pattern via `supabase-js` sign-in, 401/404-collapse contract on the two DB-touching endpoints. Gate: above + the smoke suite green.

Each phase is reviewable in isolation. Phase 2 is the deliverable that closes Risk #2; Phase 3 is the smaller cherry-on-top that locks the 401/404 contract before the IDOR matrix ships in rollout Phase 3.

## Critical Implementation Details

- **`tests/setup.ts` must reject non-local Supabase before any admin client is constructed.** A test run pointed at a remote Supabase by accident (because someone copied `.dev.vars` over `.env.test` and the URL stayed remote) would let the admin client create real users in production. The guard is: read `SUPABASE_URL`; if it does not start with `http://127.0.0.1:54321` or `http://localhost:54321`, throw with a message naming the offending value. This guard runs once per worker via Vitest's `setupFiles`.
- **Two `supabase-js` clients per user, both `persistSession: false`.** Sharing storage between admin + user clients caused real flakiness in community write-ups ([index.garden: Challenges testing Supabase RLS with Vitest](https://index.garden/supabase-vitest/)). Encode as a helper constraint — every `createClient` call in `tests/helpers/**` must pass `{ auth: { persistSession: false } }`.
- **Email confirmations are off in `config.toml:209`.** The setup ritual is therefore `admin.auth.admin.createUser({ email, password, email_confirm: true })` immediately followed by `userClient.auth.signInWithPassword({ email, password })` — no Inbucket polling, no email round-trip. The `email_confirm: true` flag is mandatory (without it `signInWithPassword` fails with "Email not confirmed" even with confirmations disabled at the project level — they're separate switches).
- **`afterEach` teardown is `admin.auth.admin.deleteUser(userId)` per provisioned user.** `ON DELETE CASCADE` from `auth.users` wipes all `applications` and `application_notes` rows that user owned. No manual table cleanup.
- **HTTP smoke uses one global `astro dev` instance per Vitest run.** Cold start is ~3–5s. Vitest's `globalSetup` (separate file from `setupFiles`) owns the lifecycle: spawn `astro dev` on port 0, capture the chosen port into `process.env.TEST_BASE_URL`, return a teardown function. The smoke suite reads `TEST_BASE_URL` and uses `fetch`. Sign-in cookies are extracted from a one-shot `supabase-js` sign-in via the `Set-Cookie` header on the response and replayed verbatim.

## Phase 1: Test Bootstrap

### Overview

Land the Vitest runner, the `tests/` directory convention, env handling with the no-leak guard, and the docs that unblock test authorship. No DB tests yet — this phase's gate is "empty integration suite passes locally and CI stays green."

### Changes Required

#### 1. Test runner config

**File**: `vitest.config.ts` (new)

**Intent**: Wire Vitest to inherit the existing Astro/Vite config (including `astro:env/server` and the Cloudflare adapter) so test modules import `astro:env/server` and other Astro-native paths without bespoke configuration.

**Contract**: Default-exports the result of `getViteConfig({ test: { ... } })` from `astro/config`. `test.environment = 'node'`; `test.setupFiles = ['./tests/setup.ts']`; `test.globalSetup = ['./tests/global-setup.ts']`; `test.include = ['tests/**/*.test.ts']`; `test.testTimeout = 30_000` (cold `astro dev` plus a few RLS round trips). First line is `/// <reference types="vitest/config" />`.

#### 2. Per-worker setup with the no-leak guard

**File**: `tests/setup.ts` (new)

**Intent**: Run once per Vitest worker. Load `.env.test` via `dotenv`; assert `SUPABASE_URL` points at the local stack; refuse to start otherwise. This is the load-bearing guard that prevents a misconfigured run from creating users in production.

**Contract**: Imports `dotenv/config` first; reads `process.env.SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; throws an `Error` whose message names the offending `SUPABASE_URL` value if it does not match either `http://127.0.0.1:54321` or `http://localhost:54321`. Also throws if any of the three env vars is missing or empty. No exports — side-effect only.

#### 3. Global setup placeholder

**File**: `tests/global-setup.ts` (new)

**Intent**: Lifecycle hook for resources that must exist once across the whole run. Phase 1 has nothing to set up here yet (no HTTP server, no DB seed), so the file exports a no-op `default` function with a TODO comment naming Phase 3 (`astro dev`) as the first concrete user. Existing the file with the right shape now means Phase 3 adds the dev-server boot without restructuring config.

**Contract**: `export default async function setup() {}`. Optional `export async function teardown() {}` returning `void`. Vitest treats both as no-ops if undefined; the empty function is documentation that the slot exists.

#### 4. Admin / user client helpers

**File**: `tests/helpers/supabase-clients.ts` (new)

**Intent**: Single source of truth for the no-shared-session pattern. Hands out an admin client (service-role, for user provisioning only) and a factory for anon-key user clients with persistence off.

**Contract**: Exports `createAdminClient(): SupabaseClient<Database>` (uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `process.env`, options `{ auth: { persistSession: false, autoRefreshToken: false } }`). Exports `createUserClient(): SupabaseClient<Database>` (uses `SUPABASE_URL` + `SUPABASE_KEY`, same options). Both typed against `Database` from `src/lib/database.types.ts`. No singletons — every call returns a fresh client; tests own lifecycle.

#### 5. Per-test user lifecycle helper

**File**: `tests/helpers/users.ts` (new)

**Intent**: Compress the "create-user-then-sign-in" ritual into one call so tests stay focused on the policy under test. Encodes the `email_confirm: true` flag (separate from project-level email confirmations) and the `crypto.randomUUID()` email convention.

**Contract**: Exports `provisionUser(admin: SupabaseClient<Database>): Promise<{ userId: string; email: string; password: string; client: SupabaseClient<Database> }>`. Builds `email = \`u-${crypto.randomUUID()}@test.local\``, a fixed password (any value ≥ 6 chars to satisfy `config.toml:175`), calls `admin.auth.admin.createUser({ email, password, email_confirm: true })`, constructs a user client via `createUserClient()`, calls `client.auth.signInWithPassword({ email, password })`, returns the bundle. Exports `cleanupUser(admin, userId): Promise<void>` that calls `admin.auth.admin.deleteUser(userId)` and ignores 404 (idempotent so `afterEach` can run blindly).

#### 6. Test environment example

**File**: `.env.example`

**Intent**: Show contributors the exact shape of `.env.test` without committing the real local-Supabase keys. Sentinel values must look obviously wrong if a contributor accidentally points production at them.

**Contract**: Append a clearly delimited "Local test stack (.env.test)" block listing `SUPABASE_URL=http://127.0.0.1:54321`, `SUPABASE_KEY=<copy from \`npx supabase status\` 'anon key'>`, `SUPABASE_SERVICE_ROLE_KEY=<copy from \`npx supabase status\` 'service_role key' — LOCAL ONLY, never commit>`. The existing two-line production block stays. A comment line above the new block names `.env.test` as the target file.

#### 7. gitignore protection

**File**: `.gitignore`

**Intent**: Make `.env.test` git-ignored explicitly so the no-leak guard has a backstop. The existing `.env.*.local` pattern does not cover `.env.test`.

**Contract**: Add `.env.test` to the existing `# environment variables` block.

#### 8. Package scripts and dependencies

**File**: `package.json`

**Intent**: Add the test runner and the standalone `dotenv` package (needed to read `.env.test` because `astro:env/server` only handles `.env` and `.dev.vars`). Add `test` and `test:watch` scripts. Mark Node engine if not already set (Vitest 3 requires Node ≥ 20).

**Contract**: `devDependencies` gains `vitest` (latest 3.x), `@vitest/coverage-v8` (matched version), `dotenv` (latest). `scripts` gains `"test": "vitest run"` and `"test:watch": "vitest"`. Lockfile regenerates. No changes to `lint-staged` or husky hooks (test files are covered by the existing `*.{ts,tsx,astro}` ESLint rule).

#### 9. Tests README

**File**: `tests/README.md` (new)

**Intent**: One-page contributor doc for how to run the suite, what `.env.test` needs, and the no-mock / no-service-role-commit rules. Becomes the cross-link target from `AGENTS.md`.

**Contract**: Sections: "Prerequisites" (`npx supabase start`, `.env.test` populated from `npx supabase status`), "Run" (`npm test`, `npm run test:watch`), "Directory layout" (one paragraph naming `tests/setup.ts`, `tests/helpers/`, `tests/integration/`, `tests/http/`), "Conventions" (two-clients-per-user, `persistSession: false`, per-test ephemeral users), "Hard rules" (no mocking Supabase, no service-role in committed files, no asserting through `src/lib/services/`). Cross-links the test plan at `context/foundation/test-plan.md`.

#### 10. AGENTS.md hard rules update

**File**: `AGENTS.md`

**Intent**: Replace the "no test framework" rule with a concrete contract AI agents and humans must follow when writing tests. Captures the load-bearing rules (no mocking Supabase, no service-role in committed files) at the level where AI agents read them.

**Contract**: Replace the line `- No test framework is configured — do not scaffold tests. See \`@.github/workflows/ci.yml\` for the full pipeline. See \`@README.md\` → CI section for secrets setup.` with two lines: one naming Vitest as the runner, `tests/` as the location, and cross-linking `@tests/README.md`; one stating "Never mock the Supabase client in tests (RLS is the system under test), and never commit `SUPABASE_SERVICE_ROLE_KEY` to any tracked file." The CI cross-link moves to a separate bullet immediately after.

#### 11. README testing + CI section

**File**: `README.md`

**Intent**: Add a "Testing" section describing the local prereq (`npx supabase start`) and `.env.test` setup. Update the stale "CI" line so a reader knows that test gating arrives in a later phase and isn't expected from `master` yet.

**Contract**: Insert a new `## Testing` section between "Deployment" and "CI" with three subsections: prerequisites, env setup (`cp .env.example .env.test`, then fill from `npx supabase status`), commands (`npm test`, `npm run test:watch`). The "CI" section line 154 stays factually accurate (lint + build still run); append one sentence: "Integration tests are run locally today; CI integration is tracked in `context/foundation/test-plan.md` §3 Phase 4."

### Success Criteria

#### Automated Verification

- `npm install` completes without errors.
- `npm run typecheck` passes (Vitest types resolve via the `/// <reference>` directive).
- `npm run lint` passes (no new lint errors in `tests/` or `vitest.config.ts`).
- `npm test` exits 0 against an empty `tests/integration/` (Vitest reports "no tests found" as a non-fatal warning, not an error — confirm).
- `.env.test` is ignored by git: `git check-ignore .env.test` returns the file path (after creating it locally).
- `git grep "no test framework"` returns no matches in `AGENTS.md` or `README.md`.

#### Manual Verification

- Pointing `SUPABASE_URL` in `.env.test` at a non-local URL (e.g., the production one) causes `npm test` to fail with the guard's error message before any client is constructed.
- A new contributor can run `cp .env.example .env.test`, fill in three values from `npx supabase status`, run `npm test`, and see green.
- `AGENTS.md` reads cleanly to an AI agent — the no-mock and no-leak rules are unambiguous.

**Implementation Note**: After Phase 1 lands and all automated checks pass, pause for manual confirmation that the guard message is friendly and the README onboarding path is followable before starting Phase 2.

---

## Phase 2: Cross-User Isolation Suite (PostgREST)

### Overview

The Risk #2 deliverable. Minimal must-have set: cross-user negative cases on both tables, the F-01 regression, one anon-no-session smoke. All assertions at the row level via two anon `supabase-js` clients — no Astro handler, no HTTP. This is the suite the test plan §2 row for Risk #2 describes.

### Changes Required

#### 1. `applications` cross-user isolation

**File**: `tests/integration/rls-applications.test.ts` (new)

**Intent**: Three negative cases proving user A's session cannot see, update, or delete user B's `applications` row. Encodes the "RLS returns empty result, not an error" pattern that Postgres + RLS + PostgREST produces (the policy filters the row out of the result set; no permission error).

**Contract**: `beforeEach` provisions two users via `provisionUser`; user A inserts one row via `client.from('applications').insert({ source: 'a', position: 'P', company: 'C', status: 'Zaaplikowano' }).select().single()` (the schema's `user_id` is server-defaulted by RLS WITH CHECK + the `auth.uid()` from B's JWT… actually wait — the table's `user_id` has no DEFAULT, so the insert must set `user_id: userA.userId` explicitly; the RLS WITH CHECK then validates it matches `auth.uid()`). Three `it` blocks:
1. `userB.from('applications').select('*')` returns `data: []` and no error.
2. `userB.from('applications').update({ status: 'Rozmowa' }).eq('id', rowA.id).select()` returns `data: []` and no error (RLS makes the row invisible to UPDATE).
3. `userB.from('applications').delete().eq('id', rowA.id).select()` returns `data: []` and no error.

`afterEach` calls `cleanupUser` for both users.

#### 2. `application_notes` cross-user isolation

**File**: `tests/integration/rls-application-notes.test.ts` (new)

**Intent**: Same three negative cases on `application_notes`. Critical because there is no HTTP endpoint for this table — PostgREST is the only attack surface.

**Contract**: `beforeEach` provisions two users; user A inserts one application + one note via `userA.from('application_notes').insert({ application_id: appA.id, user_id: userA.userId, body: 'a-note' }).select().single()`. Three `it` blocks mirroring the `applications` suite: SELECT, UPDATE (`{ body: 'tampered' }`), DELETE — each returns `data: []` and no error. `afterEach` cleanup.

#### 3. F-01 cross-user write regression

**File**: `tests/integration/rls-application-notes-attack.test.ts` (new)

**Intent**: Encode the exact attack the `application_notes` hardening migration fixed: user B inserts a note `{ application_id = appA.id, user_id = userB.userId, body: 'hostile' }`. The hardened `application_notes_insert_own` WITH CHECK should reject this because the parent `EXISTS` clause fails (B does not own `appA`).

**Contract**: One `it` block. Provision two users, A inserts an application, B attempts the malicious insert. Assert `error` is non-null AND `error.code === '42501'` (Postgres `insufficient_privilege`, the standard code for RLS policy violations). Assert `data` is null. Also assert the row count in `application_notes` for `appA.id` (queried as `userA`) is zero — defence in depth that the policy didn't admit the row and then hide it.

#### 4. Unauthenticated anon-client smoke

**File**: `tests/integration/rls-unauthenticated.test.ts` (new)

**Intent**: Lock the "no `anon` policy exists, no `USING (true)` anywhere" invariant. A `supabase-js` client that never signs in should see zero rows from both tables, even if rows exist for other users.

**Contract**: One user provisioned (A) inserts one application + one note. A separate anon client created via `createUserClient()` (never signed in) calls `.from('applications').select('*')` and `.from('application_notes').select('*')` — both return `data: []` and no error.

### Success Criteria

#### Automated Verification

- `npx supabase start` is running; `npx supabase status` shows both anon and service-role keys.
- `npm test` exits 0 with all four integration files green (~7 test cases total).
- `npm run typecheck` still passes (the helpers' `SupabaseClient<Database>` generics catch schema drift).

#### Manual Verification

- Temporarily comment out the `EXISTS (SELECT 1 FROM public.applications ...)` clause in the `application_notes_insert_own` policy via a one-off SQL command (`alter policy ...`) — the F-01 regression test goes red. Revert.
- Drop the `applications_select_own` policy via SQL — the `userB cannot SELECT userA's row` test goes red (it now succeeds in seeing the row). Revert.
- Run `npm run test:watch`; modify a test; verify watch mode picks up the change without restarting Supabase.

**Implementation Note**: After Phase 2 lands and the manual mutation checks confirm the suite is actually catching regressions (not just passing by coincidence), pause before Phase 3.

---

## Phase 3: HTTP Smoke (Thin Option A)

### Overview

Lock the 401 (no cookie → unauthorized) and 404-collapse (PATCH wrong owner → exactly 404, never 403 or 500) contracts on the two DB-touching endpoints. One global `astro dev` instance, cookie-jar extraction from `supabase-js` sign-in, replayed verbatim via `fetch`. Cheaper than the full IDOR matrix (Phase 3 of the rollout) but enough to prevent the existence-leak regression class.

### Changes Required

#### 1. Programmatic `astro dev` lifecycle

**File**: `tests/global-setup.ts`

**Intent**: Promote the Phase 1 no-op into a real lifecycle hook. Spawn `astro dev` once per Vitest run on a random free port; export the chosen base URL via `process.env.TEST_BASE_URL`; tear down on completion. Single instance amortizes the ~3–5s cold start across the whole HTTP suite.

**Contract**: `export default async function setup()` spawns Astro via `import('astro').then(m => m.dev({ root: process.cwd(), server: { port: 0 } }))` (or a `child_process.spawn('npx', ['astro', 'dev', '--port', '0'])` fallback if the programmatic API does not surface the chosen port reliably). Polls until `GET /` returns; writes the resolved port to `process.env.TEST_BASE_URL = \`http://127.0.0.1:${port}\``. Returns an async teardown function that closes the server / kills the process. Hard timeout 30s.

#### 2. Cookie-jar helper

**File**: `tests/helpers/cookies.ts` (new)

**Intent**: Bridge `supabase-js` (which writes to its in-memory cookie store via the configured `storage` adapter, not via real `Set-Cookie` headers) into the format Astro middleware reads (`Cookie` request header parsed by `@supabase/ssr`). The trick is to drive a one-shot sign-in through a `fetch` interceptor that captures the `Set-Cookie` headers the Supabase Auth API returns, then replay them verbatim.

**Contract**: Exports `signInAndCaptureCookies(email: string, password: string): Promise<string>` returning the `Cookie` header string (`sb-...-auth-token=...`) ready to drop into subsequent `fetch` calls. Internally: constructs a fresh `createServerClient` (from `@supabase/ssr`) wired to a custom `cookies` adapter that accumulates writes into a `Map`, calls `signInWithPassword`, returns the serialized cookie string. This is the same path `src/lib/supabase.ts` uses, so the cookie format matches exactly what middleware expects.

#### 3. POST /api/applications HTTP smoke

**File**: `tests/http/post-applications.test.ts` (new)

**Intent**: Two assertions on the create endpoint — unauthenticated → 401; authenticated → 201 + row visible to the owning user via PostgREST.

**Contract**: `beforeEach` provisions one user, captures cookies via `signInAndCaptureCookies`. Two `it` blocks:
1. `fetch(\`${TEST_BASE_URL}/api/applications\`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(validBody) })` (no Cookie header) → response.status === 401.
2. Same request with `Cookie: <captured>` → response.status === 201; response JSON has `application.id`; a follow-up PostgREST `from('applications').select().eq('id', body.application.id)` as the same user returns one row.

#### 4. PATCH /api/applications/[id] HTTP smoke

**File**: `tests/http/patch-applications.test.ts` (new)

**Intent**: Lock the 404-collapse invariant. Two users (A, B); A inserts an application; B attempts to PATCH it. Must return exactly 404 (not 200, not 403, not 500). Plus a positive case so the test doesn't go green for the wrong reason.

**Contract**: `beforeEach` provisions A and B, captures both cookie strings, A creates one application via PostgREST. Three `it` blocks:
1. No cookie + valid body → status 401.
2. B's cookie + `PATCH /api/applications/<appA.id>` with `{ status: 'Rozmowa' }` → status **exactly** 404 (use `toBe(404)`, not `toBeGreaterThanOrEqual`).
3. A's cookie + same PATCH → status 200; response JSON has `application.status === 'Rozmowa'`; PostgREST follow-up shows `last_action_at` advanced past the creation time.

### Success Criteria

#### Automated Verification

- `npx supabase start` is running.
- `npm test` exits 0 with the integration + HTTP suites green (~12 test cases total across Phase 2 + Phase 3).
- `tests/global-setup.ts` releases the `astro dev` process cleanly (`ps` / `Get-Process` shows no orphaned `node`/`astro` after `npm test` finishes).
- `npm run typecheck` and `npm run lint` pass.

#### Manual Verification

- Kill `astro dev` mid-test (in watch mode) — the next run re-spawns it cleanly; no port conflicts.
- Temporarily change `src/pages/api/applications/[id].ts` to return 200 + the (non-matching) row instead of 404 for "exists but not owned" — the wrong-owner test goes red. Revert.
- Comment out the `context.locals.user` 401 short-circuit in either handler — the no-cookie test goes red. Revert.

**Implementation Note**: After Phase 3 lands, append a 2–3 line note to `context/foundation/test-plan.md` §6.6 capturing anything surprising (e.g., the `email_confirm: true` gotcha, the cookie-jar shape, the global-setup port management) for the next phase's authors.

---

## Testing Strategy

### Unit Tests

None in this phase. The minimal-must-have integration matrix is the right cost-per-signal level for Risk #2; isolated unit tests of the helpers themselves would lock implementation details, not behavior.

### Integration Tests

Defined in Phases 2 and 3. Summary of the matrix:

| Layer | File | What it proves |
|---|---|---|
| PostgREST | `rls-applications.test.ts` | Cross-user SELECT/UPDATE/DELETE on `applications` blocked |
| PostgREST | `rls-application-notes.test.ts` | Cross-user SELECT/UPDATE/DELETE on `application_notes` blocked |
| PostgREST | `rls-application-notes-attack.test.ts` | F-01 regression: B cannot insert note pointing at A's app |
| PostgREST | `rls-unauthenticated.test.ts` | Unauthenticated client sees zero rows on both tables |
| HTTP | `post-applications.test.ts` | 401 without cookie; 201 with cookie |
| HTTP | `patch-applications.test.ts` | 401 / 404-collapse / 200 — exact status codes |

### Manual Testing Steps

For each phase's success criteria, see the "Manual Verification" block above. The cross-cutting smoke is:

1. From a clean checkout, `npm install`, `npx supabase start`, `cp .env.example .env.test`, fill the three values from `npx supabase status`.
2. `npm test` → all green.
3. `npm run typecheck && npm run lint && npm run build` → all green (CI parity).
4. Mutate one policy as described in Phase 2 manual verification; re-run; see the targeted test go red; revert.

## Performance Considerations

- Phase 1 + Phase 2 total wall clock should stay under 15s (PostgREST round trips against a local stack are sub-100ms; ~7 tests with 2 users each = ~14 sign-in round trips).
- Phase 3 adds the `astro dev` cold start (~3–5s) once per run, amortized across the HTTP suite.
- `--watch` mode re-runs only changed files; the `astro dev` instance survives across runs via Vitest's `globalSetup` lifecycle.
- No coverage instrumentation in the default run; opt-in via `npm test -- --coverage`.

## Migration Notes

None. This phase only adds files; no schema migrations; no production code changes; no data migrations. The CI workflow is byte-identical before and after.

## References

- Test plan (source of truth for this rollout): `context/foundation/test-plan.md` §2 Risk #2, §3 Phase 1, §6.2
- Research doc: `context/changes/testing-bootstrap-and-data-isolation/research.md`
- Single SSR client factory: `src/lib/supabase.ts:1-25`
- Auth middleware (the gate this phase tests indirectly): `src/middleware.ts:1-25`
- Endpoints under test in Phase 3:
  - `src/pages/api/applications/index.ts:19-50`
  - `src/pages/api/applications/[id].ts:12-51`
- RLS policies under test in Phase 2:
  - `supabase/migrations/20260526123145_applications_schema.sql` (both tables, all 4 verbs)
  - `supabase/migrations/20260526132205_harden_application_notes_rls.sql:20-44` (F-01 patch)
- Astro testing guide (canonical Vitest setup): https://docs.astro.build/en/guides/testing/
- Supabase local testing overview: https://supabase.com/docs/guides/local-development/testing/overview
- Community write-up on the two-clients-per-user pattern: https://index.garden/supabase-vitest/

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test Bootstrap

#### Automated

- [x] 1.1 `npm install` completes without errors
- [x] 1.2 `npm run typecheck` passes
- [x] 1.3 `npm run lint` passes
- [x] 1.4 `npm test` exits 0 against an empty `tests/integration/`
- [x] 1.5 `.env.test` is git-ignored
- [x] 1.6 `git grep "no test framework"` returns no matches in `AGENTS.md` or `README.md`

#### Manual

- [x] 1.7 Non-local `SUPABASE_URL` in `.env.test` causes `npm test` to fail with the guard's error
- [x] 1.8 A new contributor can `cp .env.example .env.test`, fill 3 values, and `npm test` green
- [x] 1.9 `AGENTS.md` reads cleanly — no-mock and no-leak rules are unambiguous

### Phase 2: Cross-User Isolation Suite (PostgREST)

#### Automated

- [x] 2.1 `npx supabase start` running; `npx supabase status` shows both anon and service-role keys
- [x] 2.2 `npm test` exits 0 with all four integration files green
- [x] 2.3 `npm run typecheck` still passes

#### Manual

- [x] 2.4 Removing the `EXISTS` clause in `application_notes_insert_own` makes the F-01 regression test go red
- [x] 2.5 Dropping `applications_select_own` makes the cross-user SELECT test go red
- [x] 2.6 `npm run test:watch` picks up file changes without restarting Supabase

### Phase 3: HTTP Smoke (Thin Option A)

#### Automated

- [x] 3.1 `npx supabase start` running
- [x] 3.2 `npm test` exits 0 with integration + HTTP suites green
- [x] 3.3 `tests/global-setup.ts` releases the `astro dev` process cleanly (no orphan processes)
- [x] 3.4 `npm run typecheck` and `npm run lint` pass

#### Manual

- [x] 3.5 Killing `astro dev` then quitting (`q`) and restarting `npm run test:watch` re-spawns cleanly with no port conflicts. Note: `globalSetup` runs once per vitest invocation, not per watch re-run — mid-watch re-spawn is not possible; restarting vitest is required.
- [x] 3.6 Returning 200 instead of 404 for "exists but not owned" makes the wrong-owner test go red
- [x] 3.7 Removing the `context.locals.user` 401 short-circuit makes the no-cookie test go red
- [x] 3.8 Test plan §6.6 updated with a 2–3 line note on Phase 1 surprises
