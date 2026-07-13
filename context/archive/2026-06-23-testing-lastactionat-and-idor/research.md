---
date: 2026-06-23T08:49:18+0200
researcher: Dawid Nowak
git_commit: 97c295b1547c37baf761f4b407b3d2c4cc5a15e4
branch: master
repository: DawidNowak/JobTracker
topic: "Domain invariants — lastActionAt trigger semantics + applications endpoint IDOR (test rollout Phase 3)"
tags: [research, codebase, lastActionAt, trigger, idor, rls, integration-tests, supabase]
status: complete
last_updated: 2026-06-23
last_updated_by: Dawid Nowak
last_updated_note: "Resolved all four open questions; recorded decisions for the plan stage"
---

# Research: Domain invariants — lastActionAt trigger + applications endpoint IDOR

**Date**: 2026-06-23T08:49:18+0200
**Researcher**: Dawid Nowak
**Git Commit**: 97c295b1547c37baf761f4b407b3d2c4cc5a15e4
**Branch**: master
**Repository**: DawidNowak/JobTracker

## Research Question

Ground the test design for rollout Phase 3 of `context/foundation/test-plan.md` ("Domain invariants — lastActionAt + IDOR"), covering:

- **Risk #3** — prove all four `lastActionAt` invariants hold at the SQL row level (INSERT sets it to `created_at`; status change resets to now; `application_notes` INSERT resets the parent to now; a non-status field edit leaves it unchanged) and that they survive the next migration. Assert at the row level, never through the service-layer abstraction.
- **Risk #5** — prove that for each verb and each owner/actor combination, a request as user B against user A's UUID returns exactly **404** (not 200/500/403-that-leaks-existence) and never executes the mutation — defence in depth, independent of RLS.

Scope (confirmed with user): full test-design dive; IDOR sweep limited to the applications endpoints.

## Summary

The codebase is well-positioned for both test families, but **one scope assumption in the change brief and test-plan §6.3 does not match the live code** and reshapes the IDOR design:

> **The applications API exposes only two handlers: `POST /api/applications` and `PATCH /api/applications/[id]`. There is no GET, PUT, or DELETE handler anywhere under `src/pages/api/`.** (Confirmed by direct inspection — `[id].ts` exports only `PATCH`; `index.ts` exports only `POST`; a repo-wide grep for `export const GET|PUT|DELETE` under `src/pages/api/` returns nothing.)

Consequences for Risk #5:

- The HTTP-layer **(verb × owner × actor)** ownership matrix can only be exercised for **PATCH `/api/applications/[id]`** (the one mutating, id-addressed verb). POST has no id to attack; `parse.ts` is stateless and IDOR-irrelevant.
- A cross-user PATCH already returns **404** today, via the right mechanism: the service query carries an explicit `.eq("user_id", userId)` clause and uses `.maybeSingle()`, so a non-owned row resolves to `null` → handler returns 404 (`src/lib/services/applications.ts:20-38`, `src/pages/api/applications/[id].ts:40-46`). This is exactly the defence-in-depth the risk asks for — there is already an existing test asserting it (`tests/http/patch-applications.test.ts`).
- SELECT / DELETE / non-status UPDATE ownership has **no HTTP surface**, so those legs of the matrix can only be (and already are) proven at the **RLS/PostgREST layer** in `tests/integration/rls-applications.test.ts`. The Phase 3 plan should explicitly state this split rather than write HTTP tests for verbs that don't exist.

For Risk #3, all four invariants are real, row-level assertable, and need **no new test infrastructure** — they can be read through the admin (service-role) Supabase client over PostgREST columns (`created_at`, `last_action_at`), the pattern `tests/http/patch-applications.test.ts:67-74` already uses. There is **no `pg`/raw-SQL client** in the repo; introducing one is unnecessary because every column the invariants assert on is PostgREST-selectable.

A subtlety worth a dedicated test: the status-change trigger is `BEFORE UPDATE ... WHEN (old.status IS DISTINCT FROM NEW.status)`. A non-status edit does **not** fire it, so the "unchanged" invariant is genuine — but it also means a write that directly sets `last_action_at` on a non-status edit would _not_ be corrected by the trigger. No API path allows that today (PATCH only accepts `status`), so this is a row-level note, not an endpoint hole.

## Detailed Findings

### Risk #3 — lastActionAt trigger mechanics

**Schema & triggers** — `supabase/migrations/20260526123145_applications_schema.sql`:

