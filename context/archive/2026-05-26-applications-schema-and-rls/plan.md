# Applications Schema and RLS Foundation (F-01) — Implementation Plan

## Overview

Land the data foundation for JobTracker MVP: two PostgreSQL tables (`applications`, `application_notes`) in Supabase with per-user row-level security, a SECURITY DEFINER trigger function that owns the `last_action_at` invariant, generated TypeScript types, Zod write-shape schemas ready for S-02 endpoints, npm dev-loop scripts, and a CI gate (`supabase db lint` + `astro check`). No API endpoints, no UI — purely the contract every downstream slice (S-01 through S-11) consumes.

## Current State Analysis

- **Supabase wired, schema empty.** `src/lib/supabase.ts:9` builds a per-request SSR client; `auth.uid()` is resolved from the cookie session at every query — RLS policies bound to `auth.uid()` work today. `supabase/config.toml:58` has `schema_paths = []` and no `supabase/migrations/` directory exists. The Supabase CLI is installed as a dev dep (`package.json:52`, `supabase@2.101.0`).
- **Middleware exposes `locals.user`** (`src/middleware.ts:13`) but does NOT expose `locals.supabase`. Endpoints must call `createClient(request.headers, cookies)` themselves — the existing auth endpoints follow this pattern (e.g., `src/pages/api/auth/signin.ts`). F-01 does not change this; it just makes the per-request client useful by giving it tables to query.
- **No Zod, no tests, no generated DB types, no JSON envelopes.** Current API endpoints (auth only) are form-redirect; no domain endpoints exist. F-01 introduces the Zod module but no consumer until S-02.
- **CI runs lint + build** (`.github/workflows/ci.yml:18-21`); no migration validation, no typecheck step (the `astro build` implicitly type-checks, but a dedicated `astro check` step is cleaner and surfaces drift between migrations and committed types).

## Desired End State

- `supabase db reset` (against a local Supabase Docker instance) replays the migration with zero errors.
- Two tables exist in the `public` schema: `applications` and `application_notes`, both with RLS enabled and four policies each (SELECT/INSERT/UPDATE/DELETE) scoping every row to `user_id = auth.uid()`.
- `last_action_at` updates only when (a) `applications.status` changes via a `BEFORE UPDATE` trigger, OR (b) a row is inserted into `application_notes` via an `AFTER INSERT` trigger calling a `SECURITY DEFINER` function. Edits to other columns (position, company, description, salary, work_mode, recruiter_contact, source) leave `last_action_at` untouched. New rows default `last_action_at = now()`.
- `src/lib/database.types.ts` is committed and reflects the migration; `npm run typecheck` passes.
- `src/lib/validation/applications.ts` exports `applicationCreateSchema`, `applicationUpdateSchema`, `applicationNoteCreateSchema` as Zod schemas matching the table write-shapes.
- `npm run db:reset`, `npm run db:types`, and `npm run typecheck` exist as documented scripts.
- CI (`.github/workflows/ci.yml`) gains a `typecheck` step on the existing `ci` job. PRs cannot merge when it fails.

### Key Discoveries:

- **Per-request Supabase client pattern** is established at `src/lib/supabase.ts:5-23`. RLS works automatically — the SSR client carries the user's JWT, every query is scoped by Postgres.
- **`auth.uid()` is provider-agnostic** — the email+password session and any future OAuth provider both populate it. RLS policies are stable across the v2 auth roadmap.
- **Polish DB literals decided** — `status` values are `'Interesujące'`, `'Zaaplikowano'`, `'Rozmowa'` and `work_mode` values are `'Zdalna'`, `'Hybrydowa'`, `'Stacjonarna'`, stored verbatim. UI is a passthrough. Migration file is UTF-8 (default from `supabase migration new`); Postgres `text` + CHECK accepts the diacritics natively.
- **No `skills` column, no structured salary** — per shaping: skills are part of `description`; salary is a single free-form `text` column.
- **Archive lifecycle is a nullable `archived_at` column**, not a separate table or fourth status. Active board query filters `WHERE archived_at IS NULL`; archive view filters `WHERE archived_at IS NOT NULL`.

## What We're NOT Doing

