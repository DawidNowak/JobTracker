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

| Pool        | Runner                                      | Config key                              | Tests                                                                           |
| ----------- | ------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| **node**    | Node.js (default)                           | `name: "node"` in `vitest.config.ts`    | `tests/integration/**`, `tests/http/**`, `tests/unit/parsers/recognize.test.ts` |
| **workers** | `@cloudflare/vitest-pool-workers` (workerd) | `name: "workers"` in `vitest.config.ts` | `tests/unit/parsers/linkedin.test.ts`, `tests/unit/parsers/justjoinit.test.ts`  |

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

## Parser fixtures

HTML payloads stored under `tests/fixtures/parsers/{linkedin,justjoinit}/` are the fixtures for
the workers-pool parser unit tests. Three scenarios per portal:

| Scenario         | File                                            | Description                                                                     |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `happy`          | Fixture with all 5 ParseResult fields populated | Asserts correct extraction of position, company, description, salary, work_mode |
| `missing-salary` | Fixture where salary is genuinely absent        | Asserts `salary === undefined`; all expected fields still extracted             |
| `corrupted`      | happy fixture with a critical element removed   | Asserts the parser throws (→ `fetch_failed` envelope)                           |

See `tests/fixtures/parsers/README.md` for the capture procedure, source URLs, and capture dates.

**Oracle rule**: assertions in the test files are hardcoded values read from the visible page at
capture time — **never** derived by running the parser and freezing its output.

## Conventions

- **Two clients per user** — each user gets its own `supabase-js` client instance. Never share storage between the admin client and a user client (causes session flakiness).
- **`persistSession: false`** — all clients created via `createUserClient()` / `createAdminClient()` have `auth: { persistSession: false }`. This prevents cross-test session bleed.
- **Ephemeral users per test** — `provisionUser(admin)` creates a fresh `u-<uuid>@test.local` user for each test; `cleanupUser(admin, userId)` deletes it in `afterEach`. `ON DELETE CASCADE` from `auth.users` wipes all owned rows automatically.

## Hard rules

- **No mocking Supabase** — RLS policies are the system under test. Mocking the client bypasses them and gives false confidence.
- **No service-role key in committed files** — `SUPABASE_SERVICE_ROLE_KEY` lives in `.env.test` (git-ignored) and is accessed only via `createAdminClient()` in `tests/helpers/`.
- **Never assert through `src/lib/services/`** — assert at the row level (PostgREST responses) so a policy regression is caught even if the service layer is updated.

See the full test rollout plan at `context/foundation/test-plan.md`.

## Browser verification (agent-driven)

For interactive UI verification (not a test gate — e2e was deliberately dropped for MVP, see `context/foundation/test-plan.md` §7), an agent or human can drive an authenticated browser session against the local app via `playwright-cli`: `npm run e2e:session [-- --seed <n>]` provisions an ephemeral user and prints credentials + a `Cookie:` header, then the `.claude/skills/e2e-browser/SKILL.md` playbook covers sign-in, routes/selectors, the `wrangler dev` variant, and teardown (see also `scripts/e2e-session.ts`). Auth is persisted via `playwright-cli state-save auth.json` after a one-time form sign-in and restored in later shells with `state-load auth.json`. Caveat: an `internal error; reference = …` on the sign-in form under `astro dev` means a stale/wedged dev-server process — kill it and restart the server; it is not an auth bug.

## CI

The `test` job in `.github/workflows/ci.yml` runs `npm test` on every push to `master` and every PR targeting `master`. It is a **required status check** — a red suite blocks merge.

### How the stack is provisioned in CI

No GitHub secrets are needed for the test stack. The job:

1. Starts a local Supabase stack: `npx supabase start` (boots Postgres + Auth + PostgREST, applies `supabase/migrations/`).
2. Derives `.env.test` at runtime:
   ```bash
   npx supabase status -o env \
     --override-name api.url=SUPABASE_URL \
     --override-name auth.anon_key=SUPABASE_KEY \
     --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
     > .env.test
   ```
   The local stack always issues the same well-known demo JWTs, so they are not secrets.
3. Runs `npm test` (both `node` and `workers` pools). `tests/global-setup.ts` spawns `astro dev` automatically — no separate dev-server step in CI.
4. Stops the stack in a cleanup step (`npx supabase stop --no-backup`, `if: always()`).

If the `test` check is red on your PR, inspect the job log: look for the `supabase start` step (boots in ~1–3 min) and the `npm test` output to identify the failing test.
