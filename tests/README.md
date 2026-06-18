# Tests

Integration tests for JobTracker using Vitest against a local Supabase stack.

## Prerequisites

1. Install the Supabase CLI (already a devDependency): no extra step needed.
2. Start the local Supabase stack:

```bash
npx supabase start
```

3. Create and populate `.env.test`:

```bash
cp .env.example .env.test
# then fill the three test-stack values from:
npx supabase status
```

## Run

```bash
npm test           # single run
npm run test:watch # watch mode — re-runs on file changes
```

## Pools

The suite runs two Vitest project pools in one `npm test` invocation:

| Pool | Runner | Config key | Tests |
|------|--------|-----------|-------|
| **node** | Node.js (default) | `name: "node"` in `vitest.config.ts` | `tests/integration/**`, `tests/http/**`, `tests/unit/parsers/recognize.test.ts` |
| **workers** | `@cloudflare/vitest-pool-workers` (workerd) | `name: "workers"` in `vitest.config.ts` | `tests/unit/parsers/linkedin.test.ts`, `tests/unit/parsers/justjoinit.test.ts` |

**When to use which pool:**
- Add a test to the **node** pool if it uses Supabase, spawns processes, or has no workerd dependency.
- Add a test to the **workers** pool if it calls `HTMLRewriter` directly (i.e., parser unit tests that need the workerd global).
- `tests/unit/parsers/recognize.test.ts` is a pure-function test — no `HTMLRewriter` — so it runs in the node pool.

Both pools share `globalSetup: ["./tests/global-setup.ts"]` (starts `astro dev`); only the node pool loads `setupFiles: ["./tests/setup.ts"]` (Supabase URL guard).

## Directory layout

- `tests/setup.ts` — per-worker setup; loads `.env.test` via dotenv and hard-asserts `SUPABASE_URL` points at the local stack before any client is constructed. Node pool only.
- `tests/global-setup.ts` — per-run lifecycle hook; temporarily swaps `.dev.vars` to the local Supabase stack values (so `astro dev` connects to the test DB via `getPlatformProxy()`) and spawns `astro dev` on a free port for the HTTP smoke suite. Vitest itself reads from `.env.test` via `tests/setup.ts`.
- `tests/helpers/` — shared utilities: `supabase-clients.ts` (admin + user client factories), `users.ts` (ephemeral user provisioning and cleanup), `fetch.ts` (in-process `fetch` stub via `vi.stubGlobal`; used by endpoint and parser hardening tests).
- `tests/integration/` — PostgREST-level RLS suites; no HTTP, no Astro handler.
- `tests/http/` — HTTP smoke suite; drives Astro dev server via fetch.
- `tests/unit/parsers/` — parser unit tests (workers pool) and `recognize()` classifier (node pool).
- `tests/fixtures/parsers/` — captured HTML fixtures for LinkedIn and JustJoin.it parser tests; see `tests/fixtures/parsers/README.md` for capture procedure.

## Conventions

- **Two clients per user** — each user gets its own `supabase-js` client instance. Never share storage between the admin client and a user client (causes session flakiness).
- **`persistSession: false`** — all clients created via `createUserClient()` / `createAdminClient()` have `auth: { persistSession: false }`. This prevents cross-test session bleed.
- **Ephemeral users per test** — `provisionUser(admin)` creates a fresh `u-<uuid>@test.local` user for each test; `cleanupUser(admin, userId)` deletes it in `afterEach`. `ON DELETE CASCADE` from `auth.users` wipes all owned rows automatically.

## Hard rules

- **No mocking Supabase** — RLS policies are the system under test. Mocking the client bypasses them and gives false confidence.
- **No service-role key in committed files** — `SUPABASE_SERVICE_ROLE_KEY` lives in `.env.test` (git-ignored) and is accessed only via `createAdminClient()` in `tests/helpers/`.
- **Never assert through `src/lib/services/`** — assert at the row level (PostgREST responses) so a policy regression is caught even if the service layer is updated.

See the full test rollout plan at `context/foundation/test-plan.md`.