- No API endpoints (`/api/applications`, `/api/applications/:id/notes`, etc.) — those are S-02 onward. F-01 ships the contract; S-02 imports it.
- No UI surface — S-01 (kanban shell) consumes the schema for reads first.
- No analytics columns, no `archived_from_status`, no soft-delete on notes. PRD parks all of this.
- No pgTAP, no Vitest, no Playwright. RLS/trigger correctness is verified via a manual runbook in Phase 2.
- No CI drift check that regenerates types and diffs. Adding Supabase-in-CI is a separate decision; the lightweight gate is committed types + typecheck.
- No `supabase db lint` job in CI. The CLI's `db lint` requires a live DB connection (`--linked`, `--local`, or `--db-url`) and cannot statically lint migration files. The realistic options — boot Docker in CI or wire a hosted-DB connection secret — both add infrastructure that outweighs the marginal value over `astro check` + committed `database.types.ts` for a small, frozen foundation migration.
- No service role key in the app. F-01 stays on the anon key + RLS — the SECURITY DEFINER function is the only escalation point and it's owned by `postgres`, callable from the trigger.

## Implementation Approach

Three phases, each independently verifiable:

1. **Schema migration**: one SQL file applying tables, constraints, RLS, trigger function, triggers. Verified by `supabase db reset` succeeding.
2. **Tooling and contracts**: generated types + Zod write-shapes + npm scripts. Verified by `astro check` and a manual runbook against the local DB.
3. **CI gate**: extend `.github/workflows/ci.yml` with a `typecheck` step. Verified by green CI on the foundation branch.

The migration is monolithic on purpose. Splitting "tables" from "RLS" creates a transient window where tables exist without isolation — even on a greenfield database that's a bad habit to encode in the migration history. The single migration locks the invariant from the first apply.

## Critical Implementation Details

- **Trigger / RLS interaction.** The `AFTER INSERT` trigger on `application_notes` updates the parent `applications.last_action_at`. Without escalation, that UPDATE would be filtered by `applications` RLS policies (the trigger runs in the same session as the inserting user). The fix: wrap the update in a `SECURITY DEFINER` function owned by `postgres`, with `SET search_path = ''` and fully qualified table references (`public.applications`). RLS still gates the note insert itself — a user cannot insert a note for another user's application because `application_notes.user_id` policy fails first.

- **`BEFORE UPDATE` trigger semantics.** The trigger on `applications` must set `NEW.last_action_at = now()` ONLY when `OLD.status IS DISTINCT FROM NEW.status`. Critically, the trigger MUST NOT short-circuit when other columns change — those edits pass through unchanged. The `IS DISTINCT FROM` operator (not `!=`) handles the NULL case correctly even though `status` is NOT NULL; using it is convention and documents intent.

- **Polish literal encoding.** Migration files must be saved as UTF-8 without BOM. `supabase migration new` produces this by default. If the file is edited in PowerShell with `Set-Content`, default encoding can be UTF-16 LE on older PS versions — `Out-File -Encoding utf8` or the `Write` tool from this harness produces UTF-8 correctly.

## Phase 1: Schema migration with RLS and triggers

### Overview

Land one SQL migration that creates both tables, enables RLS with four policies each, defines the SECURITY DEFINER trigger function, and attaches the two triggers. Update `supabase/config.toml` to track the migrations folder.

### Changes Required:

#### 1. New migration file

**File**: `supabase/migrations/<timestamp>_applications_schema.sql` (timestamp from `supabase migration new applications_schema`)

**Intent**: Create the two domain tables with all column constraints, enable RLS, define eight policies (SELECT/INSERT/UPDATE/DELETE × 2 tables) scoping rows to `auth.uid()`, define the SECURITY DEFINER function `public.bump_application_last_action_at(uuid)`, and attach the two triggers.

**Contract**:

- `public.applications` columns:
  - `id uuid primary key default gen_random_uuid()`
  - `user_id uuid not null references auth.users(id) on delete cascade`
  - `source text not null` — free text, no URL validation (FR-003)
  - `position text` — nullable; parser may fail to extract
  - `company text` — nullable
  - `description text` — nullable; absorbs skills per shaping decision
  - `salary text` — nullable; free-form
  - `work_mode text check (work_mode is null or work_mode in ('Zdalna', 'Hybrydowa', 'Stacjonarna'))`
  - `recruiter_contact text` — nullable (FR-019)
  - `status text not null default 'Interesujące' check (status in ('Interesujące', 'Zaaplikowano', 'Rozmowa'))`
  - `created_at timestamptz not null default now()`
  - `last_action_at timestamptz not null default now()`
  - `archived_at timestamptz` — nullable; non-null means archived (FR-009, FR-010)
