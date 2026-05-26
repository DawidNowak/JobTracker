# Applications Schema and RLS Foundation (F-01) — Plan Brief

> Full plan: `context/changes/applications-schema-and-rls/plan.md`

## What & Why

Land the data contract every JobTracker MVP slice (S-01 through S-11) consumes: `applications` and `application_notes` tables with per-user RLS, DB-enforced `last_action_at` semantics, generated TS types, and a Zod write-shape module. Per-user data isolation is an incident-class guardrail in the PRD, so RLS lands with the schema, not as a follow-on hardening pass. The `last_action_at` invariant is enforced in the database (not the API) so a future endpoint cannot silently break the follow-up timing rules in S-07/S-08/S-09.

## Starting Point

Supabase is wired (`src/lib/supabase.ts:9` SSR client, `src/middleware.ts:13` exposes `locals.user`) but the database has no schema (`supabase/config.toml:58` has `schema_paths = []`, no migrations folder). The Supabase CLI is installed as a dev dep. Auth uses Supabase email+password; `auth.uid()` is resolved on every request and works for RLS today. No Zod, no generated DB types, no test framework, no domain endpoints.

## Desired End State

A developer runs `npm run db:reset` and gets a local Supabase instance with both tables, RLS, and triggers in place. `src/lib/database.types.ts` is committed and reflects the migration. `src/lib/validation/applications.ts` exports Zod schemas ready for S-02's first endpoint. CI runs `supabase db lint` + `astro check` on every PR. S-01 can now write its empty-board read query against a typed, isolated, performant schema.

## Key Decisions Made

| Decision                         | Choice                                                                                | Why                                                                                                                          | Source |
| -------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| Skills column                    | Omitted; absorbed into `description`                                                  | No querying or filtering on skills planned; one less column is one less invariant.                                           | Plan   |
| Salary representation            | Single free-form `text` column                                                        | No filtering or aggregation; parser output goes in verbatim.                                                                 | Plan   |
| `work_mode` storage              | `text` + CHECK constraint (`Zdalna`, `Hybrydowa`, `Stacjonarna`)                      | Strict at write time, refactorable without `ALTER TYPE` pain.                                                                | Plan   |
| `status` storage                 | `text` + CHECK (`Interesujące`, `Zaaplikowano`, `Rozmowa`)                            | Same convention as `work_mode`. Polish values stored verbatim — UI is a passthrough.                                          | Plan   |
| Archive representation           | Nullable `archived_at timestamptz` column; status enum stays 3-value                  | Preserves the active column at time of archive; clean read predicates; matches FR-017's read-only archive contract.          | Plan   |
| Note → parent timestamp update    | `SECURITY DEFINER` function owned by `postgres`, called from AFTER INSERT trigger      | Trigger must update parent row across RLS; SECURITY DEFINER is the standard pattern. RLS still gates the note insert itself. | Plan   |
| Zod placement                    | Ship in F-01 as `src/lib/validation/applications.ts`; no consumers until S-02         | Roadmap F-01 outcome names Zod schemas as part of the foundation; S-02 imports rather than defines.                          | Roadmap |
| Verification                     | Lightweight: `db reset` + committed types + manual RLS/trigger runbook                 | Foundation correctness is verified once; no pgTAP/Vitest+Docker scope inflation inside the 4-week MVP budget.                | Plan   |
| CI additions                     | `db lint` job + `astro check` typecheck step                                          | Cheap static gates that catch real failure modes (malformed SQL, type drift) without booting a real DB in CI.                 | Plan   |

## Scope

**In scope:**
- Single SQL migration creating both tables with all columns, CHECK constraints, indexes
- RLS enabled with four policies per table scoping to `auth.uid()`
- SECURITY DEFINER trigger function + BEFORE UPDATE trigger on applications + AFTER INSERT trigger on application_notes
- `supabase/config.toml` migrations folder wiring
- Generated `src/lib/database.types.ts` committed
- `src/lib/validation/applications.ts` with three Zod schemas
- `db:reset`, `db:types`, `typecheck` npm scripts
- `zod` dependency added
- `.github/workflows/ci.yml` extended with `db-lint` job and typecheck step
- Manual verification runbook in plan

