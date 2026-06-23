# Quality Gate Wiring Implementation Plan

## Overview

Phase 4 (final) of the test rollout in `context/foundation/test-plan.md`. Phases 1–3
built a working Vitest suite (two pools: `node` + `workers`), Supabase-local integration
tests, HTTP smoke tests, and parser fixture tests. **This phase adds no test logic** — it
locks the floor by running the existing `npm test` as a **required CI gate** on push/PR,
against a local Supabase stack booted in CI, with **no coverage threshold** (per §7).

## Current State Analysis

- **CI today** (`.github/workflows/ci.yml`): one `ci` job on `ubuntu-latest` running
  `npm ci → astro sync → typecheck → lint → build`. The `build` step reads the *remote*
  project's `secrets.SUPABASE_URL` / `secrets.SUPABASE_KEY`. There is no test step.
- **Test suite runtime needs** (heavier than the current job):
  - A **local Supabase stack** — `npx supabase start` boots Postgres + Auth + PostgREST and
    applies `supabase/migrations/` (`supabase` is a devDependency, `2.101.0`).
  - A populated **`.env.test`** with `SUPABASE_URL`, `SUPABASE_KEY`,
    `SUPABASE_SERVICE_ROLE_KEY`. `tests/setup.ts:23` *hard-refuses* to run unless
    `SUPABASE_URL` starts with `http://127.0.0.1:54321` or `http://localhost:54321`.
  - A spawned **`astro dev`** for the HTTP smoke suite — handled inside the run by
    `tests/global-setup.ts` (swaps `.dev.vars` → local stack, spawns dev server on a free
    port, 60s cold-compile timeout, restores `.dev.vars` on teardown).
  - The **workers pool** (`@cloudflare/vitest-pool-workers`) reads `wrangler.test.jsonc`.
- **Local stack keys are deterministic.** `supabase start` issues the well-known local demo
  anon/service-role JWTs (identical on every machine), so they are **not secrets**. The CLI
  emits them via `supabase status -o env --override-name …` — confirmed available on the
  installed CLI (`--output -o` supports `env`; `--override-name` remaps variable names).
- **"Required" is a repo setting**, not YAML. A GitHub branch-protection rule must list the
  job's check name as required to actually block merges.

## Desired End State

A second `test` job runs in `.github/workflows/ci.yml` on every push to `master` and every
PR to `master`. It boots local Supabase, generates `.env.test` from the CLI, and runs
`npm test` (both pools, green). The job's check is listed as **required** in branch
protection so a red suite blocks merge. `test-plan.md` §3/§5 reflect the wired gate, the
CI flow is documented for contributors, and the deferred parser-HTML-drift canary is
recorded as a scoped follow-up — not built here.

**Verification:** open a throwaway PR with a deliberately failing assertion → the `test`
check goes red and merge is blocked; revert → green and mergeable. `gh run view` shows the
`test` job booting Supabase and running both pools.

### Key Discoveries:

- `tests/setup.ts:18-25` — localhost guard means CI **must** point `.env.test` at the local
  stack; pointing at the remote project would (correctly) throw.
- `tests/global-setup.ts:96-101` — `npm test` itself spawns/kills `astro dev`; CI needs no
  separate dev-server step, only Supabase up + `.env.test` present.
- `supabase status -o env --override-name api.url=SUPABASE_URL …` maps stack values straight
  into the suite's variable names — **no GitHub secrets** for the test stack.
- §7 of `test-plan.md` forbids coverage thresholds and a workerd-divergence gate; the
  `@vitest/coverage-v8` dep stays unused by the gate.
- `ubuntu-latest` GitHub runners ship Docker preinstalled — `supabase start` works without a
  service-container hack.

## What We're NOT Doing

- **No coverage threshold / gate** (§7). `npm test` runs as-is.
- **No workerd-divergence gate** (§7) — `wrangler dev` stays an operational mitigation.
- **No new test files or assertions** — Phase 4 wires existing tests only.
- **Not building the parser-HTML-drift canary** — deferred to its own change (documented).
- **Not changing the existing `build` job's remote secrets** — those stay for the build.
- **Not introducing a bare-Postgres service container** — the suite needs Auth + PostgREST.
- **Not configuring a merge queue / `merge_group` trigger** — none exists today.

## Implementation Approach

Add the gate as a **separate `test` job** parallel to the existing `ci` job so
lint/typecheck/build keep fast-failing while the heavier Supabase job runs independently and
exposes a single, stable check name for branch protection. Provision the stack with the
already-vendored Supabase CLI and derive keys at runtime (zero secret management). Keep the
two jobs' triggers identical (push to `master` + PR to `master`) so `master` stays provably
green. Enforcement (branch protection) is an outward-facing repo-settings change, so the plan
hands you the exact `gh` command to run rather than applying it automatically.

## Critical Implementation Details

- **`.env.test` must exist before `npm test`, and before `astro dev` spawns.** The job step
  order is: `supabase start` → write `.env.test` → `npm test`. `global-setup.ts` reads
  `.env.test` via dotenv at run start; if it's missing or points off-localhost the run aborts
  in `tests/setup.ts`. Confirm the three `--override-name` source keys against the installed
  CLI's default `supabase status -o env` output (expected `api.url`, `auth.anon_key`,
  `auth.service_role_key`) and map to `SUPABASE_URL` / `SUPABASE_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`.
