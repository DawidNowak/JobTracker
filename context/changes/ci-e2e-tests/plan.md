# E2E as a PR-Pipeline Quality Gate — Implementation Plan

## Overview

Promote the existing local-only Playwright E2E suite (`tests/e2e/`) to a **required** CI status check on `master`. The suite covers rendered-UI interaction risks from the S-07+ flag slices (decision prompts, follow-up flags, reject/delete flows) that no cheaper integration/HTTP test reaches, but today it only runs when someone remembers to type `npm run test:e2e` locally — so those risks reach merge unverified. This plan stands up a separate `e2e` CI job cloned from the proven `test` job, reconciles the several docs that currently assert "E2E is not a gate," and verifies stability before flipping branch protection to required.

## Current State Analysis

- **CI today** (`.github/workflows/ci.yml`) has two jobs: `ci` (lint/typecheck/build) and `test` (Vitest against an in-job Supabase stack). Both trigger on `push` to `master` and `pull_request` targeting `master`. `test` is the only test gate.
- **The `test` job is a working template** for everything the E2E job needs: `actions/checkout@v4` → `actions/setup-node@v4` (node 22, `cache: npm`) → `npm ci` → `npx astro sync` → `npx supabase start` → derive `.env.test` via `npx supabase status -o env --override-name …` → run → `npx supabase stop` with `if: always()`. No GitHub secrets are needed — the local stack issues deterministic demo JWTs.
- **The E2E harness is CI-clean by construction.** `scripts/e2e-webserver.ts` reads `.env.test` (`SUPABASE_URL`/`SUPABASE_KEY`), refuses any non-local URL, backs up `.dev.vars` (recording `__ABSENT__` when the file doesn't exist — the CI case) and spawns `astro dev` on port `4331`/`127.0.0.1`; `tests/e2e/global-teardown.ts` authoritatively restores `.dev.vars` afterward. `playwright.config.ts`'s `webServer` invokes that wrapper with a 120s cold-compile timeout.
- **Anti-flake design already in place.** `playwright.config.ts` sets `retries: 0` deliberately; `tests/helpers/hydration.ts`'s `waitForBoardHydration` blocks on `data-board-hydrated="true"` before any interaction, and fixtures (`tests/e2e/fixtures.ts`) use per-test ephemeral users with cookie-injected auth (no UI sign-in). The config emits `trace: retain-on-failure` and `screenshot: only-on-failure`.
- **Dependencies present**: `@playwright/test ^1.61.1`, `supabase ^2.101.0` (both devDependencies). The only genuinely new CI step is installing the Chromium browser binary.
- **The unresolved risk** (frame Dim 2): the suite has **never run on ubuntu** — only on the author's Windows box, where the cold-compile timeout was raised 30s→60s→120s. Its CI stability is empirically unproven.
- **Docs contradict the target state.** `test-plan.md` §4 (line 97), §5 (row), §7, and §8 (lines 305-306), `tests/README.md:88-92,113`, `tests/e2e/AGENTS.md:1`, and `playwright.config.ts:11-15` all currently state E2E is explicitly _not_ a required CI gate ("dropped R2 stands").

## Desired End State

A new `e2e` job runs on every PR and push to `master`, executing the full Playwright suite on ubuntu against an in-job Supabase stack, uploading Playwright traces + screenshots as artifacts when a test fails. Once proven green across several runs, `e2e` is listed among `master`'s required status checks, so a red browser-level suite blocks merge exactly like `npm test` does. All project docs describe E2E as a required gate, with a §8 ledger entry recording the reversal. Verify by: opening a PR and seeing the `e2e` check run and gate; confirming a deliberately-broken spec reds the check; confirming the branch-protection settings list `e2e`.

### Key Discoveries:

- Clone target: `.github/workflows/ci.yml:27-48` (the `test` job) — same Supabase provisioning, swap `npm test` → `npm run test:e2e`.
- `.dev.vars` absence in CI is handled: `scripts/e2e-webserver.ts:88` records `__ABSENT__` and restores by deleting — no CI-specific harness change needed.
- Chromium install command: `npx playwright install --with-deps chromium`; cache path `~/.cache/ms-playwright`, keyed on the resolved `@playwright/test` version.
- Deterministic hydration gate (`tests/helpers/hydration.ts`) is what makes `retries: 0` viable in CI — do not add retries to "fix" a flake; root-cause it.
- GitHub only lets a check become "required" after it has run at least once, so the promotion step (Phase 3) is inherently sequenced after the job's first PR runs.

## What We're NOT Doing

- **Not** adding `retries` to the Playwright config or the CI job to mask flakiness — a flake is a bug to root-cause (project convention, `playwright.config.ts:11-15`).
- **Not** path-filtering the trigger — the job runs on every PR/push like `test` (a shared util/style change can break the board without touching `tests/e2e/`).
- **Not** running E2E inside the existing `test` job — they each spawn their own `astro dev` and must not run concurrently (`tests/README.md:109`); `e2e` is a separate parallel job.
- **Not** changing any spec, fixture, harness script, or `playwright.config.ts` behavior (only the config's stale _comment_ is edited in Phase 2).
- **Not** running a full `/10x-test-plan --refresh` — doc changes are targeted inline edits.
- **Not** adding new E2E test coverage — this change enforces the existing suite, it does not extend it.
- **Not** using the official Playwright container or sharding — unwarranted at ~10 specs.

## Implementation Approach

Clone the `test` job into a new `e2e` job, insert a Chromium cache-and-install step and a failure-artifact upload step, and swap the run command. Because the user chose to make the gate **required immediately**, the PR that introduces the job is itself the gate's first ubuntu exercise — its own `e2e` check must go green (across a few re-runs) before merge, which is the built-in stability proof. Docs are reconciled in the same change so the repo never contradicts itself. Promotion to a required check and the rollback note are the final, partly-manual phase.

## Critical Implementation Details

- **Timing & lifecycle**: A GitHub status check cannot be added to branch protection until GitHub has observed it run at least once. Therefore Phase 3's "mark required" step must follow the `e2e` job running on the PR — it cannot be done blind in the workflow file. This is why "required immediately" still resolves to: job runs on its own PR → confirmed green → added to required checks before/at merge.
- **Debug & observability**: The Playwright config already produces traces and screenshots under `test-results/` on failure; the CI value-add is uploading that directory as an artifact gated on `if: failure()` so an ubuntu-only failure is diagnosable via the trace viewer without local reproduction.

## Phase 1: E2E CI Job

### Overview

Add a new `e2e` job to `.github/workflows/ci.yml` that provisions the same Supabase stack as `test`, installs a cached Chromium, runs the Playwright suite, and uploads debugging artifacts on failure.

### Changes Required:

#### 1. New `e2e` job

**File**: `.github/workflows/ci.yml`

**Intent**: Add a third job, parallel to `ci` and `test`, that runs the browser suite on ubuntu against an in-job Supabase stack. It mirrors the `test` job's provisioning verbatim except for the browser-install and artifact steps and the run command, so the well-understood stack setup is reused rather than reinvented.

**Contract**: A new top-level job key `e2e` under `jobs:`, `runs-on: ubuntu-latest`, sharing the workflow's existing `on:` triggers (`push` → `master`, `pull_request` → `master`). Step sequence:

1. `actions/checkout@v4`
2. `actions/setup-node@v4` with `node-version: 22`, `cache: npm`
3. `npm ci`
4. `npx astro sync`
5. Cache Chromium: `actions/cache@v4` on path `~/.cache/ms-playwright`, key incorporating the runner OS and `hashFiles('**/package-lock.json')` (e.g. `${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}`) so any resolved-version change invalidates the cache. Do **not** key on the `^1.61.1` caret spec string — it stays constant when the resolved version bumps within the range (e.g. `npm update` to 1.62.0), leaving a stale key.
6. Install browser: `npx playwright install --with-deps chromium` (runs regardless; a warm cache makes it near-instant, `--with-deps` still ensures OS libs).
7. `npx supabase start`
8. Generate `.env.test` — identical `npx supabase status -o env --override-name api.url=SUPABASE_URL --override-name auth.anon_key=SUPABASE_KEY --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY > .env.test` block as the `test` job (`ci.yml:38-44`).
9. `npm run test:e2e`
10. Upload artifacts: `actions/upload-artifact@v4` with `if: failure()`, publishing the Playwright output (`test-results/` and, if present, `playwright-report/`), with a short `retention-days`.
11. `npx supabase stop` with `if: always()`.

### Success Criteria:

#### Automated Verification:

- Workflow file is valid YAML and parses: `npx --yes @action-validator/cli .github/workflows/ci.yml` (or `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`).
- The `e2e` job runs on the PR and completes green (the suite passes on ubuntu).
- On a deliberately-broken spec (temporary), the `e2e` check goes red and the failure artifact is uploaded — then the break is reverted.
- Existing `ci` and `test` jobs still run and pass unchanged.

#### Manual Verification:

- Chromium cache shows a hit on the second run (job log shows cache restored; install step is fast).
- On a failing run, the uploaded artifact opens in the Playwright trace viewer and shows the failure.
- Total `e2e` job wall-clock is acceptable (Supabase boot ~1-3 min + suite) and runs in parallel with `test`, not serially.

**Implementation Note**: After Phase 1's automated verification passes, pause for human confirmation that the job ran green on a real PR (and that the deliberate-break check red-then-green cycle was observed) before proceeding.

---

## Phase 2: Documentation Reconciliation

### Overview

Flip every doc that currently asserts "E2E is not a CI gate" to reflect the new required-gate reality, and record the reversal in the test-plan's freshness ledger. This prevents the repo from contradicting itself post-merge.

### Changes Required:

#### 1. Test plan strategy sections

**File**: `context/foundation/test-plan.md`

**Intent**: Reverse the "dropped R2 / not a gate" decision in the sections that state it, and add a §5 Quality Gates row for the E2E gate so the gate matrix is complete.

**Contract**: Edit **all four** e2e-gate assertions in this file, not just the §4 row:

1. The §4 e2e row (line ~97, "Explicitly **not** a required CI gate" → now a required gate, with the S-07+ browser-risk rationale).
2. The §4 Runtime/browser row (line ~108) — currently "the e2e-as-a-gate decision (dropped R2) is unchanged"; rewrite so it no longer asserts the decision is unchanged (the row is about interactive/agent browser verification, so state the e2e **suite-as-a-gate** decision has now reversed while the agent-verification tooling is unchanged). This line is the one the naive grep misses — do not skip it.
3. The §7 negative-space bullet(s) asserting e2e is excluded (rewrite to state it is now a gate and why the original cost×signal call changed).
4. Add a new §5 Quality Gates table row: `E2E (Playwright) | CI | required after §3 <this change> | rendered-UI interaction regressions the integration/HTTP layer can't reach`.

**Do NOT flip** the §5 Pre-prod smoke row (line ~128, "not a test gate per dropped R2") — that row is about `wrangler dev` smoke, a _different_ subject that merely shares the "dropped R2" label. Its "not a gate" wording stays. Do not restructure unrelated sections.

#### 2. Freshness ledger entry

**File**: `context/foundation/test-plan.md` (§8)

**Intent**: Append a dated ledger entry recording the reversal and its basis, mirroring the existing §8 entry style.

**Contract**: A new bullet under §8 dated 2026-07-21 noting that the dropped-R2 / "e2e not a gate" decision is **reversed** — E2E is now a required CI status check per `context/changes/ci-e2e-tests/` — because the S-07+ flag slices introduced browser-only risk no integration test reaches, and manual runs were being skipped. Supersede (don't delete) the prior "dropped R2 stands" lines' meaning by making the ledger's latest word the reversal.

#### 3. Tests README

**File**: `tests/README.md`

**Intent**: Update the two places (the §"Browser verification" note at ~line 88-92 and the E2E section at ~line 113) that call the suite "not a CI gate" to describe it as a required gate, and describe the new `e2e` CI job under the "## CI" section.

**Contract**: Rewrite the "**not a CI gate**" assertions; add an `e2e`-job description paragraph alongside the existing `test`-job description (how the stack is provisioned, that it runs the Playwright suite, that it's a required check).

#### 4. E2E authoring rules

**File**: `tests/e2e/AGENTS.md`

**Intent**: Update the opening line that frames the suite as "local-only … not a CI gate."

**Contract**: Edit the first paragraph (line 1) to state the suite now runs as a required CI gate; keep all authoring rules unchanged.

#### 5. Playwright config comment

**File**: `playwright.config.ts`

**Intent**: The `retries: 0` rationale comment (lines 11-15) references local-only assumptions; ensure it doesn't contradict CI use.

**Contract**: Comment-only edit — confirm/adjust the `retries: 0` comment so it reads correctly for CI (a real flake should fail loudly in CI, not be retried away). No code/behavior change.

### Success Criteria:

#### Automated Verification:

- No remaining assertion that E2E is "not a gate". Run a broadened grep that also catches the "dropped R2 … unchanged" phrasing the old pattern missed: `git grep -niE "not a (required )?(ci )?gate|dropped r2 (stands|.*unchanged)|e2e.*not.*gate" -- context/foundation/test-plan.md tests/README.md tests/e2e/AGENTS.md playwright.config.ts`. The check passes when **every surviving hit is one of**: (a) the §8 ledger history lines 305-306 (append-only — kept verbatim by convention), (b) the new §8 superseding reversal note, or (c) the §5 Pre-prod-smoke row (line ~128, about `wrangler dev`, not e2e). Any _other_ hit is an unreconciled contradiction and must be fixed. Because the ledger and wrangler-row hits are expected, this criterion is verified by eyeballing the (small, enumerable) hit list against that allow-list — not by a zero-match assertion.
- `npm run format` leaves the edited markdown/TS unchanged (or is run to normalize).
- `npm run typecheck` and `npm run lint` still pass (the `playwright.config.ts` comment edit doesn't break anything).

#### Manual Verification:

- A reader of `test-plan.md` §4/§5/§7/§8 comes away understanding E2E is a required gate and why the earlier decision was reversed.
- `tests/README.md` "## CI" section documents both `test` and `e2e` jobs.

**Implementation Note**: Pause for human confirmation that the doc edits read coherently and no "not a gate" statement survives before proceeding.

---

## Phase 3: Stability Verification & Promotion to Required Check

### Overview

Prove the suite is stable on ubuntu, then add `e2e` to `master` branch-protection required checks, and document the rollback. This phase is partly manual (GitHub settings) by nature.

### Changes Required:

#### 1. Stability confirmation

**File**: (no repo file — CI/ops action)

**Intent**: Confirm the `e2e` job is genuinely stable on ubuntu, not green-by-luck once, before it can block others' PRs.

**Contract**: Re-run the `e2e` job on the PR several times (re-run from the Actions UI or push trivial commits) and confirm consecutive green runs with no flakes. Any flake is root-caused and fixed (spec/harness), not retried away. Record the run outcomes in `change.md` Notes.

**Sanctioned non-retry stabilizer**: the suite has only ever run on the author's Windows box; ubuntu exercises an untested concurrency level (`playwright.config.ts` sets `fullyParallel: true` with no `workers` cap, so worker count = the runner's core count, all sharing one `astro dev` + one Supabase stack). If a flake traces to **resource contention** (cold-compile / hydration timeouts under N-way parallelism) rather than a genuine spec defect, the correct lever is to **reduce `workers`** (e.g. `workers: process.env.CI ? 1 : undefined` in `playwright.config.ts`, or `--workers=N` on the CI run command) — this is a legitimate stabilizer distinct from the banned `retries` and does not violate the "a flake is a bug" stance. Re-running at the _same_ parallelism does not derisk a probabilistic contention race; if repeated re-runs show intermittent timeouts, treat worker-count as the first knob before declaring the suite stable.

#### 2. Promote to required check

**File**: (GitHub branch-protection settings for `master` — external to the repo)

**Intent**: Make `e2e` a required status check so a red browser suite blocks merge, matching the existing `test` gate.

**Contract**: In `master` branch protection, add the `e2e` job's check name to the required status checks list (alongside `ci` / `test` as currently configured). Because GitHub only offers checks it has already observed, this is done after Phase 1's job has run on the PR.

#### 3. Rollback note

**File**: `tests/README.md` (## CI section) and/or `context/changes/ci-e2e-tests/change.md`

**Intent**: Give the team a documented, one-step escape hatch if the gate destabilizes after merge, so nobody is tempted to disable it hackily.

**Contract**: A short "Rollback" note stating that if the `e2e` gate proves flaky in production use, the immediate mitigation is to remove `e2e` from `master`'s required status checks (leaving the job running non-blocking) while the flake is root-caused — not to add retries or delete the job.

### Success Criteria:

#### Automated Verification:

- The `e2e` check appears on new PRs and its conclusion gates mergeability (verifiable via `gh pr checks <pr>` showing `e2e` as a required check once configured).

#### Manual Verification:

- Branch-protection settings for `master` list `e2e` among required status checks.
- A PR with a failing E2E test cannot be merged (merge button blocked on the `e2e` check).
- Several consecutive green `e2e` runs observed before promotion; outcomes recorded in `change.md`.
- Rollback note is present and unambiguous.

**Implementation Note**: This phase completes the change. The promotion step requires repository-admin access to branch-protection settings; if the implementer lacks it, surface it as a human handoff item.

---

## Testing Strategy

### Unit Tests:

- None — this change adds no application code. The "tests" here are the E2E specs themselves, now exercised in CI.

### Integration Tests:

- The `e2e` CI job _is_ the integration test: it runs the full Playwright suite against a real in-job Supabase stack + real `astro dev`.

### Manual Testing Steps:

1. Open the PR carrying this change; confirm the `e2e` job appears, runs, and passes.
2. Temporarily break one spec (e.g. assert a wrong Polish column heading); push; confirm `e2e` goes red and the failure artifact uploads; revert.
3. Re-run the `e2e` job 3-5 times; confirm no flakes.
4. Confirm the Chromium cache hits on subsequent runs.
5. After merge-readiness, add `e2e` to required checks; open a throwaway PR with a failing spec and confirm merge is blocked.

## Performance Considerations

- Chromium binary caching (`~/.cache/ms-playwright`) avoids the ~30-60s browser download on cache hits; the cache key includes the Playwright version so bumps invalidate cleanly.
- The `e2e` job runs in parallel with `ci` and `test`, so it adds wall-clock only if it's the longest job, not additively.
- Supabase boot (~1-3 min) dominates job time, same as the `test` job — acceptable and already tolerated in CI.

## Migration Notes

- No data or schema migration. The only "migration" is the GitHub branch-protection setting change in Phase 3, which is reversible (remove `e2e` from required checks).

## References

- Frame brief: `context/changes/ci-e2e-tests/frame.md`
- Clone template: `.github/workflows/ci.yml:27-48` (the `test` job)
- Harness: `scripts/e2e-webserver.ts`, `tests/e2e/global-teardown.ts`, `playwright.config.ts`, `tests/e2e/config.ts`
- Anti-flake gate: `tests/helpers/hydration.ts`, `tests/e2e/fixtures.ts`
- Decision being reversed: `context/foundation/test-plan.md` §4/§5/§7/§8
- Prior precedent: `context/archive/2026-06-23-testing-quality-gate-wiring/` (the `test`-job wiring)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: E2E CI Job

#### Automated

- [x] 1.1 Workflow file is valid YAML and parses
- [x] 1.2 The `e2e` job runs on the PR and completes green on ubuntu
- [x] 1.3 Deliberately-broken spec reds the `e2e` check and uploads the failure artifact, then is reverted
- [x] 1.4 Existing `ci` and `test` jobs still run and pass unchanged

#### Manual

- [x] 1.5 Chromium cache shows a hit on the second run
- [x] 1.6 Failure artifact opens in the Playwright trace viewer and shows the failure
- [x] 1.7 `e2e` job wall-clock is acceptable and runs in parallel with `test`

### Phase 2: Documentation Reconciliation

#### Automated

- [ ] 2.1 No surviving "not a gate" / "dropped R2 stands" assertion (git grep clean except the superseding ledger note)
- [ ] 2.2 `npm run format` leaves edited files normalized
- [ ] 2.3 `npm run typecheck` and `npm run lint` still pass

#### Manual

- [ ] 2.4 test-plan.md §4/§5/§7/§8 read coherently as "E2E is a required gate" with reversal rationale
- [ ] 2.5 tests/README.md "## CI" documents both `test` and `e2e` jobs

### Phase 3: Stability Verification & Promotion to Required Check

#### Automated

- [ ] 3.1 `gh pr checks` shows `e2e` as a required check once configured

#### Manual

- [ ] 3.2 Several consecutive green `e2e` runs observed; outcomes recorded in change.md
- [ ] 3.3 Branch-protection settings for `master` list `e2e` among required checks
- [ ] 3.4 A PR with a failing E2E test is blocked from merging
- [ ] 3.5 Rollback note present and unambiguous
