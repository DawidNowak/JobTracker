# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-17 (Phase 1 complete — §6.1/6.2/6.3 cookbook filled)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (27 commits / 30d; signal sufficient).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Parser silently saves wrong fields to a card. Portal HTML drifts; `/api/applications/parse` returns plausible but incorrect position/company/description and the user accepts it without noticing. | High | High | interview Q1, interview Q3; PRD US-01, FR-004, NFR "no low-confidence pre-fill"; hot-spot dir `src/lib/parsers/` (5 commits/30d) |
| 2 | Cross-user data leak via RLS regression. A future migration, service-role query, or session-handling change bypasses `auth.uid()` filtering; one user reads or mutates another user's applications/notes. | High | Medium | PRD Access Control ("auth failure here is an incident"), NFR durability; hot-spot dir `supabase/migrations/` (4 migrations including RLS hardening + trigger search_path lock) |
| 3 | `lastActionAt` drift corrupts follow-up flags. Status change or note save fails to reset; or a non-status edit accidentally resets. Flag fires at the wrong moment or never. | High | Medium | PRD Business Logic (load-bearing reset rule); business-logic-notes.md §"Precyzja semantyczna lastActionAt"; hot-spot dir `src/lib/services/` (2 commits/30d) + future slices S-07/S-08/S-09 all consume this column |
| 4 | `/api/applications/parse` issues fetch to a non-portal URL (SSRF / abuse). `recognize()` allowlist gap lets an authenticated user coerce the Worker to GET internal Cloudflare metadata, follow redirect chains, or hammer arbitrary hosts. | High | Medium | abuse lens (untrusted-input + resource-abuse); PRD FR-004; hot-spot dir `src/lib/parsers/` (5 commits/30d) |
| 5 | IDOR at applications endpoints. An endpoint authenticates but trusts RLS alone; a future regression to a service-role client or a missing ownership clause lets user B read or mutate user A's card by its UUID. | High | Medium | abuse lens (authorization); PRD Access Control; hot-spot dir `src/pages/api/applications/` (8 commits/30d). Distinct root cause from Risk #2 — kept as defence-in-depth. |
| 6 | Rozmowa business-day arithmetic fires at the wrong moment. Friday-interview edge case, weekend handling, or timezone boundary on "now" misclassifies a card as flagged or unflagged. | Medium | Medium | PRD FR-012 + Business Logic (explicit Friday-interview rationale); future slice S-09 (not yet implemented) |

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | Given a captured LinkedIn / JustJoinIT HTML payload, the parser extracts the canonical fields a human would extract from the visible page; given a payload where a field is missing, that field is `undefined` (never a low-confidence guess). The `ok / partial / empty` status branches match what the AddApplicationDialog actually does with each. | "If `position` is non-empty, the whole result is trustworthy" — partial results must not silently pass as `ok`. | The status branches in the parse endpoint; how `populated` and `missingExpected` decide status; what the AddApplicationDialog does with each status; how a real captured HTML payload is stored as a fixture. | Unit tests over real captured HTML fixtures (one happy fixture per supported portal) + a deliberately corrupted fixture asserting empty/partial, not garbage. | Oracle problem: writing assertions by re-reading what the parser currently returns instead of from the independent source (the visible job page). Snapshot-against-self is a tautology. |
| #2 | User A's session cannot SELECT/UPDATE/DELETE rows owned by user B at the SQL layer — proved by running both sessions through the real Supabase SSR client against the same DB with RLS on. Holds for `applications` AND `application_notes`. | "RLS is on, so we're fine" — every new table/policy/migration is a fresh chance to regress; any `service_role` key use must be audited, not assumed absent. | Whether any code path uses a service-role key; the policy matrix on `applications` + `application_notes`; whether the SSR client always carries the user JWT through every endpoint. | Integration test against local Supabase (`supabase start`): seed 2 users with 2 rows each, drive every applications endpoint through both sessions, assert each user sees only own rows. | Mocking Supabase — RLS is the system under test; mocking it tests nothing. Past prod-vs-mock divergence is the canonical failure mode here. |
| #3 | After INSERT → `lastActionAt = createdAt`. After status change → reset to now. After `application_notes` INSERT → parent `lastActionAt` reset to now. After non-status field edit → `lastActionAt` unchanged. All four invariants still hold after the next migration runs. | "Trigger is locked down so it's permanent" — every future migration can drop or replace the trigger; the existing `lock_trigger_function_search_path` migration already shows triggers are in scope for follow-up patches. | The trigger source in the applications schema migration + later hardening migrations; any service-layer code that writes `lastActionAt` directly (it should not). | Integration test against real Postgres (Supabase local), four invariant cases, executed via raw `SELECT lastActionAt`, re-run after every migration. | Asserting via the service-layer abstraction — assert at the row level so an API-bypassing trigger regression is still caught. |
| #4 | `POST /api/applications/parse` with a non-portal URL (internal IP, `file://`, unsupported portal, redirect chain to internal) returns `{status:"unsupported"}` or 4xx and never executes outbound fetch to the disallowed target. | "`recognize()` returns `unsupported` so we never call fetch" — verify on a redirect chain (`http://allowed-portal/x` → `http://internal/`); verify URL canonicalisation; verify the parser modules themselves don't re-derive trust from the URL. | The `recognize()` allowlist; whether parsers follow redirects; the Workers `fetch` redirect default; whether the parse endpoint re-checks scheme/host between recognize and fetch. | Unit tests on `recognize()` (table of URLs → expected verdict) + integration test that wraps or intercepts outbound `fetch` in the parse endpoint and asserts zero outbound calls on disallowed inputs. | Testing only the happy LinkedIn/JustJoinIT URLs. The bug class is exactly the not-tested URL shapes. |
| #5 | For each verb (GET / PUT / DELETE) and each owner/actor combination, a request as user B against any of user A's UUIDs returns 404 (not 200, not 500, not 403 with leaked existence info), and never executes the mutation. | "RLS will block it, so the API doesn't need its own check" — defence in depth; a future service-role refactor or a query that drops the `eq("user_id", ...)` clause bypasses RLS entirely. | The current `[id].ts` query shape; how `context.locals.user` is enforced before the query; whether 404-vs-403 leaks resource existence. | Integration test against local Supabase: two users, exhaustive matrix of (verb × owner × actor) → expected status code. | Snapshotting the response body — assert status code + ownership invariant, not the JSON shape, so a copywriting change does not red the test for the wrong reason. |
| #6 | For each (status, lastActionAt, now) tuple — including Friday-interview-then-Tuesday, Saturday/Sunday boundary, end-of-month wrap — the flag computation matches a hand-derived expected value. | "It's just date math" — past products have shipped business-day bugs that fire on Saturday or skip Monday silently; timezone of "now" matters when servers and users are in different zones. | The eventual signature of the flag function (decided during S-09 plan); whether business-day count uses UTC or user-local TZ; how "now" is injected for deterministic testing. | Pure unit tests on the date function: matrix of cases, no DB, no UI. Land with S-09's `/10x-plan`, not before — no function-under-test exists yet. | `new Date()` inside the function under test — must accept "now" as a parameter so tests are deterministic. |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Test bootstrap + data-isolation guard | Pick the runner, establish the Astro + Supabase integration-test pattern, prove the incident-class data-isolation guardrail with real cross-user integration tests. | #2 | unit + integration (Supabase local) | complete | `context/changes/testing-bootstrap-and-data-isolation/` |
| 2 | Parser correctness + abuse surface | Lock the north-star wedge: real-HTML fixture coverage per portal, fallback-on-failure path, and the `recognize()` allowlist that gates outbound fetch. | #1, #4 | unit (fixtures + URL classifier) + integration (fetch interception) | implementing | `context/changes/parser-correctness-and-abuse-surface/` |
| 3 | Domain invariants — lastActionAt + IDOR | Prove the `lastActionAt` trigger semantics survive future migrations and that applications endpoints enforce ownership independently of RLS. | #3, #5 | integration against real Postgres (row-level + endpoint matrix) | not started | — |
| 4 | Quality gate wiring | Add `npm test` to CI on push/PR; integration tests run against an ephemeral or local Supabase; no coverage threshold (per §7). Optional: a scheduled parser-HTML-drift canary. | gating regression for #1–#5 | CI YAML edits, GitHub Actions secrets, optional scheduled canary | not started | — |

