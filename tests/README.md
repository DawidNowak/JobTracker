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

## Directory layout

- `tests/setup.ts` — per-worker setup; loads `.env.test` via dotenv and hard-asserts `SUPABASE_URL` points at the local stack before any client is constructed.
- `tests/global-setup.ts` — per-run lifecycle hook; temporarily swaps `.dev.vars` to the local Supabase stack values (so `astro dev` connects to the test DB via `getPlatformProxy()`) and spawns `astro dev` on a free port for the HTTP smoke suite. Vitest itself reads from `.env.test` via `tests/setup.ts`.
- `tests/helpers/` — shared utilities: `supabase-clients.ts` (admin + user client factories) and `users.ts` (ephemeral user provisioning and cleanup).
- `tests/integration/` — PostgREST-level RLS suites; no HTTP, no Astro handler.
- `tests/http/` — HTTP smoke suite (Phase 3); drives Astro dev server via fetch.

## Conventions

- **Two clients per user** — each user gets its own `supabase-js` client instance. Never share storage between the admin client and a user client (causes session flakiness).
- **`persistSession: false`** — all clients created via `createUserClient()` / `createAdminClient()` have `auth: { persistSession: false }`. This prevents cross-test session bleed.
- **Ephemeral users per test** — `provisionUser(admin)` creates a fresh `u-<uuid>@test.local` user for each test; `cleanupUser(admin, userId)` deletes it in `afterEach`. `ON DELETE CASCADE` from `auth.users` wipes all owned rows automatically.

## Hard rules

- **No mocking Supabase** — RLS policies are the system under test. Mocking the client bypasses them and gives false confidence.
- **No service-role key in committed files** — `SUPABASE_SERVICE_ROLE_KEY` lives in `.env.test` (git-ignored) and is accessed only via `createAdminClient()` in `tests/helpers/`.
- **Never assert through `src/lib/services/`** — assert at the row level (PostgREST responses) so a policy regression is caught even if the service layer is updated.

See the full test rollout plan at `context/foundation/test-plan.md`.