- `public.application_notes` columns:
  - `id uuid primary key default gen_random_uuid()`
  - `application_id uuid not null references public.applications(id) on delete cascade`
  - `user_id uuid not null references auth.users(id) on delete cascade` — denormalized so RLS policy is a direct comparison rather than a subquery
  - `body text not null check (length(body) > 0)`
  - `created_at timestamptz not null default now()`
- Indexes:
  - `applications (user_id)` — every list query filters by user via RLS but an explicit index helps planner
  - `applications (user_id, status) where archived_at is null` — partial index for the active board query
  - `applications (user_id, archived_at) where archived_at is not null` — partial index for archive view (FR-010)
  - `application_notes (application_id, created_at desc)` — for the FR-014 history reverse-chrono read
- RLS: `alter table public.applications enable row level security;` and same for `application_notes`. Four policies per table — SELECT/INSERT/UPDATE/DELETE — each `using (user_id = auth.uid())` and (for INSERT) `with check (user_id = auth.uid())`.
- `public.bump_application_last_action_at(app_id uuid)` function: `language plpgsql security definer set search_path = ''` body executes `update public.applications set last_action_at = now() where id = app_id;`. Granted EXECUTE to `authenticated`.
- Trigger `applications_status_bumps_last_action` — `before update on public.applications for each row when (old.status is distinct from new.status)` — sets `new.last_action_at = now()`.
- Trigger `application_notes_bumps_parent_last_action` — `after insert on public.application_notes for each row execute function public.bump_application_last_action_at(new.application_id)`.

A snippet for the trigger function (load-bearing — the `search_path = ''` and fully qualified reference are the parts most easily lost in re-writes):

```sql
create or replace function public.bump_application_last_action_at(app_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.applications
     set last_action_at = now()
   where id = app_id;
end;
$$;
```

#### 2. `supabase/config.toml` — wire migrations folder

**File**: `supabase/config.toml`

**Intent**: Point `[db.migrations].schema_paths` (currently `[]` at line 58) at the migrations folder so `supabase db reset` and `supabase db lint` see the migration.

**Contract**: `schema_paths = ["./migrations/*.sql"]`. No other field changes.

### Success Criteria:

#### Automated Verification:

- `supabase db reset` applies the migration without errors (run locally; CI does not run a real DB).
- `supabase db lint` reports no errors against the migration.
- `npm run lint` and `npm run build` continue to pass (no app code changed in this phase).

#### Manual Verification:

- Open Supabase Studio at `http://127.0.0.1:54323` after `supabase db reset`. Confirm both tables exist with all columns, all constraints, and RLS enabled.
- Sign up two test users via the existing `/auth/signup` flow. As user A, insert a row into `applications` via Studio's SQL editor under user A's JWT context (or via a small ad-hoc curl through the SSR client). As user B, query `select * from applications` — expect zero rows.
- As user A, insert a row in `applications`; observe `last_action_at` equals `created_at` (column default).
- Update the row's `position` (any column other than status). Confirm `last_action_at` did NOT change.
- Update the row's `status` from `'Interesujące'` to `'Zaaplikowano'`. Confirm `last_action_at` advanced.
- Insert a row into `application_notes` referencing that application. Confirm the parent `applications.last_action_at` advanced.
- Attempt to insert a note referencing user A's application while signed in as user B. Expect RLS rejection.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the runbook above has been executed against a local Supabase instance before proceeding to Phase 2.

**Post-implementation addendum (2026-05-28, search_path on trigger helpers)**: A second follow-up migration `20260528153903_lock_trigger_function_search_path.sql` `create or replace`s the two SECURITY INVOKER trigger helpers (`applications_bump_last_action_at_on_status_change`, `application_notes_bump_parent_trigger`) with `set search_path = ''` added. The original Phase 1 migration locked search_path only on the SECURITY DEFINER function. The helpers reference no tables by name today (one writes only NEW; the other PERFORMs a fully qualified function), so the live risk is low — this is defense-in-depth and clears Supabase's `function_search_path_mutable` linter warning the Phase 1 db lint criterion implicitly relied on.