- `applications.last_action_at timestamptz not null default now()` and `created_at timestamptz not null default now()` (lines ~24-26). Both default to `now()`, which is **transaction-start time and stable within a statement**, so on a single INSERT they are _exactly equal_ — the equality is a reliable assertion, not a "within N ms" approximation.
- Status-bump trigger (lines 108-122):

  ```sql
  create or replace function public.applications_bump_last_action_at_on_status_change()
  returns trigger language plpgsql as $$
  begin
    new.last_action_at = now();
    return new;
  end; $$;

  create trigger applications_status_bumps_last_action
    before update on public.applications
    for each row
    when (old.status is distinct from new.status)
    execute function public.applications_bump_last_action_at_on_status_change();
  ```

  The `WHEN (old.status is distinct from new.status)` guard is what makes the "non-status edit leaves it unchanged" invariant true.

- Note → parent bump (lines 128-157): a `SECURITY DEFINER` helper `bump_application_last_action_at(app_id uuid)` (with `set search_path = ''`) does `update public.applications set last_action_at = now() where id = app_id`, called from an **AFTER INSERT** trigger `application_notes_bumps_parent_last_action` on `application_notes` via `application_notes_bump_parent_trigger()`.

**Hardening migration** — `supabase/migrations/20260528153903_lock_trigger_function_search_path.sql:16-36` recreates both plpgsql trigger functions with `set search_path = ''` (the SECURITY DEFINER helper already had it). This is the "triggers are in scope for follow-up patches" evidence the test-plan cites — the regression test must re-run green against the DB _after_ all migrations are applied.

**No direct writes from app code** (the anti-pattern the risk warns about is absent):

- `createApplication()` inserts `{ ...input, user_id: userId }` only — no `last_action_at` (`src/lib/services/applications.ts:40-54`).
- `updateApplicationStatus()` updates `{ status }` only (`src/lib/services/applications.ts:20-38`).
- The only `last_action_at` assignment in TS is an **optimistic client-side UI** update in `src/components/board/KanbanBoard.tsx:70` (local React state after drag; the API call sends `{ status }` only). The DB value is trigger-driven. The auto-generated `Insert`/`Update` types mark `last_action_at?` optional (`src/lib/database.types.ts:96,111`) but no code exploits it.

**Status enum** (the values a status change moves between): `["Interesujące", "Zaaplikowano", "Rozmowa"]` — `src/lib/validation/applications.ts:3`, mirrored by a CHECK constraint in the schema migration (default `'Interesujące'`).

**Table/column names** (snake_case in DB): `applications(id, user_id, status, created_at, last_action_at)`; `application_notes(id, application_id, user_id, body, created_at)`.

**Four invariants to assert (row level, via admin client):**

1. After INSERT → `last_action_at == created_at`.
2. After status UPDATE (e.g. `Interesujące` → `Zaaplikowano`) → `last_action_at > created_at` (advanced to now).
3. After non-status UPDATE (e.g. `source`) → `last_action_at` unchanged from its pre-edit value.
4. After `application_notes` INSERT → parent `last_action_at` advanced to now.
   (Plus the implicit "survives the migrated DB" property: the suite runs against the fully-migrated local stack.)

### Risk #5 — applications endpoint IDOR

**Endpoint inventory** (`src/pages/api/applications/`):

- `index.ts` — `POST` only (create). Uses `createClient(headers, cookies)` then `createApplication(supabase, data, user.id)` with explicit `user_id: userId`; 401 if no `context.locals.user`; 422 on validation; 500 if insert throws. No id, so not an IDOR target.
- `[id].ts` — `PATCH` only (status update). Validates `idParam` against `uuidSchema` (400 on malformed); calls `updateApplicationStatus(supabase, idParam, status, user.id)`; **`null` row → 404** (lines 40-46).
- `parse.ts` — stateless URL parse; no DB ownership; out of scope for IDOR.

**Why a cross-user PATCH is already 404** — `src/lib/services/applications.ts:20-38`:

```ts
const { data, error } = await supabase
  .from("applications")
  .update({ status })
  .eq("id", id)
  .eq("user_id", userId) // explicit ownership clause — defence in depth, not RLS-only
  .select("*")
  .maybeSingle(); // not-owned / not-found → data === null
```

The `.eq("user_id", userId)` is the positive enforcement the risk wants; `.maybeSingle()` + the handler's `if (!row) return 404` collapses "not found" and "not yours" into an identical 404 with no existence leak.

**Auth plumbing** — `src/middleware.ts:1-25`: builds the SSR client from cookies, sets `context.locals.user = (await supabase.auth.getUser()).user ?? null`. `PROTECTED_ROUTES` (`/dashboard`, `/archive`) redirect when unauthenticated; API routes don't redirect — each handler returns 401 itself.