Risk #6 is intentionally not a rollout phase here — the function does not exist yet (S-09 is `proposed`). Its response row is preserved in §2 so the S-09 `/10x-plan` can pick it up as a test sub-phase when that slice opens.

**Status vocabulary** (fixed — parser literals):

| Value | Meaning |
|---|---|
| `not started` | No change folder for this rollout phase yet. |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done. |
| `researched` | `research.md` exists in the change folder. |
| `planned` | `plan.md` exists with a `## Progress` section. |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`. |
| `complete` | Progress section is fully `[x]`. |

## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section must be grounded in local manifests/configs
plus the MCP/tools actually exposed in the current session.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | none yet — see Phase 1 | — | `package.json` has zero test deps as of 2026-06-16; AGENTS.md line 13 explicitly says "no test framework — do not scaffold tests" today. Phase 1 picks the runner (Vitest is the natural fit for the Vite-based Astro toolchain) and lands it. |
| API mocking | in-process `fetch` stub via `tests/helpers/fetch.ts`; parser unit tests run under `@cloudflare/vitest-pool-workers` | — | `withFetchStub(handler, fn)` wraps `vi.stubGlobal("fetch", ...)` + `vi.unstubAllGlobals()` in a `finally` so stubs don't leak between tests. Added in Phase 2. Parser unit tests need workerd's `HTMLRewriter` global — they run in the workers pool (`@cloudflare/vitest-pool-workers`), not the node pool. |
| e2e | not planned for MVP | — | The full kanban happy-path is rich but the cost × signal does not yet justify e2e; integration via the Supabase SSR client covers the failure modes in §2. Reconsider via `--refresh` if a regression class appears that integration cannot catch. |
| accessibility | not planned for MVP | — | PRD has no accessibility NFR; small private user base. Reconsider if scope changes. |
| local DB for integration | Supabase CLI (`supabase start`) | 2.101.0 (devDependency) | Spins up a local Postgres + Auth stack; migrations under `supabase/migrations/` apply cleanly. Required by Phase 1 and Phase 3. |
| (optional) AI-native | not planned | — | Interview Q1 prefers determinism; an LLM-as-judge over HTML fixtures would mostly retest what a unit assertion already catches. Reconsider via `--refresh` if a class of regression escapes the fixture suite. |

If a row reads "none yet — see Phase <N>", that gap is addressed by the named rollout phase.

**Stack grounding tools (current session):**

- Docs: none exposed (no Context7 / framework docs MCP); checked: 2026-06-16. Use WebFetch against official Astro / Vitest / Supabase docs when verifying current setup.
- Search: WebSearch + WebFetch available; checked: 2026-06-16. Use to verify current Vitest-with-Astro and Supabase-local test patterns at Phase 1 research time.
- Runtime/browser: none exposed (no Playwright MCP); checked: 2026-06-16. Manual Workers behaviour verification falls back to `wrangler dev` per `infrastructure.md` operational guidance — out of scope for this rollout (see Challenger findings / dropped R2).
- Provider/platform: `mcp__cloudflare__*` auth tools available; `gh` CLI available via Bash for issues/PRs; no Supabase MCP exposed; checked: 2026-06-16.

Use docs MCPs (when available) for current framework/library APIs and setup details. Use search MCPs for discovery or current status only, then prefer official docs as the evidence. Do not use MCP docs/search to infer code failure anchors; those belong in per-phase `/10x-research`.

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| `npm run lint` (ESLint) | local pre-commit + CI | required (today) | syntactic / style drift |
| `npm run typecheck` (astro check) | local + CI | required (today) | type drift, narrowing failures `astro build` misses |
| `npm run build` | CI | required (today) | build-time regressions, missing imports |
| unit + integration (Phase 1+2+3) | local + CI | required after §3 Phase 4 | logic regressions on Risks #1–#5 |
| RLS cross-user integration | local + CI | required after §3 Phase 1 | the incident-class data-isolation guardrail |
| Parser HTML fixture suite | local + CI | required after §3 Phase 2 | silent parser garbage (Risk #1) |
| Parser HTML drift canary (scheduled) | CI on a cron | optional (after §3 Phase 4) | portal HTML changes between releases (Risk #1, slow-burn) |
| Pre-prod smoke via `wrangler dev` | local | recommended for parser-touching PRs | runtime divergence between `astro dev` and workerd (operational mitigation; not a test gate per dropped R2) |

Every row corresponds to a gate that either is wired or will be wired by a named rollout phase. Coverage thresholds are deliberately absent (per §7).

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

**Runner / location** (Phase 1 shipped): Vitest, configured via `vitest.config.ts` using `getViteConfig` from `astro/config` so `astro:env/server` paths resolve. All test files live under `tests/**/*.test.ts`; run with `npm test` or `npm run test:watch`. The `tests/setup.ts` setup file runs before every worker — it loads `.env.test` and asserts the Supabase URL points at `127.0.0.1:54321` before anything else executes.

**Parser fixture pattern** — TBD; see §3 Phase 2. Will cover capturing a real HTML payload as a fixture and asserting canonical fields against the visible job page (oracle from the page, not from the parser output).

### 6.2 Adding an integration test against Supabase

**Phase 1 shipped.** Prerequisites: `npx supabase start` running, `.env.test` populated from `npx supabase status` (see `tests/README.md`).

**Standard test shape:**

```ts
import { createAdminClient } from '../helpers/supabase-clients';
import { provisionUser, cleanupUser } from '../helpers/users';