**Post-implementation addendum (2026-05-28, RLS hole)**: A follow-up migration `20260526132205_harden_application_notes_rls.sql` was added after Phase 1 landed. The Phase 1 INSERT/UPDATE policies on `application_notes` only checked `user_id = auth.uid()`, which let user B insert a note owned by themselves but pointed at user A's `application_id` — a cross-user write leak. The follow-up tightens both policies with an additional `exists (select 1 from public.applications where id = application_id and user_id = auth.uid())` predicate. SELECT and DELETE policies keep the direct-equality form since the writer-side check now guarantees note ownership is consistent with the parent application. The hole and the fix are both surfaced by the Phase 1 manual runbook step "Attempt to insert a note referencing user A's application while signed in as user B" — the runbook caught it post-merge, not before.

---

## Phase 2: Generated types, Zod write-shapes, npm scripts

### Overview

Commit generated TypeScript types from the migration, write the Zod write-shape module that S-02+ endpoints will import, and add the three npm scripts (`db:reset`, `db:types`, `typecheck`) that document the developer loop.

### Changes Required:

#### 1. npm scripts

**File**: `package.json`

**Intent**: Add three scripts that codify the foundation workflow.

**Contract**: Insert into the existing `"scripts"` object (after `"format"`):

- `"db:reset": "supabase db reset"`
- `"db:types": "supabase gen types typescript --local > src/lib/database.types.ts"`
- `"typecheck": "astro check"`

No new dependencies (`@astrojs/check` is already in `dependencies` at line 15; `supabase` CLI is in devDependencies at line 52).

#### 2. Generated database types

**File**: `src/lib/database.types.ts`

**Intent**: Commit the output of `npm run db:types` so consumers (S-01 read query, S-02 writes) have typed access to `applications` and `application_notes` without each engineer running `gen types` first.

**Contract**: The file is generated, not handwritten. It exports the `Database` type with `public.Tables.applications` and `public.Tables.application_notes` Row/Insert/Update shapes. Status and work_mode appear as string literal unions matching the CHECK constraints.

#### 3. Zod write-shape module

**File**: `src/lib/validation/applications.ts`

**Intent**: Define the Zod schemas every domain endpoint (S-02 onward) will import. Schemas match what a client sends, NOT what the DB stores — so they exclude `id`, `user_id`, `created_at`, `last_action_at`, `archived_at` (server-managed) and require the same fields the migration marks `not null`.

**Contract**: Three exported schemas (signatures only — implementer writes the Zod calls):

- `applicationCreateSchema` — fields: `source: string().min(1)`, `position: string().nullable().optional()`, `company: string().nullable().optional()`, `description: string().nullable().optional()`, `salary: string().nullable().optional()`, `work_mode: enum(['Zdalna','Hybrydowa','Stacjonarna']).nullable().optional()`, `recruiter_contact: string().nullable().optional()`, `status: enum(['Interesujące','Zaaplikowano','Rozmowa']).default('Interesujące')`. No `archived_at` (set only via the reject endpoint in S-10).
- `applicationUpdateSchema` — all fields from create are optional; `status` is its enum without a default. Used by S-03 (edit) and S-05 (status transition).
- `applicationNoteCreateSchema` — `application_id: string().uuid()`, `body: string().min(1)`. `user_id` is NOT in the client payload; the endpoint sets it from `locals.user.id`.

Also export the inferred TypeScript types: `export type ApplicationCreate = z.infer<typeof applicationCreateSchema>` etc.

#### 4. Add `zod` dependency

**File**: `package.json`

**Intent**: Install Zod (currently absent per research). Pin to current major (`^3` or `^4` — implementer chooses based on what `npm install zod@latest` resolves at run time; both are stable). Add to `dependencies`, not `devDependencies` — runtime imports.