**Client type** — single client factory `createClient(headers, cookies)` in `src/lib/supabase.ts:6-25`, a `@supabase/ssr` `createServerClient` using `SUPABASE_KEY` (anon) + the user's cookie session. **No service-role/admin client is used anywhere in `src/`** (grep for `SUPABASE_SERVICE_ROLE` in app code is empty). The only `SECURITY DEFINER` privilege is the in-DB note-bump function, unreachable from API code.

**application_notes** — no HTTP write endpoint exists; ownership is enforced purely by RLS, hardened in `supabase/migrations/20260526132205_harden_application_notes_rls.sql:17-44` (INSERT/UPDATE `with check` adds an `EXISTS` clause proving the parent application belongs to `auth.uid()`). The cross-user note-write attack is already covered by `tests/integration/rls-application-notes-attack.test.ts` (asserts error `42501`).

**Revised IDOR matrix for the plan:**
| Verb | HTTP surface? | Where to test |
|---|---|---|
| PATCH `/api/applications/[id]` | yes | HTTP: B-vs-A → exactly 404; owner → 200 + DB confirmed. Template: `tests/http/patch-applications.test.ts` |
| POST `/api/applications` | yes (no id) | not an IDOR target; existing `post-applications.test.ts` covers auth + ownership-on-create |
| GET / PUT / DELETE | **none** | no HTTP test possible; SELECT/UPDATE/DELETE ownership proven at RLS layer in `tests/integration/rls-applications.test.ts` |

### Existing test infrastructure (no new infra required)

- **Pools** — `vitest.config.ts`: a **node** pool (`tests/integration/**`, `tests/http/**`, two parser unit files) and a **workers** pool (HTMLRewriter parser tests, via `wrangler.test.jsonc`). Phase 3 tests land in `tests/integration/` (row-level) and `tests/http/` (PATCH matrix) — **both already in node-pool include globs, no config change**. `testTimeout: 30_000`.
- **Global setup** — `tests/global-setup.ts`: swaps `.dev.vars` to the local-stack creds, spawns `astro dev` on a free 127.0.0.1 port, polls readiness (60s), sets `process.env.TEST_BASE_URL`, restores `.dev.vars` on teardown (Windows `taskkill /F /T`). `tests/setup.ts` (node pool) hard-asserts `SUPABASE_URL` points at `127.0.0.1:54321`/`localhost:54321`.
- **Helpers** — `tests/helpers/supabase-clients.ts`: `createAdminClient()` (service role, bypasses RLS — use for canonical row reads) and `createUserClient()` (anon). `tests/helpers/users.ts`: `provisionUser(admin)` → `{ userId, email, password, client }` (signed-in), `cleanupUser(admin, userId)` (delete user; `ON DELETE CASCADE` wipes owned rows). `tests/helpers/cookies.ts`: `signInAndCaptureCookies(email, password) → Cookie header string`. **No "seed application" helper exists** — tests insert inline; consider a small Phase 3 seeder.
- **DB access** — **no `pg`/raw SQL**; all direct DB access is PostgREST via supabase-js. Trigger-invariant reads should use `createAdminClient().from("applications").select("created_at,last_action_at")`. Precedent for a trigger-advance assertion: `tests/http/patch-applications.test.ts:67-74`.
- **Scripts** — `package.json`: `"test": "vitest run"` (all pools, one invocation), `"test:watch": "vitest"`. No `test:integration` split. Local stack started manually via `npx supabase start`; creds filled into `.env.test` from `npx supabase status`.
- **Existing ownership-pattern precedents to mirror**: `tests/http/patch-applications.test.ts` (two-user HTTP 404), `tests/integration/rls-applications.test.ts`, `rls-application-notes.test.ts`, `rls-application-notes-attack.test.ts`, `rls-unauthenticated.test.ts`.

## Code References