- **`astro dev` cold compile in CI.** The suite's 60s readiness timeout
  (`tests/global-setup.ts`) was tuned for Windows first-compile; Linux CI is typically
  faster, but the first compile after a clean `npm ci` can still be slow — do not lower it.
- **`npx supabase start` is the long pole** (Docker image pull + boot, ~1–3 min). Treat the
  Supabase CLI/Docker layer as the cacheable surface; keep `npm ci` cached via
  `actions/setup-node` as the existing job does.

## Phase 1: Wire the test job into CI

### Overview

Add a `test` job to `.github/workflows/ci.yml` that boots local Supabase, generates
`.env.test` from the CLI, and runs `npm test` green. Existing `ci` job untouched.

### Changes Required:

#### 1. New `test` job in the CI workflow

**File**: `.github/workflows/ci.yml`

**Intent**: Add a second job, parallel to `ci`, that provisions the local Supabase stack and
runs the full Vitest suite as a blocking check. Lint/typecheck/build stay in their own job
for fast feedback.

**Contract**: A new top-level job (suggested id `test`, so the check name is stable for
branch protection) on `runs-on: ubuntu-latest`, sharing the workflow's existing
`on: { push: branches:[master], pull_request: branches:[master] }` triggers. Step sequence:
- `actions/checkout@v4`
- `actions/setup-node@v4` with `node-version: 22`, `cache: npm` (mirror the `ci` job)
- `npm ci`
- `npx astro sync` (mirror `ci`; ensures `astro:env` types resolve)
- `npx supabase start` (boots Postgres + Auth + PostgREST, applies migrations)
- generate `.env.test` from the running stack (see change #2)
- `npm test`
- (optional, recommended) `npx supabase stop` in an `if: always()` step for hygiene

No secrets are referenced by this job — the test stack keys are derived at runtime.

#### 2. Generate `.env.test` from the running stack

**File**: `.github/workflows/ci.yml` (a `run:` step within the `test` job)

**Intent**: Produce the three-variable `.env.test` the suite requires from the live local
stack, so the localhost guard in `tests/setup.ts` passes and no secrets are stored.

**Contract**: A step that redirects CLI output into `.env.test`, remapping the stack's env
names to the suite's:

```bash
npx supabase status -o env \
  --override-name api.url=SUPABASE_URL \
  --override-name auth.anon_key=SUPABASE_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  > .env.test
```

Confirm the three left-hand source keys against the installed CLI's default
`supabase status -o env` output before committing; adjust if the CLI names differ. The
resulting `SUPABASE_URL` must start with `http://127.0.0.1:54321` (CLI default) to satisfy
`tests/setup.ts`.

### Success Criteria:

#### Automated Verification:

- Workflow YAML is valid: `npx prettier --check .github/workflows/ci.yml` (or `gh workflow view`)
- The `test` job appears in the run: `gh run view <run-id>` lists a `test` job
- Local stack boots in CI: the `supabase start` step exits 0
- Full suite passes in CI: the `npm test` step exits 0 (both `node` and `workers` pools)
- Existing `ci` job still passes (typecheck/lint/build unchanged)
- Locally, the suite still passes against a developer's running stack: `npm test`

#### Manual Verification:

- A push/PR triggers both `ci` and `test` jobs in parallel
- `test` job logs show Supabase booting, `.env.test` generated, both pools running
- Total `test` job wall time is acceptable (Supabase cold start + suite)
- No secret values are printed in logs (keys are local demo keys, but confirm no leakage)

**Implementation Note**: After this phase and all automated verification passes, pause for
manual confirmation that a real CI run is green before proceeding to Phase 2.

---

## Phase 2: Enforce as required gate + close out docs

### Overview

Make the gate blocking via branch protection (you run the command), then reconcile the
rollout docs and record the deferred canary as a scoped follow-up.

### Changes Required:

#### 1. Branch-protection command (you run it)

**File**: documented in the plan / `change.md` epilogue — no tracked-file change required

**Intent**: Add the `test` job's check to `master` branch protection so a red suite blocks
merge. This is an outward-facing repo-settings change, performed by the repo admin.

**Contract**: Provide the exact `gh api` invocation that adds `test` (and keeps the existing
`ci` check) to the required status checks for `master`, e.g.:

```bash
gh api -X PUT repos/DawidNowak/JobTracker/branches/master/protection/required_status_checks \
  -f strict=true -f 'checks[][context]=test' -f 'checks[][context]=ci'
```

Confirm exact check/context names from a real run (`gh run view`) before applying; the
context name is the job id/name GitHub reports. Surface that branch protection requires admin
rights and is reversible via the GitHub UI.

#### 2. Update the rollout doc gate/status rows

**File**: `context/foundation/test-plan.md`

**Intent**: Reflect that Phase 4 is wired — flip §3 Phase 4 status and the §5 gate rows that
read "required after §3 Phase 4" / "CI enforcement lands with §3 Phase 4" to enforced, and
bump the header "Last updated" line.

**Contract**: §3 table Phase 4 `Status` → `complete` (or `implementing` until branch
protection is applied — keep consistent with the §3 status vocabulary). §5 rows for
"unit + integration", "Parser HTML fixture suite", and the RLS row updated to reflect the
now-wired CI gate. §8 freshness note optional.

#### 3. Document the CI test flow for contributors

**File**: `tests/README.md` (and a one-line pointer in `AGENTS.md` if warranted)

**Intent**: Tell contributors the suite now runs in CI and how the stack is provisioned, so a
red `test` check is self-explanatory.

**Contract**: A short "CI" subsection in `tests/README.md`: the `test` job boots local
Supabase via the CLI, derives `.env.test` at runtime (no secrets), runs `npm test`; the check
is required on PRs to `master`.

#### 4. Record the deferred parser-HTML-drift canary

**File**: `context/changes/testing-quality-gate-wiring/change.md` (Notes) or a short
`follow-up.md` in the change folder

**Intent**: Capture the canary as a scoped future change so the deferral is deliberate, not
forgotten — covering Risk #1's slow-burn portal-drift class.

**Contract**: A few lines naming: trigger (scheduled cron), action (fetch live LinkedIn/JJIT
HTML, run parser, diff against fixture-derived expectations), open design questions (rate
limits/ToS, alerting, flakiness isolation from the blocking gate), and a pointer that it
should open via `/10x-new` as its own change.

### Success Criteria:

#### Automated Verification:

- Docs render / lint clean: `npx prettier --check context/foundation/test-plan.md tests/README.md`
- `test-plan.md` §3 Phase 4 status no longer reads `change opened`
- A PR with a failing test shows the `test` check as **required** and **failing** (blocks merge)

#### Manual Verification:

- Branch-protection command applied; a deliberately-red PR cannot be merged
- Reverting the failure turns the check green and unblocks merge
- `tests/README.md` CI section accurately describes the job
- Deferred-canary follow-up is recorded and discoverable

**Implementation Note**: Branch protection is applied by the user, not the agent. After docs
land and the user confirms the required check blocks a red PR, the phase (and rollout) is
complete.

---

## Testing Strategy

This phase ships no new test code; "testing" here = proving the gate behaves.

### Manual Testing Steps:

1. Open a PR that adds a deliberately failing assertion to an existing test → confirm the
   `test` check runs, goes red, and (after branch protection) blocks merge.
2. Revert the failing assertion → confirm the check goes green and merge is unblocked.
3. Inspect `gh run view` logs → confirm Supabase boots, `.env.test` is generated, both pools
   run, and no secret leakage.
4. Confirm the existing `ci` job (typecheck/lint/build) still runs and passes independently.

## Performance Considerations

- `supabase start` (Docker pull + boot) is the long pole (~1–3 min) plus `astro dev` cold
  compile (≤60s). Keep `npm ci` cached via `actions/setup-node`. Running tests on both
  push and PR doubles Supabase spin-ups for a merged PR — accepted for a provably-green
  `master` (decided during planning).

## Migration Notes

None — additive CI change. Rollback = revert the workflow edit and remove the `test` check
from branch protection (GitHub UI or `gh api`).

## References

- Test rollout strategy: `context/foundation/test-plan.md` (§3 Phase 4, §5, §7)
- Change identity: `context/changes/testing-quality-gate-wiring/change.md`
- Existing CI: `.github/workflows/ci.yml`
- Run lifecycle / dev-server spawn: `tests/global-setup.ts`
- Localhost guard: `tests/setup.ts:18-25`
- Two-pool Vitest config: `vitest.config.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Wire the test job into CI

#### Automated

- [x] 1.1 Workflow YAML is valid (prettier --check / gh workflow view)
- [ ] 1.2 The `test` job appears in the run (gh run view)
- [ ] 1.3 Local stack boots in CI (supabase start exits 0)
- [ ] 1.4 Full suite passes in CI (npm test, both pools, exits 0)
- [ ] 1.5 Existing `ci` job still passes (typecheck/lint/build unchanged)
- [x] 1.6 Suite still passes locally (npm test)

#### Manual

- [ ] 1.7 Push/PR triggers both `ci` and `test` jobs in parallel
- [ ] 1.8 `test` logs show Supabase boot, `.env.test` generated, both pools running
- [ ] 1.9 `test` job wall time acceptable
- [ ] 1.10 No secret leakage in logs

### Phase 2: Enforce as required gate + close out docs

#### Automated

- [ ] 2.1 Docs lint clean (prettier --check)
- [ ] 2.2 test-plan.md §3 Phase 4 status updated (no longer `change opened`)
- [ ] 2.3 A failing-test PR shows the `test` check as required and failing

#### Manual

- [ ] 2.4 Branch-protection command applied; red PR cannot merge
- [ ] 2.5 Reverting the failure turns the check green and unblocks merge
- [ ] 2.6 tests/README.md CI section accurate
- [ ] 2.7 Deferred-canary follow-up recorded and discoverable
