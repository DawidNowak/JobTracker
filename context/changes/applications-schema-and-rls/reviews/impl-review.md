<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Applications Schema and RLS Foundation (F-01)

- **Plan**: context/changes/applications-schema-and-rls/plan.md
- **Scope**: All 3 phases
- **Date**: 2026-05-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 3 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated success criteria re-verified: `npm run lint`, `npm run typecheck`, `npm run build` all green at HEAD.

## Findings

### F1 — Unplanned hardening migration closes a real RLS hole

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline / Plan Adherence
- **Location**: supabase/migrations/20260526132205_harden_application_notes_rls.sql
- **Detail**: A second migration not in the plan tightens the `application_notes` INSERT/UPDATE policies with an EXISTS check confirming the referenced application belongs to `auth.uid()`. The original RLS only required `note.user_id = auth.uid()`, so user B could insert a note owned by themselves but pointed at user A's application — a real cross-user write leak. The EXISTS subquery is correct and the fix is sound; the issue is that the plan's RLS design (Phase 1) shipped vulnerable, and this fix isn't reflected in plan.md or change.md.
- **Fix A ⭐ Recommended**: Document in plan.md as an addendum
  - Strength: Preserves the deployed fix; updates source of truth so future reviewers see the corrected RLS shape.
  - Tradeoff: Plan record grows; minor maintenance.
  - Confidence: HIGH — same pattern (epilogue, revision note) already used in Phase 3 of this very plan.
  - Blind spot: None significant.
- **Fix B**: Roll the second migration into a fixed first migration
  - Strength: Single clean foundation migration; cleaner history.
  - Tradeoff: Rewriting deployed migration history is destructive and breaks the forward-only convention the plan explicitly committed to (line 285).
  - Confidence: LOW — violates stated convention.
  - Blind spot: Other devs may have already applied locally.
- **Decision**: FIXED via Fix A (addendum appended to plan.md Phase 1)

### F2 — db:types script uses --linked instead of planned --local

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: package.json:16
- **Detail**: Plan (Phase 2.1) specified `supabase gen types typescript --local`. Actual script uses `--linked`. Functional difference: `--local` generates from the local Docker DB (always reflects committed migrations after `db reset`); `--linked` generates from the hosted Supabase project (reflects whatever has been pushed there, possibly drifted). A dev running `npm run db:types` without Docker but with `supabase link` set will silently overwrite database.types.ts with a remote schema, undermining the byte-identical check in Phase 2 success criterion 2.4.
- **Fix A ⭐ Recommended**: Revert script to --local
  - Strength: Matches plan; local is the authoritative source for committed-migration state.
  - Tradeoff: Requires Docker running to regenerate types.
  - Confidence: HIGH — plan rationale tied to local DB state (success criterion 2.4).
  - Blind spot: Implementer may have had a specific reason for --linked that isn't recorded.
- **Fix B**: Keep --linked and update plan to reflect it
  - Strength: No code churn.
  - Tradeoff: Bakes in drift risk; types reflect whatever hosted project is linked.
  - Confidence: MEDIUM — depends on team's hosted-vs-local workflow.
  - Blind spot: Unknown whether anyone uses --linked deliberately.
- **Decision**: FIXED via Fix B (plan amended with Phase 2 addendum — project has no local Docker DB, --linked is correct for this workflow)

### F3 — Trigger functions missing `set search_path = ''`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260526123145_applications_schema.sql:108, 144
- **Detail**: `applications_bump_last_action_at_on_status_change()` (line 108) and `application_notes_bump_parent_trigger()` (line 144) are both SECURITY INVOKER plpgsql functions that do not lock search_path. The SECURITY DEFINER function `bump_application_last_action_at` (line 128) correctly sets `search_path = ''` — but Supabase's `db lint` rule `function_search_path_mutable` flags ALL plpgsql functions, not just SECURITY DEFINER. Plan's Critical Detail (line 54) called out search_path as load-bearing for the SECURITY DEFINER function specifically; the two helper trigger functions were omitted. Privilege risk is low (SECURITY INVOKER), but the Phase 1 `supabase db lint` criterion only reports clean if those rules are tolerated.
- **Fix**: Add `set search_path = ''` to both trigger function definitions. Neither references any tables (the first only sets NEW; the second calls a fully qualified function), so no qualification changes are needed — just the SET clause.
- **Decision**: FIXED — follow-up migration `supabase/migrations/20260528153903_lock_trigger_function_search_path.sql` `create or replace`s both functions with the SET clause; plan amended with addendum.

### F4 — database.types.ts types status/work_mode as plain string

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Plan Adherence
- **Location**: src/lib/database.types.ts
- **Detail**: Plan (Phase 2.2) expected status/work_mode to appear as string literal unions matching the CHECK constraints. Supabase CLI does not infer literal unions from CHECK constraints (only from real enum types). Type-level enforcement of allowed values is provided instead by the Zod schemas in src/lib/validation/applications.ts (where `ApplicationStatus` and `WorkMode` are exported as inferred unions). Acceptable — the plan's expectation was incorrect about CLI behavior, and the Zod layer compensates.
- **Fix**: None required. Optionally amend plan to note this CLI limit.
- **Decision**: SKIPPED

### F5 — CI typecheck step doesn't receive SUPABASE_URL/KEY env vars

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml:20
- **Detail**: The new `npm run typecheck` step doesn't get the env block that `npm run build` does (SUPABASE_URL, SUPABASE_KEY). Currently safe because `src/lib/supabase.ts` treats env vars as optional, but if `astro:env/server` schema later marks them required, typecheck will fail in CI while build is fine.
- **Fix**: Optional — copy the build step's env block onto the typecheck step.
- **Decision**: SKIPPED — YAGNI; fix only if env schema becomes strict later.

### F6 — applications_user_id_idx likely redundant

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Performance
- **Location**: supabase/migrations/20260526123145_applications_schema.sql
- **Detail**: Plain `(user_id)` index is largely covered by the two partials `(user_id, status) WHERE archived_at IS NULL` and `(user_id, archived_at) WHERE archived_at IS NOT NULL`. At MVP scale the wasted write cost is negligible; flagging for a future tuning pass, not for action now.
- **Fix**: None — defer to a later index audit.
- **Decision**: FIXED — follow-up migration `supabase/migrations/20260528154840_drop_redundant_user_id_index.sql` drops the plain index. Partials cover all current read patterns; re-add if a future unfiltered-by-archive query lands.