**Out of scope:**
- Any API endpoint (all S-02+)
- Any UI (all S-01+)
- pgTAP, Vitest, Playwright, or any test framework
- CI drift check that boots a real Supabase instance
- Service role key usage anywhere in the app
- Rollback migrations

## Architecture / Approach

```
┌──────────────────────────────────────────────────────────────┐
│  public.applications                                         │
│  ─ id, user_id (→ auth.users), source*, position, company,   │
│    description, salary, work_mode (CHECK PL), recruiter_     │
│    contact, status (CHECK PL, default 'Interesujące'),       │
│    created_at, last_action_at, archived_at                   │
│  ─ RLS: user_id = auth.uid() (SELECT/INSERT/UPDATE/DELETE)   │
│  ─ Trigger BEFORE UPDATE: bumps last_action_at iff status    │
│    IS DISTINCT FROM old.status                               │
└──────────────────────────────────────────────────────────────┘
                          ▲
                          │ AFTER INSERT trigger calls
                          │ bump_application_last_action_at(app_id)
                          │ (SECURITY DEFINER, search_path = '')
                          │
┌──────────────────────────────────────────────────────────────┐
│  public.application_notes                                    │
│  ─ id, application_id (→ applications), user_id, body*,      │
│    created_at                                                │
│  ─ RLS: user_id = auth.uid() (SELECT/INSERT/UPDATE/DELETE)   │
└──────────────────────────────────────────────────────────────┘

App layer (this slice ships, S-02+ consumes):
  src/lib/database.types.ts     ← generated
  src/lib/validation/applications.ts
    ├─ applicationCreateSchema       (S-02 imports)
    ├─ applicationUpdateSchema       (S-03, S-05 import)
    └─ applicationNoteCreateSchema   (S-06 imports)
```

## Phases at a Glance

| Phase                                                        | What it delivers                                                              | Key risk                                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Schema migration with RLS and triggers                    | Tables, constraints, RLS, SECURITY DEFINER function, two triggers, config.toml | Trigger / RLS interaction wrong → silently broken `last_action_at` for note inserts   |
| 2. Generated types, Zod write-shapes, npm scripts            | `database.types.ts`, Zod module, `db:reset` / `db:types` / `typecheck` scripts | Generated types drift from migration silently — closed by Phase 3 CI typecheck        |
| 3. CI gate — `supabase db lint` job + typecheck step         | New CI job + step that prevent broken migrations from merging                  | `supabase/setup-cli` action or CLI invocation differences across runners              |

**Prerequisites:** Supabase CLI on the developer's machine (Docker required for `supabase start`); foundation auth (already in baseline).
**Estimated effort:** ~1 focused session (3-5 hours) across the three phases. Phase 1 is the bulk; Phases 2 and 3 are mechanical.

## Open Risks & Assumptions

- Assumes Polish diacritic literals in CHECK constraints and SECURITY DEFINER trigger function interact cleanly with `supabase gen types typescript` — string literal unions in TS support arbitrary unicode, but verifying the generated output matches the expected union is part of Phase 2's automated verification.
- Assumes `supabase db lint` runs offline (static analysis) and does not require a real database in CI. The implementer should confirm this against the current CLI version (`2.101.0`) during Phase 3.
- Assumes future migrations (S-10 archive flow, any later columns) will follow the same pattern. If a v2 OAuth migration changes how `auth.uid()` resolves, RLS remains correct because the policy is provider-agnostic.

## Success Criteria (Summary)

- A signed-in user can only see, modify, and delete their own applications and notes — verified by the two-user runbook in Phase 1.
- `last_action_at` advances only on status change or note insert; non-status edits leave it untouched — verified by the runbook.
- S-02 can `import { applicationCreateSchema } from '@/lib/validation/applications'` and validate a POST body without writing any schema code locally.
- Every future PR runs `supabase db lint` + `astro check` and fails fast on schema or type errors.
