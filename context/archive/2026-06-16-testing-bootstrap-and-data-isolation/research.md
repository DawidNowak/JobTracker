---
date: 2026-06-16T00:00:00+02:00
researcher: Dawid Nowak
git_commit: 1433f7210ec910042d6b3df3903ae0f2bbb1fa3a
branch: master
repository: DawidNowak/JobTracker
topic: "Test bootstrap (Vitest runner + directory convention) and cross-user RLS data-isolation guard for `applications` and `application_notes`"
tags: [research, codebase, testing, vitest, supabase, rls, integration-tests, phase-1]
status: complete
last_updated: 2026-06-16
last_updated_by: Dawid Nowak
---

# Research: Test bootstrap + data-isolation guard (rollout phase 1)

**Date**: 2026-06-16 (Europe/Warsaw)
**Researcher**: Dawid Nowak
**Git Commit**: 1433f7210ec910042d6b3df3903ae0f2bbb1fa3a
**Branch**: master
**Repository**: DawidNowak/JobTracker

## Research Question

Phase 1 of `context/foundation/test-plan.md` opens this change folder. The phase has two coupled goals:

1. **Test bootstrap** — pick the runner (Vitest is the named candidate, as the natural fit for the Astro 6 + Vite + Cloudflare Workers stack), establish a directory/location convention for tests, and revise the `AGENTS.md` "no test framework — do not scaffold tests" rule that currently blocks all test code.
2. **Data-isolation guard (Risk #2 in §2 of the test plan)** — prove at the SQL/row level, through the **real** Supabase SSR client driven against a **local** Supabase (`supabase start`), that user A's session cannot SELECT/UPDATE/DELETE rows owned by user B in both the `applications` and `application_notes` tables. Anti-patterns the test plan explicitly forbids: mocking Supabase (RLS is the system under test) and asserting via the service-layer abstraction (assert at the row level so trigger/policy regressions are still caught).

## Summary

The codebase is in a good shape to land Phase 1 with low risk:

- **Single SSR client factory.** `src/lib/supabase.ts` exports one `createClient(headers, cookies)` that returns a `@supabase/ssr` `createServerClient` bound to the anon `SUPABASE_KEY`. The same factory is used by `src/middleware.ts` AND by every API handler — there is **no service-role path anywhere in `src/`** (grep-verified). This means tests can either drive the API handlers and trust that any auth bypass would be a real bug, or talk to PostgREST directly with two anon `supabase-js` clients and still exercise the production RLS surface.
- **API surface for `applications` is narrow.** Only three endpoints exist: `POST /api/applications` (create), `PATCH /api/applications/[id]` (status change only), `POST /api/applications/parse` (no DB touch). There are **no endpoints for `application_notes`** and no DELETE/archive endpoint for `applications` yet. That means **API-layer IDOR testing in Phase 1 is essentially the PATCH endpoint plus the listing path (which lives in services, not an API route)**; `application_notes` SELECT/UPDATE/DELETE isolation must be proved at the SQL row level via PostgREST through `supabase-js`.
- **RLS policies are tight after migrations 1–2.** Both tables have authenticated-only policies, all keyed on `user_id = auth.uid()`. No `anon` policy, no `USING (true)`. The `application_notes` hardening migration (`20260526132205_…`) fixes a real past cross-user write leak (user B inserting a note pointing at user A's application) — that exact scenario is required as a regression test.
- **Trigger surface is small and locked.** A `BEFORE UPDATE` trigger on `applications` bumps `last_action_at` only when `status IS DISTINCT FROM`. An `AFTER INSERT` trigger on `application_notes` calls a `SECURITY DEFINER` function `bump_application_last_action_at(uuid)` to bump the parent. Both functions have `search_path = ''` after migration 3. Phase 1's data-isolation tests should _touch_ these (insert a note → assert parent's `last_action_at` moves) but the full invariant suite for the trigger is Phase 3 work.
- **Local Supabase config is ready.** `supabase/config.toml` ships the standard ports (API `54321`, DB `54322`, Studio `54323`), email/password auth on, **email confirmations disabled** (so tests can use admin-created users without round-tripping Inbucket). `supabase@^2.101.0` is already a devDependency.
- **Vitest path is canonical Astro.** Astro 6's official testing guide is exact: `vitest.config.ts` re-uses `getViteConfig` from `astro/config`, which inherits the Cloudflare adapter + React integration from `astro.config.mjs`. For Phase 1 the Node pool is sufficient — no module under test uses workerd-only APIs (the `HTMLRewriter`-using parser path is the only workerd-only surface in the repo and it is deferred to Phase 2 in the test plan).
- **`AGENTS.md` hard rule blocks tests today.** Line 13: _"No test framework is configured — do not scaffold tests."_ Phase 1 is the change that revises this; the implementation phase must update both `AGENTS.md` and the stale `README.md` CI line.
- **Two-clients-per-user is the supported isolation pattern.** Per Supabase docs and corroborating community experience, the cleanest way to drive "user A then user B" through `supabase-js` is **two separate `createClient` instances with `persistSession: false`**, each signed in as a different user. A single shared session-storage between admin + user clients caused real-world flakiness in the community write-ups, so the admin-seed client must also be `persistSession: false`.

The shape of the Phase 1 test fixture is therefore: `npx supabase start` → admin client (service-role, local-only secret) creates two users + cascade-cleans them in teardown → two anon clients sign in via `signInWithPassword` → per-test seed with each user's row → assert cross-visibility/cross-mutation at the row level for `applications` AND `application_notes`. The PATCH endpoint gets a thin extra suite that calls the actual handler (or hits `astro dev` via `fetch`) to confirm the 404-collapsed IDOR contract.

## Detailed Findings

### 1. Toolchain — what we already have

| Concern                  | State                                                                                                                                                             | Citation                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Framework                | Astro 6 SSR, React 19, output: server, Cloudflare adapter                                                                                                         | [astro.config.mjs:1-23](astro.config.mjs#L1-L23)                                                    |
| Path alias               | `@/*` → `./src/*`                                                                                                                                                 | [tsconfig.json:9-10](tsconfig.json#L9-L10)                                                          |
| Strict TS                | extends `astro/tsconfigs/strict`                                                                                                                                  | [tsconfig.json](tsconfig.json)                                                                      |
| Runtime adapter          | `@astrojs/cloudflare ^13.5.0`; compatibility_date `2026-05-08`; `nodejs_compat` flag                                                                              | [wrangler.jsonc:1-17](wrangler.jsonc#L1-L17)                                                        |
| Env secrets              | `SUPABASE_URL`, `SUPABASE_KEY` declared in `astro.config.mjs` schema, read via `astro:env/server`                                                                 | [astro.config.mjs:18-22](astro.config.mjs#L18-L22), [src/lib/supabase.ts:3](src/lib/supabase.ts#L3) |
| Dev secrets file         | `.dev.vars` at root (wrangler dev) — git-ignored                                                                                                                  | [.env.example](.env.example), `context/changes/deployment/deployment-plan.md:81-86`                 |
| Supabase JS              | `@supabase/ssr ^0.10.3`, `@supabase/supabase-js ^2.99.1`                                                                                                          | [package.json:25-26](package.json#L25-L26)                                                          |
| Supabase CLI             | `supabase ^2.101.0` already in devDependencies (`supabase start` is one `npx` away — Docker required)                                                             | [package.json:58](package.json#L58)                                                                 |
| zod                      | `^4.4.3` (already installed — tests can re-use the same validators)                                                                                               | [package.json:40](package.json#L40)                                                                 |
| Existing tests           | **None.** No `vitest.config.*`, no `**/*.test.*`, no `__tests__/`, no test deps in `package.json`. Confirmed by Glob.                                             | —                                                                                                   |
| Lint ignores             | `src/lib/database.types.ts` is the only ignored path                                                                                                              | [eslint.config.js:75](eslint.config.js#L75)                                                         |
| Lint scripts             | `npm run lint` (ESLint), `npm run typecheck` (astro check) — CI gates today                                                                                       | [package.json:11-13](package.json#L11-L13), [.github/workflows/ci.yml](.github/workflows/ci.yml)    |
| Hard rule blocking tests | `AGENTS.md:13` — "No test framework is configured — do not scaffold tests." Phase 1 must revise this line and the README's stale CI claim at `README.md:152-154`. | —                                                                                                   |

### 2. Supabase SSR auth path — how a request gets a user-bound client

The factory is short and exhaustive:

```ts
// src/lib/supabase.ts:1-25
export function createClient(requestHeaders: Headers, cookies: AstroCookies) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  return createServerClient<Database>(SUPABASE_URL, SUPABASE_KEY, {
    cookies: {
      getAll() {
        return parseCookieHeader(requestHeaders.get("Cookie") ?? "").map(({ name, value }) => ({
          name,
          value: value ?? "",
        }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookies.set(name, value, options));
      },
    },
  });
}
```

Middleware uses it once per request:

```ts
// src/middleware.ts:1-25
const PROTECTED_ROUTES = ["/dashboard", "/archive"];
export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }
  if (PROTECTED_ROUTES.some((r) => context.url.pathname.startsWith(r))) {
    if (!context.locals.user) return context.redirect("/auth/signin");
  }
  return next();
});
```

Key facts that shape the test harness:

- **JWT lives in cookies.** `parseCookieHeader` is the in-house bridge between Astro's `Request` and `@supabase/ssr`. Driving the real API handler in a test means either (a) populating cookies on the `Request` you hand to the Astro container, or (b) hitting an in-process `astro dev` via `fetch` after a `signInWithPassword` populates the cookie jar.
- **`context.locals.user` is the auth oracle.** Every API handler under `/api/applications/**` reads `context.locals.user` and returns 401 if null — middleware is the _only_ place that hydrates it. ([src/middleware.ts:14-15](src/middleware.ts#L14-L15))
- **API routes are NOT in `PROTECTED_ROUTES`.** Unauthenticated requests to `/api/applications/**` proceed to the handler, which returns 401 itself. Phase 1 should include an explicit "no cookie → 401" assertion to lock this contract.
- **Same factory in middleware AND every handler** — no per-call service-role client lying around.
- **No `process.env` / `import.meta.env` for Supabase credentials.** Only `astro:env/server`. Test harness has to satisfy the `astro:env/server` import — typically by setting `SUPABASE_URL` / `SUPABASE_KEY` in the process environment before Astro loads, plus a `tests/setup.ts` guard that asserts they point at `http://127.0.0.1:54321`.
- **`context.locals.user: User | null`** is the only typed local. ([src/env.d.ts:1-5](src/env.d.ts#L1-L5))

### 3. Service-role audit (Risk #2 must-challenge)

Greps over the entire `src/` tree for `SERVICE_ROLE`, `service_role`, `serviceRole`, `service-role` returned **zero hits in runtime code**. The only references in the repo are inside `context/foundation/test-plan.md` (planning doc). The single `SECURITY DEFINER` path in the system is the `bump_application_last_action_at(uuid)` function called by the `application_notes` AFTER INSERT trigger — and the migration that defines it explicitly REVOKEs and re-GRANTs to `authenticated` only ([supabase/migrations/20260526123145_applications_schema.sql:141-142](supabase/migrations/20260526123145_applications_schema.sql#L141-L142)). This means: there is no second client variant to audit, and the SECURITY DEFINER surface is one function, callable only through the trigger.

### 4. API endpoints — the exact surface to drive

| #   | Verb + path                    | Handler                                                                           | Auth check                      | Zod                                                                                                                                                                                  | Service call                                                                                                                                                                                     | Ownership filter                                                                                                                                 | Happy / 401 / 404                                                                                                                                                             |
| --- | ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `POST /api/applications`       | [src/pages/api/applications/index.ts:19](src/pages/api/applications/index.ts#L19) | `context.locals.user` (line 20) | `applicationCreateSchema` ([src/lib/validation/applications.ts:12-21](src/lib/validation/applications.ts#L12-L21))                                                                   | `createApplication(supabase, parsed.data, user.id)` ([src/lib/services/applications.ts:40-55](src/lib/services/applications.ts#L40-L55)) — server-stamps `user_id` from `context.locals.user.id` | **No service-side `eq("user_id", …)`** — relies on RLS `applications_insert_own` WITH CHECK. Safe because `user_id` is never read from the body. | `201 { application }` / `401 { error: "Brak autoryzacji." }` / N/A                                                                                                            |
| 2   | `PATCH /api/applications/[id]` | [src/pages/api/applications/[id].ts:12](src/pages/api/applications/[id].ts#L12)   | `context.locals.user` (line 13) | `uuidSchema` on path + `applicationStatusUpdateSchema` body ([src/lib/validation/applications.ts:34-36](src/lib/validation/applications.ts#L34-L36)) — **status-only patches today** | `updateApplicationStatus(supabase, id, status, user.id)` ([src/lib/services/applications.ts:20-38](src/lib/services/applications.ts#L20-L38))                                                    | **Defence-in-depth**: `.eq("id", id).eq("user_id", userId)` + RLS `applications_update_own`                                                      | `200 { application }` / 401 / `404 { error: "Nie znaleziono aplikacji." }` — **404 collapses "not found" and "exists-but-owned-by-other"** via `maybeSingle()` returning null |
| 3   | `POST /api/applications/parse` | [src/pages/api/applications/parse.ts:45](src/pages/api/applications/parse.ts#L45) | `context.locals.user` (line 46) | `applicationParseSchema` ([src/lib/validation/applications.ts:43-45](src/lib/validation/applications.ts#L43-L45))                                                                    | none — no DB touch                                                                                                                                                                               | N/A                                                                                                                                              | Out of Phase 1 scope (Risk #1 + #4, Phase 2)                                                                                                                                  |

There is also a **services-only** function `listActiveApplications(supabase)` ([src/lib/services/applications.ts:7-18](src/lib/services/applications.ts#L7-L18)) called from a server-rendered page (not an HTTP endpoint). Cross-user SELECT visibility on `applications` is therefore proved at PostgREST level (two anon clients hitting `.from('applications').select('*')`), not through an API route.

**There are no `application_notes` HTTP endpoints in this commit.** The notes table exists with full RLS, but its SELECT/UPDATE/DELETE isolation can only be exercised by driving PostgREST directly through `supabase-js`. Phase 1 must include those direct-PostgREST tests; do NOT skip them because "there's no endpoint" — Risk #2 is the SQL layer, not the API layer.

### 5. RLS final state — the policy matrix to assert against

After migrations 1 → 2 → 3 → 4, the policies are:

**`applications`** (from [supabase/migrations/20260526123145_applications_schema.sql](supabase/migrations/20260526123145_applications_schema.sql))

| Policy                    | Command | Role            | USING                  | WITH CHECK             |
| ------------------------- | ------- | --------------- | ---------------------- | ---------------------- |
| `applications_select_own` | SELECT  | `authenticated` | `user_id = auth.uid()` | —                      |
| `applications_insert_own` | INSERT  | `authenticated` | —                      | `user_id = auth.uid()` |
| `applications_update_own` | UPDATE  | `authenticated` | `user_id = auth.uid()` | `user_id = auth.uid()` |
| `applications_delete_own` | DELETE  | `authenticated` | `user_id = auth.uid()` | —                      |

**`application_notes`** (final state per the hardening migration [supabase/migrations/20260526132205_harden_application_notes_rls.sql](supabase/migrations/20260526132205_harden_application_notes_rls.sql))

| Policy                         | Command | Role            | USING                  | WITH CHECK                                                                                                               |
| ------------------------------ | ------- | --------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `application_notes_select_own` | SELECT  | `authenticated` | `user_id = auth.uid()` | —                                                                                                                        |
| `application_notes_insert_own` | INSERT  | `authenticated` | —                      | `user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.applications WHERE id = application_id AND user_id = auth.uid())` |
| `application_notes_update_own` | UPDATE  | `authenticated` | `user_id = auth.uid()` | `user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.applications WHERE id = application_id AND user_id = auth.uid())` |
| `application_notes_delete_own` | DELETE  | `authenticated` | `user_id = auth.uid()` | —                                                                                                                        |

**No `anon` policies. No `USING (true)`. No service-role escapes.**

The `application_notes` INSERT WITH CHECK is the load-bearing protection: it requires _both_ the note's `user_id` to be the caller AND the parent application's `user_id` to be the caller. This is the exact patch for the past cross-user write leak that `applications-schema-and-rls/plan.md:153` documents:

> "the original `application_notes` INSERT policy let user B insert a note owned by themselves but pointed at user A's `application_id` — a cross-user write leak"

That bug → that patch → that test is the strongest single regression case for Phase 1.

### 6. Triggers — what Phase 1 touches incidentally

- `applications_bump_last_action_at_on_status_change()` — BEFORE UPDATE on `applications` WHEN `OLD.status IS DISTINCT FROM NEW.status`, sets `NEW.last_action_at = now()`. `search_path = ''` per migration 3.
- `application_notes_bump_parent_trigger()` — AFTER INSERT on `application_notes`, calls `public.bump_application_last_action_at(new.application_id)`. The latter is **`SECURITY DEFINER`** + `search_path = ''`, REVOKE all FROM public + GRANT execute TO `authenticated`.

Phase 1's primary job is Risk #2 (isolation), not Risk #3 (trigger invariants — that's Phase 3). But because the hardened `application_notes_insert_own` policy is what guards the SECURITY DEFINER chain from being abused (a user can't insert a note pointing at someone else's app, so the parent bump can only ever hit a row they already own), at least one Phase 1 assertion should exercise the chain: user A inserts a note on their own application → parent `last_action_at` advances.

### 7. Local Supabase configuration — what's already wired

From [supabase/config.toml](supabase/config.toml):

| Setting                                              | Value                          | Citation      |
| ---------------------------------------------------- | ------------------------------ | ------------- |
| Project ID                                           | `10x-astro-starter`            | line 1        |
| REST API port                                        | `54321`                        | line 10       |
| DB port                                              | `54322`                        | line 29       |
| Studio                                               | enabled, `54323`               | lines 89-93   |
| Inbucket (email)                                     | enabled, `54324`               | lines 100-102 |
| PG major                                             | 17                             | line 36       |
| Migrations enabled, loaded from `./migrations/*.sql` | yes                            | lines 55, 58  |
| Seed enabled, `./seed.sql`                           | yes (no seed file in repo yet) | lines 62, 65  |
| Auth enabled                                         | true                           | line 151      |
| Email signup                                         | enabled                        | line 204      |
| **Email confirmations**                              | **disabled**                   | line 209      |
| Min password length                                  | 6                              | line 175      |
| Anon sign-ins                                        | disabled                       | line 171      |
| Third-party OAuth                                    | none configured                | —             |

**Email confirmations being off** is the critical detail for Phase 1: `supabase.auth.admin.createUser({ email_confirm: true })` plus `signInWithPassword` is enough to get two authenticated sessions — no Inbucket polling required.

### 8. Vitest setup — the canonical Astro path

Astro's [official testing guide](https://docs.astro.build/en/guides/testing/) confirms the only supported pattern:

```ts
// vitest.config.ts
/// <reference types="vitest/config" />
import { getViteConfig } from "astro/config";

export default getViteConfig({
  test: {
    environment: "node", // server-side modules, no DOM
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
  },
});
```

- `getViteConfig()` reads the existing `astro.config.mjs`, so the Cloudflare adapter + React integration + `astro:env/server` flow into Vitest automatically.
- `environment: 'node'` is correct for Phase 1: every module under test (services, API handlers, middleware) uses only Web-standard APIs (`fetch`, `Request`, `Response`, `Headers`, `URL`) plus Postgres-over-HTTPS via `supabase-js` — all native to Node 22.
- **The Node pool is sufficient** for Phase 1. `@cloudflare/vitest-pool-workers` becomes relevant _only_ when a test imports `src/lib/parsers/**` (which uses `HTMLRewriter`, workerd-only). Phase 2 (parser tests) will add it; Phase 1 should not, to keep the bootstrap minimal. Source: [Cloudflare vitest-pool-workers npm page](https://www.npmjs.com/package/@cloudflare/vitest-pool-workers): _"Not required for tests importing plain JavaScript code that communicates with external databases through HTTP requests."_

### 9. RLS test pattern — the supabase-js idiom

Verified against [supabase.signInWithPassword docs](https://supabase.com/docs/reference/javascript/auth-signinwithpassword) and the [Supabase Testing Overview](https://supabase.com/docs/guides/local-development/testing/overview):

```ts
const userA = createClient(URL, ANON_KEY, { auth: { persistSession: false } });
const userB = createClient(URL, ANON_KEY, { auth: { persistSession: false } });

await userA.auth.signInWithPassword({ email: emailA, password });
await userB.auth.signInWithPassword({ email: emailB, password });

// User A inserts a row …
const { data: rowA } = await userA.from("applications").insert({ source: "a" }).select().single();

// User B cannot see it
const { data: rowsB } = await userB.from("applications").select("*");
expect(rowsB).toEqual([]);

// User B cannot update it
const { data: updated, error: upErr } = await userB
  .from("applications")
  .update({ status: "Zaaplikowano" })
  .eq("id", rowA.id)
  .select();
expect(updated).toEqual([]); // RLS makes the row invisible; no error, just no match

// User B cannot insert a note pointing at user A's row (the F-01 regression test)
const { error: noteErr } = await userB.from("application_notes").insert({
  application_id: rowA.id,
  body: "hostile",
  user_id: (await userB.auth.getUser()).data.user!.id,
});
expect(noteErr).not.toBeNull(); // policy violation
```

Three gotchas the docs / community write-ups call out:

1. **Two clients, not one.** Once signed in, `supabase-js` carries the JWT into every subsequent `from(…)` call automatically; switching identities on a single client requires `signOut()` + re-`signInWithPassword`, and shared session storage between admin + user clients caused real flakiness in the wild ([index.garden: Challenges testing Supabase RLS with Vitest](https://index.garden/supabase-vitest/)).
2. **`persistSession: false` on every test client** including the admin client. The official Supabase blog "Testing for Vibe Coders" uses this combination with `environment: 'node'`.
3. **`supabase db reset` is too slow for per-test isolation.** Recommended pattern: one reset before the suite (or fresh `supabase start` on CI); each test creates unique users (`a-${crypto.randomUUID()}@test.local`); `afterEach` / `afterAll` calls `admin.deleteUser(...)` and the `ON DELETE CASCADE` from `auth.users` ([supabase/migrations/20260526123145_applications_schema.sql:13-28](supabase/migrations/20260526123145_applications_schema.sql#L13-L28)) wipes everything they created.

### 10. Driving the real API handler — two viable routes

The test plan's Risk #2 row is explicit: _"drive every applications endpoint through both sessions, assert each user sees only own rows."_ Two viable approaches:

**Option A (recommended): hit a running `astro dev` via `fetch` with a real cookie jar.**

- Spin up Astro programmatically via `import { dev } from 'astro'` in `tests/setup.ts` (Astro 6 supports this), or run it as a `globalSetup` child process. Use port 0 / a fixed port.
- Sign in via `supabase-js`, extract the SSR cookies it set, replay them on `fetch(url, { headers: { Cookie: … } })` to the dev server.
- Pros: exercises middleware, handler, services, RLS in one shot — the production code path.
- Cons: slowest; one cold start per suite; needs port management.

**Option B (recommended for SQL-layer assertions): call PostgREST directly via two `supabase-js` clients.**

- No HTTP server. Two anon clients, `signInWithPassword`, `.from('…').select/insert/update/delete()`.
- Pros: fast; isolates exactly the RLS surface (what the test plan calls "assert at the row level"); covers `application_notes` (which has no endpoint).
- Cons: bypasses Astro middleware + handler — does NOT catch a bug like "handler forgets to read `context.locals.user` and posts as anon" because that's the handler's bug, not RLS's.

The cheapest-test-with-real-signal principle from §1 of the test plan points to **mostly Option B for Phase 1**, plus **one thin Option A test per endpoint** to lock the 401-and-404 contract that the test plan §2 calls out (the IDOR matrix from Risk #5 is Phase 3, but the basic "no cookie → 401, cross-user PATCH → 404" assertions are cheap to land here as a side effect of having the harness running).

A pragmatic middle ground: **start Phase 1 with Option B alone** (it covers Risk #2 fully), and defer Option A to Phase 3 when the IDOR matrix is the actual scope. This keeps the bootstrap minimal and resolves the open question about Astro Container API maturity (see Open Questions §1 below).

### 11. Directory / location convention — recommendation

Two patterns are common in the Astro/Vitest ecosystem. The official Astro example (`with-vitest`) uses **a root-level `tests/` directory**. Combined with the project's existing `@/*` alias for `src/`, this gives a clean mental model:

```
tests/
├── setup.ts                  # asserts SUPABASE_URL is local; loads .env.test
├── helpers/
│   ├── supabase-clients.ts   # admin client + two-user-session factory
│   └── seed.ts               # createTestUser, deleteTestUser
└── integration/
    └── rls-applications.test.ts
    └── rls-application-notes.test.ts
```

Co-locating tests (`src/lib/services/applications.test.ts`) is the other option, and works well for **pure unit tests** of utilities, but doesn't fit integration tests that touch a live Postgres. Recommendation for Phase 1: **adopt `tests/` for integration tests**, leave the door open for co-located `*.test.ts` for future unit tests of `src/lib/utils.ts` etc.

### 12. CI shape — Phase 1 is local-first

`.github/workflows/ci.yml` is a single job: `npm ci → npx astro sync → npm run typecheck → npm run lint → npm run build`. Secrets wired into the build step are `SUPABASE_URL` + `SUPABASE_KEY`. **There is no Docker step, no `supabase start`, no service-role secret.**

The test plan's §5 Quality Gates row for "RLS cross-user integration" reads `local + CI | required after §3 Phase 1`. Phase 4 is "Quality gate wiring" — that's where the CI extension lives. Phase 1's contract is: tests run locally with `npx supabase start` + `npm test`; CI wiring is out of scope. The `change.md` for this phase implicitly agrees (it doesn't name CI).

That said, two prerequisites Phase 1 should leave in a clean state for Phase 4:

- `.env.test` documented in `.env.example` (with sentinel values pointing at the local stack);
- `npm test` script in `package.json` that succeeds against an already-started local Supabase.

## Code References

- `src/lib/supabase.ts:1-25` — SSR client factory; the only Supabase client in the codebase
- `src/middleware.ts:1-25` — auth gate, `context.locals.user` population, `PROTECTED_ROUTES`
- `src/env.d.ts:1-5` — `App.Locals.user` type
- `src/pages/api/applications/index.ts:19-50` — `POST /api/applications` handler
- `src/pages/api/applications/[id].ts:12-51` — `PATCH /api/applications/[id]` handler (defence-in-depth + 404 collapse)
- `src/pages/api/applications/parse.ts:45` — out-of-scope for Phase 1
- `src/lib/services/applications.ts:7-18` — `listActiveApplications` (services-only)
- `src/lib/services/applications.ts:20-38` — `updateApplicationStatus` (defence-in-depth `.eq("user_id", …)`)
- `src/lib/services/applications.ts:40-55` — `createApplication` (server-stamps `user_id`)
- `src/lib/validation/applications.ts:12-21,34-36,43-45` — zod schemas (reusable by tests)
- `src/lib/database.types.ts` — generated by `npm run db:types`; eslint-ignored
- `supabase/migrations/20260526123145_applications_schema.sql:1-160` — full schema, RLS, triggers (both tables, all 4 verbs)
- `supabase/migrations/20260526132205_harden_application_notes_rls.sql:20-44` — the cross-user write-leak fix
- `supabase/migrations/20260528153903_lock_trigger_function_search_path.sql:16-30` — search_path lock on both trigger functions
- `supabase/migrations/20260528154840_drop_redundant_user_id_index.sql:4-11` — context only
- `supabase/config.toml:10, 29, 89, 100, 151-209` — local stack ports + auth config
- `astro.config.mjs:18-22` — env schema declaring `SUPABASE_URL` / `SUPABASE_KEY` as server secrets
- `tsconfig.json:9-10` — `@/*` path alias
- `wrangler.jsonc:1-17` — adapter compatibility flags
- `package.json:5-16, 25-26, 40, 58` — scripts + Supabase + zod versions
- `AGENTS.md:13` — the "no test framework" rule to revise in Phase 1
- `README.md:152-154` — the stale CI claim to refresh
- `.github/workflows/ci.yml:1-25` — current CI job (no Docker/Supabase yet)

## Architecture Insights

1. **Single auth boundary, single client variant.** The codebase makes Risk #2 testable cheaply because there is only one Supabase client surface (`src/lib/supabase.ts`). Any future regression that introduces a service-role client is a clear deviation a code reviewer (or a typecheck-time grep gate) can catch independently.

2. **Defence-in-depth is partial today.** Only `updateApplicationStatus` adds `.eq("user_id", …)` on top of RLS. The create path relies on `user_id` being server-stamped from `context.locals.user.id` (effective and cheap), and the listing path (services-only, page-rendered) relies on RLS alone. There's no architectural drift to fix here, but the test plan should document the asymmetry so Phase 3's IDOR matrix doesn't double-count.

3. **404 collapse is intentional and load-bearing.** PATCH /api/applications/[id] returns 404 for both "doesn't exist" and "exists but owned by another," because `maybeSingle()` returns null in both. Phase 1 tests must assert exactly `404` (not 403) to prevent a future refactor from leaking existence information.

4. **The `application_notes` INSERT policy is the single most consequential RLS rule in the codebase.** The `EXISTS (… parent owned)` clause is the patch for a real past leak. Phase 1 must encode this exact scenario as a regression test or lose the historical signal.

5. **`HTMLRewriter` is the only workerd-only dependency.** Everything else in `src/` is plain Web-standard TS and runs unchanged in Node. This makes Phase 1's "Node pool" choice safe and Phase 2's "Workers pool for parser tests" a clean later addition rather than a retrofit.

## Historical Context (from prior changes)

- `context/changes/applications-schema-and-rls/plan.md:37-39,142-148,153,269-275` — explicitly punts RLS verification to a manual runbook with the rationale "adding pgTAP or Vitest+Docker adds 1-2 days of CI plumbing for a foundation that, once verified, does not change again until a future migration." Phase 1 closes this gap. The two-user manual runbook (lines 142-148) is the literal blueprint for the first integration test.
- `context/changes/applications-schema-and-rls/plan.md:153` — documents the cross-user write leak that motivated the hardening migration. This is the canonical regression test.
- `context/changes/applications-schema-and-rls/plan.md:226` — notes "This project has no local Docker Supabase stack — development runs against the hosted Supabase Postgres project via `supabase link`." This is stale relative to the test plan, which assumes `supabase start` is in play. Phase 1 introduces the local stack; the implementation phase should update this line (or the rollout's status), not assume someone has the local stack already.
- `context/changes/deployment/deployment-plan.md:81-86,115-121,160-189,218-220` — confirms `.dev.vars` holds anon-only secrets, prod has no service-role key, and CI is a gate (not a deployer). Phase 4 wires Docker + Supabase into CI; Phase 1's CI footprint should be zero.
- `context/changes/manual-add-application/plan.md:77-78,231` — defines the JSON envelope (`201 { application }`, `422 { errors }`, `500 { error }`) the tests should assert against, and documents that `user_id` is server-set (so cross-user-create is not an attack surface).
- `context/changes/parser-driven-add/plan.md:41` — re-states the AGENTS.md "no tests" rule. Out of date with the test plan, must be revised by Phase 1's implementation.
- `context/foundation/prd.md:38-39,166-168` — the load-bearing user-isolation guardrail in PRD prose: "an auth failure here is not a P2 bug — it's an incident." This is what Risk #2 is protecting and what the Phase 1 tests must give us confidence in.
- `context/foundation/infrastructure.md:75,77,84-87` — confirms `astro dev` runs under Node (relevant for Option A above) and that Supabase free tier pauses after 1 week of inactivity (a reason to prefer `supabase start` over linked-hosted-DB tests).
- `context/foundation/business-logic-notes.md:11-21` — `last_action_at` reset semantics (Phase 3 invariant work, not Phase 1, but cited so the harness doesn't accidentally over-assert here).
- `context/changes/bootstrap-verification/verification.md:60-89` — flags a `miniflare → ws` moderate audit issue. Same `miniflare` would be pulled in by `@cloudflare/vitest-pool-workers`. Since Phase 1 does NOT add `vitest-pool-workers`, this stays a Phase-2 concern.

## Related Research

- `context/changes/applications-schema-and-rls/research.md` — the schema/RLS deep dive that this research builds on.
- `context/changes/parser-driven-add/research.md` — current endpoint-pattern reference; `research.md:47` re-confirms anon-only RLS.
- `context/changes/manual-add-application/plan.md` — endpoint envelope conventions.

## Open Questions

These are the decisions the Phase 1 plan needs to lock. The research has narrowed them but not made them for the user:

1. **Driving endpoints — Option A (running `astro dev` via `fetch`) vs Option B (PostgREST through two `supabase-js` clients).** Recommendation above is **B for Phase 1**. If the user wants the full handler-glue assertions (401 from middleware-less API, 404-collapse from PATCH), the implementation phase needs Option A added. The alternative is "B only for now; Phase 3 picks up A as part of the IDOR matrix." Decision belongs in the plan.

2. **Test user lifecycle — per-test ephemeral vs suite-scoped seeded.** Recommendation: per-test ephemeral via `admin.createUser` with `crypto.randomUUID()` emails. Seeded users (`supabase/seed.sql`) are tempting for speed but make `--watch` mode tricky (you must reset the stack to wipe leftover rows). Per-test is the Supabase-recommended pattern; the `ON DELETE CASCADE` from `auth.users` ([applications_schema.sql:13-28](supabase/migrations/20260526123145_applications_schema.sql#L13-L28)) makes teardown one call per user.

3. **Where the service-role key lives.** It's only valid for the local Supabase stack, but it IS a service-role key. `.env.test` (git-ignored), sentinel values committed in `.env.example`, hard guard in `tests/setup.ts` asserting `SUPABASE_URL` starts with `http://127.0.0.1:54321` before the admin client is constructed. The Phase 1 plan should write this guard down so a future contributor can't point the suite at the prod Supabase by accident.

4. **`AGENTS.md` revision wording.** The hard rule at line 13 currently reads _"No test framework is configured — do not scaffold tests."_ It needs to become something like _"Vitest is configured for integration tests against a local Supabase. Tests live under `tests/`. Do not add tests that require Docker beyond `supabase start`, and do not commit a `SUPABASE_SERVICE_ROLE_KEY` to any committed file."_ The README CI line at `README.md:152-154` also needs to mention `npm test` (or explicitly defer to Phase 4 if CI integration is deferred). Exact wording is a plan decision.

5. **Whether to land `@cloudflare/vitest-pool-workers` now or defer to Phase 2.** Recommendation: **defer.** Phase 1's footprint stays small (Node pool, one config file), and adding the workers pool now would require a `vitest.workspace.ts` or per-file `pool:` configuration that's wasted churn until parser tests exist. Document the choice in §6.1 of the test plan when Phase 1 lands.

6. **CI extension in this phase or in Phase 4?** Test plan §3 puts CI in Phase 4. Recommendation: **defer to Phase 4** as planned. Phase 1's `npm test` script should be runnable locally and CI green should be unaffected.

7. **Should tests assert against `database.types.ts` types?** They're generated, eslint-ignored, and exposing them in test helpers is convenient. Recommendation: yes — `supabase-js`'s `createClient<Database>` lets tests catch schema drift the same way the app code does. Free signal.

Sources:

- [Astro Testing Guide](https://docs.astro.build/en/guides/testing/)
- [Cloudflare vitest-pool-workers (npm)](https://www.npmjs.com/package/@cloudflare/vitest-pool-workers)
- [Cloudflare Vitest Integration Configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)
- [Supabase JS: auth.admin.createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase JS: auth.signInWithPassword](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabase Local Testing Overview](https://supabase.com/docs/guides/local-development/testing/overview)
- [Supabase blog: Testing for Vibe Coders](https://supabase.com/blog/testing-for-vibe-coders-from-zero-to-production-confidence)
- [index.garden: Challenges testing Supabase RLS with Vitest](https://index.garden/supabase-vitest/)