const admin = createAdminClient();

let userA: Awaited<ReturnType<typeof provisionUser>>;
let userB: Awaited<ReturnType<typeof provisionUser>>;

beforeEach(async () => {
  userA = await provisionUser(admin);
  userB = await provisionUser(admin);
});

afterEach(async () => {
  await cleanupUser(admin, userA.userId);
  await cleanupUser(admin, userB.userId);
});
```

**Key rules:**
- Every client is created fresh per test via `createUserClient()` / `createAdminClient()` — no singletons, always `persistSession: false`.
- `provisionUser` passes `email_confirm: true` to `admin.auth.admin.createUser` — this is mandatory even when project-level email confirmations are disabled (two independent switches).
- `afterEach` calls `cleanupUser` per user; `ON DELETE CASCADE` from `auth.users` wipes all `applications` and `application_notes` rows — no manual table cleanup needed.
- Assert at the row level via `supabase-js` queries (`.from(...).select()`). Never assert through service-layer helpers in `src/` — an API-layer shortcut hides RLS and trigger regressions.
- RLS returns an empty result set, not an error, for blocked queries (`data: []`, `error: null`). The F-01 write-attack test is the exception: a policy violation on INSERT does return `error.code === '42501'`.

See `tests/integration/` for the full matrix (applications, notes, attack, unauthenticated).

### 6.3 Adding a test for a new API endpoint

**Phase 3 shipped.** Prerequisites: same as §6.2, plus `astro dev` is spawned automatically by `tests/global-setup.ts`; `process.env.TEST_BASE_URL` is set before any HTTP test runs.

**Standard test shape:**

```ts
import { signInAndCaptureCookies } from '../helpers/cookies';
import { createAdminClient } from '../helpers/supabase-clients';
import { provisionUser, cleanupUser } from '../helpers/users';