**Contract**: One entry in `dependencies`. Lockfile updated. No other deps move.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` passes (validates `database.types.ts` parses, Zod module type-checks, no drift from migration).
- `npm run lint` passes (Zod module obeys ESLint config).
- `npm run build` passes.
- `npm run db:reset && npm run db:types` produces a `database.types.ts` byte-identical (modulo timestamps in any header) to the committed file — verified locally by re-running and checking `git diff src/lib/database.types.ts` is empty.

#### Manual Verification:

- `import { applicationCreateSchema } from '@/lib/validation/applications'` in a scratch script and call `applicationCreateSchema.parse({ source: 'https://linkedin.com/...', status: 'Interesujące' })`. Expect success and inferred type populated.
- Same call with `status: 'Rejected'` — expect a Zod validation error mentioning the allowed enum.
- Same call missing `source` — expect a Zod error on the `source` field.
- Confirm `npm run db:types` regenerates the file without errors against a freshly reset local DB.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the Zod schemas have been smoke-tested against the local DB before proceeding to Phase 3.

**Post-implementation addendum (2026-05-28)**: This project has no local Docker Supabase stack — development runs against the hosted Supabase Postgres project via `supabase link`. The `db:types` script therefore shipped as `supabase gen types typescript --linked > src/lib/database.types.ts` (not `--local` as written above). Success criterion 2.4's byte-identical-after-`db:reset` check is infeasible with this workflow and is interpreted as "rerunning `npm run db:types` against the linked project produces no diff" — i.e., the committed types match what the linked project currently exposes. Manual Verification step "freshly reset local DB" is similarly read as "against the linked project". If a local Docker stack is ever introduced, revisit the script (and this addendum) to switch back to `--local`.

---

## Phase 3: CI gate — typecheck step

### Overview

Extend `.github/workflows/ci.yml` so the type contract between the committed `database.types.ts` and its consumers (`src/lib/validation/applications.ts` and onward) is enforced on every PR. Single change: a `typecheck` step in the existing `ci` job that runs after `npx astro sync` and before `npm run lint`.

**Revision note**: An earlier version of this plan also proposed a parallel `db-lint` job running `supabase db lint`. During implementation we confirmed the Supabase CLI 2.101.0's `db lint` requires a live DB connection (`--linked`, `--local`, or `--db-url`) — it does not statically lint migration files. The two viable shapes for running it in CI both have downsides outweighing the marginal value here: booting Docker per PR adds 30–60s and a Docker-capable runner requirement, and linting against the hosted Supabase project introduces a new CI secret plus a hard dependency on the project not being auto-paused. For F-01's small, frozen foundation migration whose trickiest part (the SECURITY DEFINER trigger function) was already verified manually in Phase 1, the cost did not justify the gain. `astro check` against the committed types remains the load-bearing CI gate; type drift is the most likely silent failure mode. If migration linting is wanted later, `squawk` against the raw SQL file (no DB connection, ~5s) is a better fit than `supabase db lint` for this workflow and can be added in a future change.

### Changes Required:

#### 1. Typecheck step in existing `ci` job

**File**: `.github/workflows/ci.yml`

**Intent**: Add `npm run typecheck` as an explicit step in the existing `ci` job. Build implicitly type-checks today, but `astro check` surfaces a cleaner failure and catches drift between `database.types.ts` and consumers earlier.

**Contract**: New step inserted between line 19 (`npx astro sync`) and line 20 (`npm run lint`): `- run: npm run typecheck`. The env block on the build step is unchanged. No new jobs.

### Success Criteria:

#### Automated Verification:

- Push the branch; the `ci` job runs.
- `npm run typecheck` step appears in the `ci` job's run log and passes.
- Overall PR check status is green.

#### Manual Verification:

- Introduce a deliberate type error in a scratch branch (e.g., rename a column in `database.types.ts` so the Zod module's inferred type no longer matches a downstream usage — or, simpler, mistype an identifier in `src/lib/validation/applications.ts`); push; confirm CI fails on the `typecheck` step specifically.
- Revert and confirm CI returns to green.

**Dormant-gate note**: During Phase 3 implementation we confirmed empirically that renaming a column in the committed `src/lib/database.types.ts` does NOT fail `npm run typecheck` today, because nothing in `src/` currently imports those generated types — Phase 2's Zod module only imports `z`. The typecheck gate is therefore **dormant for `database.types.ts` drift in F-01** and becomes load-bearing the moment S-02 lands an endpoint that imports `Database['public']['Tables']['applications']['Row']` (or similar). Within F-01 the gate is still useful: any type error inside `src/lib/validation/applications.ts` or other `src/` files is caught.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that CI is green on the foundation branch before considering F-01 complete and unlocking S-01.

---

## Testing Strategy

### Unit Tests:

None added in F-01. Zod schemas are type-checked at compile time; runtime behavior is exercised by the manual smoke test in Phase 2's runbook. The first real unit test surface arrives with S-02 (parser fallback paths benefit from explicit tests).

### Integration Tests:

None added in F-01. RLS and trigger correctness are verified via the Phase 1 manual runbook against a local Supabase Docker instance. The decision tree: adding pgTAP or Vitest+Docker adds 1-2 days of CI plumbing for a foundation that, once verified, does not change again until a future migration. Re-execute the runbook when a future migration touches RLS or triggers.

### Manual Testing Steps:

Phase 1 runbook (RLS isolation + trigger correctness) and Phase 2 runbook (Zod smoke test) are the testing surface for this slice. Both are listed in their respective "Manual Verification" sections above.

## Performance Considerations

- Partial indexes on `applications(user_id, status) where archived_at is null` and `applications(user_id, archived_at) where archived_at is not null` keep the board read (S-01) and archive read (S-11) on covering indexes.
- RLS adds a `user_id = auth.uid()` predicate to every query — Postgres folds it into the WHERE clause; with the user_id index, the cost is negligible at MVP scale.
- `application_notes(application_id, created_at desc)` index supports the FR-014 reverse-chronological history read in O(log N).

## Migration Notes

- This is the first migration in the repository. `supabase/migrations/` does not exist yet — `supabase migration new applications_schema` creates the folder and the timestamped file in one shot.
- `supabase/config.toml:58` currently has `schema_paths = []`. After Phase 1, it becomes `schema_paths = ["./migrations/*.sql"]`. `db reset` and `db lint` use this path.
- No rollback migration is written. Forward-only is the Supabase convention for greenfield work; a problem with this migration is fixed by a follow-up migration, not a down-migration.

## References

- Roadmap: `context/foundation/roadmap.md` (F-01 row at line 34; full block at lines 72-83)
- PRD: `context/foundation/prd.md` (Business Logic at lines 148-164; FR-003 at line 100; FR-013/014 at lines 136-138)
- Supabase wiring: `src/lib/supabase.ts:5-23`
- Auth middleware: `src/middleware.ts:6-25`
- Existing config: `supabase/config.toml:53-58`
- CI baseline: `.github/workflows/ci.yml:1-24`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema migration with RLS and triggers

#### Automated

- [x] 1.1 `supabase db reset` applies the migration without errors — 1557cb1
- [x] 1.2 `supabase db lint` reports no errors against the migration — 1557cb1
- [x] 1.3 `npm run lint` and `npm run build` continue to pass — 1557cb1

#### Manual

- [x] 1.4 Supabase Studio shows both tables with all columns, constraints, and RLS enabled — 1557cb1
- [x] 1.5 Two-user RLS isolation verified (user B sees zero of user A's rows) — 1557cb1
- [x] 1.6 `last_action_at` equals `created_at` on insert — 1557cb1
- [x] 1.7 Non-status field edit does NOT change `last_action_at` — 1557cb1
- [x] 1.8 Status change DOES advance `last_action_at` — 1557cb1
- [x] 1.9 Note insert advances parent `last_action_at` — 1557cb1
- [x] 1.10 Cross-user note insert rejected by RLS — 1557cb1

### Phase 2: Generated types, Zod write-shapes, npm scripts

#### Automated

- [x] 2.1 `npm run typecheck` passes — 65c7f3a
- [x] 2.2 `npm run lint` passes — 65c7f3a
- [x] 2.3 `npm run build` passes — 65c7f3a
- [x] 2.4 `npm run db:reset && npm run db:types` produces a byte-identical `database.types.ts` — 65c7f3a

#### Manual

- [x] 2.5 `applicationCreateSchema.parse(...)` succeeds on a valid payload — 65c7f3a
- [x] 2.6 Invalid status enum rejected with a clear Zod error — 65c7f3a
- [x] 2.7 Missing `source` rejected with a clear Zod error — 65c7f3a
- [x] 2.8 `npm run db:types` regenerates cleanly against a freshly reset local DB — 65c7f3a

### Phase 3: CI gate — typecheck step

#### Automated

- [x] 3.1 `npm run typecheck` step appears in the `ci` job's run log and passes — f1cf35b
- [x] 3.2 Overall PR check status is green — f1cf35b

#### Manual

- [x] 3.3 Deliberate type error in a scratch branch fails CI on the `typecheck` step — f1cf35b
- [x] 3.4 Revert returns CI to green — f1cf35b