- `supabase/migrations/20260526123145_applications_schema.sql:24-26` — `created_at` / `last_action_at` both default `now()`
- `supabase/migrations/20260526123145_applications_schema.sql:108-122` — status-change BEFORE UPDATE trigger + `WHEN` guard
- `supabase/migrations/20260526123145_applications_schema.sql:128-157` — SECURITY DEFINER parent bump + AFTER INSERT trigger on `application_notes`
- `supabase/migrations/20260528153903_lock_trigger_function_search_path.sql:16-36` — `set search_path = ''` hardening of both trigger functions
- `supabase/migrations/20260526132205_harden_application_notes_rls.sql:17-44` — note INSERT/UPDATE RLS with parent-ownership EXISTS clause
- `src/lib/services/applications.ts:20-38` — `updateApplicationStatus` with `.eq("user_id", userId)` + `.maybeSingle()`
- `src/lib/services/applications.ts:40-54` — `createApplication` (no direct `last_action_at` write)
- `src/pages/api/applications/[id].ts:12-51` — PATCH handler (only verb on the route); 404 on null row
- `src/pages/api/applications/index.ts:19-50` — POST handler (only verb on the collection)
- `src/middleware.ts:1-25` — `context.locals.user` population + protected-route redirects
- `src/lib/supabase.ts:6-25` — sole client factory (anon + user cookies; no service role)
- `src/lib/validation/applications.ts:3` — status enum values
- `src/components/board/KanbanBoard.tsx:70` — optimistic client-only `last_action_at` (not a DB write)
- `vitest.config.ts:10-39` — globalSetup + node/workers pools and include globs
- `tests/global-setup.ts` — astro dev spawn, `.dev.vars` swap, `TEST_BASE_URL`
- `tests/helpers/{supabase-clients,users,cookies}.ts` — admin/user clients, provisioning, cookie capture
- `tests/http/patch-applications.test.ts` — two-user 404 + trigger-advance precedent
- `tests/integration/rls-applications.test.ts` — RLS-layer SELECT/UPDATE/DELETE ownership matrix

## Architecture Insights

- **Defence in depth is real, not aspirational**: the mutating endpoint enforces ownership in _both_ the app query (`.eq("user_id", …)`) and RLS. A future regression to a service-role client would lose RLS but keep the explicit clause; dropping the clause would lose the app check but keep RLS. The Phase 3 tests should pin _both_ layers (HTTP for the app-query path, integration/RLS for the policy path) so either regression reds a test.
- **404-collapse is a deliberate existence-leak guard** (`.maybeSingle()` → `null` → 404). Tests must assert `toBe(404)` exactly, never `toBeGreaterThanOrEqual` — per test-plan §6.3.
- **The mutation surface is intentionally tiny** (POST + PATCH-status only). Status-only PATCH is _why_ the "non-status edit unchanged" invariant has no HTTP path and must be asserted at the row level.
- **PostgREST is sufficient as the assertion oracle** for trigger invariants; a raw pg connection would be net-new infra for zero added signal, since `created_at`/`last_action_at` are selectable columns.
- **`now()` transaction-stability** makes invariant #1 an exact equality and invariants #2/#4 a strict `>` against the captured pre-state — deterministic without sleeps.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:44,46` (Risk register #3/#5) and `:55,57` (Risk Response Guidance) — the canonical "what would prove protection" rows this research grounds.
- `context/foundation/test-plan.md:70` — rollout table row 3, status `change opened`.
- `context/foundation/test-plan.md:179-226` (§6.3 "Adding a test for a new API endpoint") — documents the HTTP smoke shape and the **two-user ownership matrix asserting exactly 404**. Note its wording ("each verb GET/PUT/DELETE") predates this research and over-states the live surface; the plan should narrow it to PATCH + the RLS layer.
- `context/changes/testing-bootstrap-and-data-isolation/` — Phase 1; built the cookie/global-setup/RLS integration infrastructure Phase 3 reuses.
- `context/changes/parser-correctness-and-abuse-surface/` — Phase 2; established the node/workers two-pool split.

## Related Research

- None prior for this change; this is the first `research.md` under `context/changes/testing-lastactionat-and-idor/`.

## Resolved Decisions (2026-06-23)

All four open questions were resolved with the user before planning:

1. **IDOR scope** — Test only the live **PATCH** surface at the HTTP layer (B-vs-A → exactly 404; owner → 200 + DB confirmed); cover SELECT/UPDATE/DELETE ownership at the **RLS/integration layer** (`tests/integration/rls-applications.test.ts`). **Also amend test-plan §6.3's "GET/PUT/DELETE" verb list** to match the live surface (PATCH + RLS), as part of this change.
2. **Non-status-edit invariant** — Assert at the **row level** via an admin/user-client UPDATE of **`source`** (a non-status column), reading `last_action_at` before/after; no API path edits non-status fields.
3. **Trigger-bypass abuse case** — **Document, don't test.** Note in the plan as a known property that a direct `last_action_at` write on a non-status edit is not corrected by the trigger; no API path reaches it, so no negative test is written.
4. **Application seeder** — **Add a small `seedApplication(client, overrides)` helper** under `tests/helpers/` to cut inline-insert duplication across the new trigger + matrix suites.

## Open Questions

None remaining — ready for `/10x-plan`.
