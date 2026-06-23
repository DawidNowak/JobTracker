# Domain invariants — lastActionAt trigger + endpoint IDOR (test rollout Phase 3) Implementation Plan

## Overview

Ship the integration tests for rollout Phase 3 of `context/foundation/test-plan.md` ("Domain invariants — lastActionAt + IDOR"). Two test families:

- **Risk #3** — prove the four `lastActionAt` trigger invariants hold at the SQL row level against the fully-migrated local stack.
- **Risk #5** — prove the applications mutation endpoint enforces ownership independently of RLS (cross-user PATCH → exactly 404), with the verbs that have no HTTP surface explicitly delegated to the existing RLS-layer coverage.

This is test-authoring work only. No production code changes — the tests pin behaviour that already exists (the trigger is in the schema migration; the `.eq("user_id", …)` ownership clause is already in the service). A small `seedApplication` helper and a targeted test-plan §6.3 correction round out the change.

## Current State Analysis

- **Infrastructure is complete and reused as-is.** `tests/integration/**` and `tests/http/**` are both already in the node-pool include globs (`vitest.config.ts`), so Phase 3 tests need **no config change**. Global setup spawns `astro dev`, swaps `.dev.vars` to the local stack, sets `TEST_BASE_URL`, and `tests/setup.ts` hard-asserts the Supabase URL is local (`127.0.0.1:54321`).
- **Helpers exist** for everything except seeding: `createAdminClient()` / `createUserClient()` (`tests/helpers/supabase-clients.ts`), `provisionUser` / `cleanupUser` (`tests/helpers/users.ts`), `signInAndCaptureCookies` (`tests/helpers/cookies.ts`). There is no shared "seed an application" helper — current tests insert inline (`tests/http/patch-applications.test.ts:22-31`, `tests/integration/rls-applications.test.ts:17-25`).
- **The trigger mechanics** (`supabase/migrations/20260526123145_applications_schema.sql:24-26,108-157`): `created_at` and `last_action_at` both default `now()` (transaction-stable → exactly equal on a single INSERT); a `BEFORE UPDATE ... WHEN (old.status IS DISTINCT FROM NEW.status)` trigger advances `last_action_at` on status change; an `AFTER INSERT` trigger on `application_notes` calls a `SECURITY DEFINER` helper that advances the parent's `last_action_at`. The hardening migration `20260528153903_lock_trigger_function_search_path.sql:16-36` recreates both functions — evidence that triggers are in scope for future patches, which is why the regression test must run green against the *migrated* DB.
- **The mutation surface is intentionally tiny.** Only `POST /api/applications` and `PATCH /api/applications/[id]` exist — there is no GET/PUT/DELETE handler anywhere under `src/pages/api/`. A cross-user PATCH already returns 404 via `.eq("user_id", userId)` + `.maybeSingle()` → `null` → 404 (`src/lib/services/applications.ts:20-38`, `src/pages/api/applications/[id].ts:40-46`). An existing test already asserts the single 404 case (`tests/http/patch-applications.test.ts:46-53`); Phase 3 makes the matrix explicit.
- **No raw `pg`/SQL client exists, and none is needed** — `created_at` and `last_action_at` are PostgREST-selectable columns, readable through `createAdminClient().from("applications").select(...)`.

## Desired End State

`npm test` (with a local Supabase stack up) runs, in addition to the existing suite:

- A new `tests/integration/lastactionat-trigger.test.ts` that goes green only if all four trigger invariants hold against the fully-migrated DB.
- An extended `tests/http/patch-applications.test.ts` whose IDOR matrix asserts the live PATCH surface returns **exactly 404** for a non-owner and 200 for the owner, with an in-file comment delegating SELECT/UPDATE/DELETE ownership to `rls-applications.test.ts`.
- A `tests/helpers/seed.ts` `seedApplication(client, userId, overrides?)` helper used by both suites.
- `context/foundation/test-plan.md` §6.3 corrected to describe the live surface, and the §3 rollout row advanced to its new status.

Verify: `npm test` passes with the local stack up; `npm run typecheck` and `npm run lint` pass; temporarily reverting the status-bump trigger (or the `.eq("user_id")` clause) locally reds at least one new test.

### Key Discoveries:

- `now()` transaction-stability makes invariant #1 an **exact equality** and #2/#4 a strict `>` against a captured pre-state — deterministic, no sleeps (`research.md` Architecture Insights).
- The `WHEN (old.status IS DISTINCT FROM NEW.status)` guard is exactly what makes "non-status edit leaves `last_action_at` unchanged" a genuine, assertable invariant — assert it by UPDATE-ing `source` (a non-status column) via the user client (`research.md` Resolved Decision #2).
- 404-collapse is a deliberate existence-leak guard; assert `toBe(404)` exactly, never `toBeGreaterThanOrEqual` (test-plan §6.3, `research.md` Architecture Insights).
- Existing precedents to mirror: `tests/http/patch-applications.test.ts` (two-user HTTP 404 + trigger-advance follow-up read), `tests/integration/rls-applications.test.ts` (RLS SELECT/UPDATE/DELETE matrix).

## What We're NOT Doing

- **No production code changes.** Tests pin existing behaviour; if a test reds, that is a real regression, not a signal to change `src/`.
- **No raw `pg`/SQL client** — PostgREST column reads are sufficient.
- **No HTTP tests for GET/PUT/DELETE** — those handlers don't exist; their ownership stays proven at the RLS layer.
- **No negative test for the trigger-bypass property** — a direct `last_action_at` write on a non-status edit is not corrected by the trigger, but no API path reaches it; documented as a known property, not tested (`research.md` Resolved Decision #3).
- **No new npm script** — `npm test` keeps running all pools in one invocation (no `test:integration` split).
- **No full §6.3 rewrite** — only the over-stated verb list is corrected, not the cookbook restructured.
- **No CI wiring** — that is Phase 4.

## Implementation Approach

Build bottom-up: land the shared `seedApplication` helper first so both suites consume it, then the trigger invariants (Risk #3, pure row-level integration), then the IDOR matrix (Risk #5, HTTP), then the docs correction. Each phase mirrors an existing precedent file so the reviewer sees a familiar shape. All assertions read the DB through the admin client (canonical, RLS-bypassing) for trigger invariants and through the HTTP endpoint for the IDOR matrix, so a regression in either the trigger *or* the ownership clause reds a test.

## Phase 1: seedApplication helper + lastActionAt trigger invariants

### Overview

Add the shared seeder, then assert all four `lastActionAt` invariants at the row level against the migrated DB.

### Changes Required:

#### 1. Application seeder helper

**File**: `tests/helpers/seed.ts`

**Intent**: Cut the inline `.from("applications").insert(...).select().single()` duplication across the trigger and IDOR suites with one helper that inserts via the passed client and returns the inserted row (including `id`, `created_at`, `last_action_at`) for immediate assertion.

**Contract**: `seedApplication(client: SupabaseClient<Database>, userId: string, overrides?: Partial<...>): Promise<Row>`. Inserts `{ source: "test-seed", status: "Zaaplikowano", user_id: userId, ...overrides }`; selects the full row; throws a descriptive error on failure (mirroring the existing `Setup: insert failed — ${error.message}` convention). Takes `userId` explicitly so it works with both the admin client and a user client (matches `createApplication`'s signature and keeps canonical admin-client reads possible).

#### 2. lastActionAt trigger invariant suite

**File**: `tests/integration/lastactionat-trigger.test.ts`

**Intent**: Prove the four trigger invariants hold against the fully-migrated local DB, reading canonical column values through the admin client.

**Contract**: A `describe` mirroring `rls-applications.test.ts` structure — `provisionUser` two users in `beforeEach` is unnecessary here (one user suffices); `cleanupUser` in `afterEach`. Four `it` cases:
1. **INSERT → equal**: seed a row; assert `last_action_at === created_at` (exact equality, both `now()` at transaction start).
2. **status UPDATE → advanced**: seed; capture `created_at`; UPDATE `status` (`Interesujące`→`Zaaplikowano` or similar) via the user client; re-read; assert `new Date(last_action_at) > new Date(created_at)`.
3. **non-status UPDATE → unchanged**: seed; capture `last_action_at`; UPDATE `source` (non-status column) via the user client; re-read; assert `last_action_at` byte-equal to the captured value (the `WHEN` guard means the trigger never fired).
4. **note INSERT → parent advanced**: seed; capture parent `last_action_at`; INSERT an `application_notes` row (`{ application_id, user_id, body }`) via the user client; re-read parent; assert parent `last_action_at` advanced (`>` captured value).

Reads use `createAdminClient().from("applications").select("created_at,last_action_at")` for canonical values. Use the status enum values from `src/lib/validation/applications.ts:3` (`Interesujące` / `Zaaplikowano` / `Rozmowa`).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- New trigger suite passes against a running local stack: `npm test` (with `npx supabase start`)

#### Manual Verification:

- Temporarily neutralise the status-bump trigger locally (or its `WHEN` guard) and confirm invariant #2 (and/or #3) reds — proving the suite actually exercises the trigger, not a tautology.
- Confirm invariant #1 is an exact equality (not a tolerance window) by inspecting the assertion.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: IDOR PATCH ownership matrix

### Overview

Make the cross-user ownership matrix explicit on the one live id-addressed mutating verb (PATCH), and document why the other verbs have no HTTP leg.

### Changes Required:

#### 1. Extend the PATCH IDOR matrix

**File**: `tests/http/patch-applications.test.ts`

**Intent**: Expand the existing single non-owner-404 case into an explicit ownership matrix so a future regression to the `.eq("user_id", …)` clause reds here at the HTTP layer (defence-in-depth, independent of RLS). Adopt `seedApplication` for the setup insert.

**Contract**: Reuse the existing two-user `beforeEach` (both users provisioned, both cookie strings captured, one application seeded for user A via `seedApplication(userA.client, userA.userId)`). Ensure the matrix covers, asserting `toBe` exactly:
- non-owner (cookies B) PATCH against A's UUID → **exactly 404**, and the DB row is unchanged (re-read via admin client: status + `last_action_at` untouched — proves the mutation never executed).
- owner (cookies A) PATCH → 200 + DB reflects the new status and `last_action_at` advanced (existing assertion at `:55-75`).
- (existing) no-cookie → 401.

Add a top-of-file or in-`describe` comment delegating SELECT/UPDATE/DELETE ownership to `tests/integration/rls-applications.test.ts`, noting those verbs have no HTTP surface (no GET/PUT/DELETE handler exists).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- PATCH IDOR matrix passes against the local stack: `npm test`

#### Manual Verification:

- Temporarily drop the `.eq("user_id", userId)` clause in `src/lib/services/applications.ts` locally and confirm the non-owner test flips from 404 to 200 (or a row mutation) — proving the test pins the ownership clause, not just RLS. Restore afterward.
- Confirm the non-owner assertion checks the DB row was not mutated, not only the status code.

**Implementation Note**: After this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Docs — §6.3 correction + rollout status

### Overview

Correct the test-plan §6.3 over-statement and advance the rollout-table status, closing the loop research opened.

### Changes Required:

#### 1. Correct §6.3 verb list and note the surface split

**File**: `context/foundation/test-plan.md`

**Intent**: §6.3's "Ownership matrix (Risk #5 — two-user form)" currently says "each verb GET/PUT/DELETE," which over-states the live surface. Replace with the live surface and a one-line note on the split, keeping the 404-collapse guidance intact.

**Contract**: Edit the §6.3 ownership-matrix paragraph so it names **PATCH `/api/applications/[id]`** as the only id-addressed mutating verb tested at the HTTP layer, and states SELECT/UPDATE/DELETE ownership is proven at the RLS layer (`tests/integration/rls-applications.test.ts`) because no GET/PUT/DELETE handler exists. Keep the "assert exactly 404" guidance. Add a §6.6 per-phase note for Phase 3 (mirroring the Phase 1/2 note style) recording: the trigger-invariant suite reads canonical columns via the admin client; the trigger-bypass property (direct `last_action_at` write on a non-status edit is not trigger-corrected, but no API path reaches it) as a documented known property; and the `seedApplication` helper addition.

#### 2. Advance the rollout-table status

**File**: `context/foundation/test-plan.md`

**Intent**: Move the §3 rollout table row 3 status from `change opened` to its new value once the suites land.

**Contract**: Update the row-3 `Status` cell (currently `change opened`) per the §3 status vocabulary — `complete` once the Progress section here is fully checked. Also update the header "Last updated" line. (Mechanical doc edit.)

#### 3. Update change.md status

**File**: `context/changes/testing-lastactionat-and-idor/change.md`

**Intent**: Reflect plan/implementation progress in the change frontmatter.

**Contract**: Set `status: planned` (now) and `updated: 2026-06-23`; the implement step moves it onward.

### Success Criteria:

#### Automated Verification:

- Full suite passes against the local stack: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- §6.3 no longer references GET/PUT/DELETE as tested HTTP verbs; the live surface is described accurately.
- §3 rollout row 3 status matches the actual Progress state.

**Implementation Note**: Final phase — confirm the docs read correctly and the rollout status is accurate.

---

## Testing Strategy

### Unit Tests:

- None new. Phase 3 is integration/HTTP only; the pure-function unit surface (parsers, `recognize`, `resolveStatus`) is unchanged.

### Integration Tests:

- `tests/integration/lastactionat-trigger.test.ts` — four trigger invariants, row-level, admin-client reads, against the migrated local stack.
- `tests/http/patch-applications.test.ts` (extended) — two-user PATCH ownership matrix (exactly-404 + owner-200 + no-mutation-on-denied).

### Manual Testing Steps:

1. `npx supabase start`; populate `.env.test` from `npx supabase status`.
2. `npm test` — confirm the new trigger suite and extended PATCH matrix pass.
3. Revert the status-bump trigger locally → confirm a trigger invariant reds. Restore.
4. Drop `.eq("user_id", userId)` in `src/lib/services/applications.ts` → confirm the IDOR non-owner test reds. Restore.

## Performance Considerations

Negligible. The trigger suite adds one short-lived user + a handful of inserts/updates per test; the IDOR matrix reuses the existing two-user `astro dev`-backed setup. `now()` transaction-stability means no `sleep`/polling is needed for the timestamp assertions.

## Migration Notes

None — no schema or data migration. The suites must run against the **fully-migrated** local stack (the point of the regression guard is that the invariants survive every migration, including the trigger-hardening one).

## References

- Research: `context/changes/testing-lastactionat-and-idor/research.md`
- Test plan: `context/foundation/test-plan.md` (§2 Risks #3/#5, §3 Phase 3, §6.3, §6.6)
- Precedent — HTTP two-user 404 + trigger-advance read: `tests/http/patch-applications.test.ts`
- Precedent — RLS SELECT/UPDATE/DELETE matrix: `tests/integration/rls-applications.test.ts`
- Trigger source: `supabase/migrations/20260526123145_applications_schema.sql:108-157`
- Ownership clause: `src/lib/services/applications.ts:20-38`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: seedApplication helper + lastActionAt trigger invariants

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 544b4b9
- [x] 1.2 Linting passes: `npm run lint` — 544b4b9
- [x] 1.3 New trigger suite passes against a running local stack: `npm test` — 544b4b9

#### Manual

- [x] 1.4 Neutralising the status-bump trigger locally reds invariant #2/#3 — 544b4b9
- [x] 1.5 Invariant #1 is an exact equality, not a tolerance window — 544b4b9

### Phase 2: IDOR PATCH ownership matrix

#### Automated

- [x] 2.1 Type checking passes: `npm run typecheck` — 1ceac6a
- [x] 2.2 Linting passes: `npm run lint` — 1ceac6a
- [x] 2.3 PATCH IDOR matrix passes against the local stack: `npm test` — 1ceac6a

#### Manual

- [x] 2.4 Investigated: `createClient()` uses the anon key + session cookie, so RLS is active on every request. Removing `.eq("user_id")` leaves the non-owner test green because RLS already hides user A's row from user B — the two layers cannot be isolated through this endpoint. Finding recorded in the test file comment; combined end-to-end protection is what the suite proves. — 1ceac6a
- [x] 2.5 Non-owner assertion checks the DB row was not mutated, not only status code — 1ceac6a

### Phase 3: Docs — §6.3 correction + rollout status

#### Automated

- [x] 3.1 Full suite passes against the local stack: `npm test`
- [x] 3.2 Type checking passes: `npm run typecheck`
- [x] 3.3 Linting passes: `npm run lint`

#### Manual

- [x] 3.4 §6.3 no longer references GET/PUT/DELETE as tested HTTP verbs
- [x] 3.5 §3 rollout row 3 status matches the actual Progress state