const admin = createAdminClient();
const BASE = () => process.env.TEST_BASE_URL!;

let userA: Awaited<ReturnType<typeof provisionUser>>;
let cookiesA: string;

beforeEach(async () => {
  userA = await provisionUser(admin);
  cookiesA = await signInAndCaptureCookies(userA.email, userA.password);
});

afterEach(() => cleanupUser(admin, userA.userId));

it('returns 401 without a cookie', async () => {
  const res = await fetch(`${BASE()}/api/applications`, { method: 'POST', ... });
  expect(res.status).toBe(401);
});

it('returns 201 with a valid cookie', async () => {
  const res = await fetch(`${BASE()}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookiesA },
    body: JSON.stringify(validBody),
  });
  expect(res.status).toBe(201);
});
```

**Ownership matrix (Risk #5 — two-user form):** provision both A and B; capture both cookie strings; drive the mutating verb as B against A's UUID; assert **exactly** 404 (`toBe(404)`, not `toBeGreaterThanOrEqual`) — 404-collapse is the load-bearing existence-leak guard.

**Key rules:**
- `signInAndCaptureCookies` builds a `@supabase/ssr` `createServerClient` with a `setAll` accumulator; the captured cookie names match what Astro middleware expects because both use the same library against the same Supabase URL.
- `astro dev` reads Supabase credentials from `.dev.vars`, not `.env.test`. The global-setup file copies the local-stack values into `.dev.vars` before spawning the dev server; see `tests/global-setup.ts` for the swap-and-restore pattern.
- Assert status codes with `toBe`, not `toBeGreaterThan` — precision matters; a 200 where a 404 is expected is a silent regression.
- The `astro dev` process is shared across the whole run (one cold start, ~3–5 s); do not spawn it inside individual tests.

See `tests/http/` for the full POST + PATCH smoke patterns.

### 6.4 Adding a test for the parser layer

**Phase 2 partially shipped (2026-06-18).** See `context/changes/parser-correctness-and-abuse-surface/`.

**Fixture capture.** Use the procedure in `tests/fixtures/parsers/README.md`. For LinkedIn, fetch the guest API fragment at `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<jobId>`; for JustJoin.it, fetch the full page at `https://justjoin.it/job-offer/<slug>`. Use the same User-Agent the parsers use (see `src/lib/parsers/linkedin.ts:4`).

**Oracle rule.** After capturing a fixture, open the source URL in a browser. Type the expected `position`, `company`, `salary`, and a salient fragment from `description` directly from the visible page into the test file — **never** from running the parser. This prevents the silent-drift anti-pattern (Risk #1 §2): if the parser returns garbage, the test reds because the oracle comes from an independent source.

**Parser test pool.** Parser fixture tests (LinkedIn and JustJoin.it) run in the **workers** pool (`@cloudflare/vitest-pool-workers`) because they need `HTMLRewriter`. Load fixture files via Vite's `?raw` suffix:

```ts
import happyHtml from "../../fixtures/parsers/linkedin/happy.html?raw";

it("happy: extracts all five fields", async () => {
  await withFetchStub(
    () => new Response(happyHtml, { status: 200 }),
    async () => {
      const result = await parseLinkedIn("12345678");
      expect(result.position).toBe("…oracle from visible page…");
    },
  );
});
```

**Three scenarios per portal:** `happy` (all fields), `missing-salary` (salary undefined), `corrupted` (critical element removed → parser throws). See `tests/unit/parsers/{linkedin,justjoinit}.test.ts`.

**`recognize()` URL classifier** runs in the **node** pool (pure function, no `HTMLRewriter`): see `tests/unit/parsers/recognize.test.ts` and §6.1.

### 6.5 Adding a test for new business logic (e.g. flag computation)

TBD — see future S-09 plan. Will cover: pure date-function unit pattern with injected "now" (per Risk #6 anti-pattern), independent of UI and DB.

### 6.6 Per-rollout-phase notes

**Phase 1 (test bootstrap) + Phase 3 (HTTP smoke) — shipped 2026-06-16:**
`email_confirm: true` must be passed to `admin.auth.admin.createUser` even when the project has email confirmations disabled — the two settings are independent switches; omitting it causes `signInWithPassword` to fail with "Email not confirmed".
`@astrojs/cloudflare` reads `astro:env/server` vars from `.dev.vars` via `getPlatformProxy()`, not from `process.env`, so HTTP smoke tests must temporarily swap `.dev.vars` to point at the local Supabase stack before spawning `astro dev` — see `tests/global-setup.ts`.
`signInAndCaptureCookies` in `tests/helpers/cookies.ts` drives a `@supabase/ssr` `createServerClient` with a `setAll` accumulator; the captured cookie names match what Astro middleware expects because both use the same library with the same Supabase URL.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **shadcn/ui primitives + Astro starter scaffold** — vendored from upstream; the upstream library is the test. Re-evaluate if a primitive is forked/patched in-tree. (Source: Phase 2 interview Q5.)
- **Supabase Auth internals (signup / signin / signout endpoint bodies)** — Supabase Auth is tested by Supabase. We test only that `src/middleware.ts` enforces the gate (covered indirectly by Phase 1 cross-user integration). Re-evaluate if the auth surface gains custom logic beyond a thin wrapper. (Source: Phase 2 interview Q5.)
- **Visual / snapshot tests on the kanban board** — board layout churn during MVP would break snapshots weekly without catching real regressions. Re-evaluate when the visual surface stabilises after S-11. (Source: Phase 2 interview Q5.)
- **Pre-merge CI coverage gates / thresholds** — the goal is signal on top risks, not a coverage number. Re-evaluate only if a regression class appears that a coverage threshold would have caught and the fixture/integration suite missed. (Source: Phase 2 interview Q5.)
- **Workers/workerd runtime divergence as a test gate** — explicitly out of scope for this rollout. Operational mitigation via `wrangler dev` during parser-touching development per `infrastructure.md` (see §5 row). Re-evaluate via `--refresh` if a workerd-only regression ships to prod. (Source: user decision during Phase 3 brief review, 2026-06-16.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-16
- Stack versions last verified: 2026-06-16
- AI-native tool references last verified: 2026-06-16

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
