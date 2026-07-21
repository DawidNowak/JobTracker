# E2E as a PR-Pipeline Quality Gate — Plan Brief

> Full plan: `context/changes/ci-e2e-tests/plan.md`
> Frame brief: `context/changes/ci-e2e-tests/frame.md`

## What & Why

Make the existing browser-level Playwright suite (`tests/e2e/`) a **trustworthy required CI gate** on ubuntu — not merely "add a step." The suite covers rendered-UI interaction risks from the S-07+ flag slices (decision prompts, follow-up flags, reject/delete) that no cheaper integration/HTTP test reaches, but it only runs when someone remembers `npm run test:e2e` locally — so those risks reach merge unverified.

## Starting Point

CI (`.github/workflows/ci.yml`) has `ci` (lint/typecheck/build) and `test` (Vitest against an in-job Supabase stack) jobs; `test` is the only test gate. The E2E harness is already CI-clean by construction — it reuses the exact Supabase + `.env.test` + `.dev.vars`-swap machinery the `test` job runs, with deterministic hydration gating (`waitForBoardHydration`) that makes `retries: 0` viable. The one unproven variable: the suite has only ever run on Windows, never ubuntu.

## Desired End State

A separate `e2e` job runs on every PR and push to `master`, executes the full Playwright suite against an in-job Supabase stack, and uploads traces + screenshots on failure. `e2e` is listed among `master`'s required status checks, so a red browser suite blocks merge like `npm test` does. All docs describe E2E as a required gate.

## Key Decisions Made

| Decision                | Choice                                        | Why (1 sentence)                                                                   | Source |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- | ------ |
| Reverse §7 "not a gate" | Yes — E2E becomes a required gate             | S-07+ slices added browser-only risk integration tests can't reach                 | Frame  |
| Failure semantics       | Hard gate (block merge)                       | Consistent with the project's `retries: 0` "a flake is a bug" stance               | Frame  |
| Job structure           | New `e2e` job in `ci.yml`, parallel to `test` | Can't co-run with `npm test` (each spawns its own dev server); clones the template | Plan   |
| Promotion mechanism     | Make it required immediately                  | User's call; the introducing PR is itself the gate's first ubuntu run              | Plan   |
| Trigger                 | Every PR + push to master                     | UI regressions come from islands/services/styles too, not just `tests/e2e/`        | Plan   |
| Browser provisioning    | Cache `~/.cache/ms-playwright` by version     | Skips the browser download on the common cache-hit path                            | Plan   |
| Failure artifacts       | Upload trace + screenshots on `if: failure()` | Makes an ubuntu-only failure diagnosable without local repro                       | Plan   |
| Doc reconciliation      | Targeted inline edits + §8 ledger entry       | Precise, preserves the test-plan's ritual, avoids a full strategy rewrite          | Plan   |

## Scope

**In scope:** a new `e2e` CI job (Supabase + cached Chromium + suite + failure artifacts); reconciling `test-plan.md` §4/§5/§7/§8, `tests/README.md`, `tests/e2e/AGENTS.md`, and the `playwright.config.ts` comment; stability verification + promotion to a required check + rollback note.

**Out of scope:** new E2E coverage; any spec/fixture/harness/config behavior change; adding retries; path-filtering; folding E2E into the `test` job; a full `/10x-test-plan --refresh`; Playwright-container or sharding setups.

## Architecture / Approach

Clone the proven `test` job into a new parallel `e2e` job, inserting a Chromium cache-and-install step and a failure-artifact upload, and swapping `npm test` → `npm run test:e2e`. Docs are fixed in the same change so the repo never self-contradicts. Because the gate is required immediately, the introducing PR's own `e2e` run (re-run a few times) is the stability proof before it's added to branch protection.

## Phases at a Glance

| Phase                                 | What it delivers                                        | Key risk                                                             |
| ------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. E2E CI job                         | `e2e` job in `ci.yml` running the suite on ubuntu       | Suite flakes on its first-ever ubuntu run (unproven stability)       |
| 2. Documentation reconciliation       | Docs describe E2E as a required gate; §8 ledger entry   | Missing a stray "not a gate" line, leaving an internal contradiction |
| 3. Stability verification & promotion | Green-run confirmation + `e2e` required + rollback note | Promotion needs repo-admin branch-protection access (human handoff)  |

**Prerequisites:** repo-admin access to `master` branch-protection settings (Phase 3); a PR to run the job against.
**Estimated effort:** ~1-2 sessions — Phase 1 is a focused workflow edit; Phases 2-3 are docs + CI/ops verification.

## Open Risks & Assumptions

- **"Required immediately" carries the frame's flagged risk**: if the suite flakes on ubuntu, a required gate blocks all PRs. Mitigated by proving green on the introducing PR before promotion, plus a documented one-line rollback (remove `e2e` from required checks). The frame recommended a burn-in-then-require path; the user chose immediate — this is the accepted tradeoff.
- Assumes ubuntu cold-compile of `astro dev` fits within the 120s webServer timeout (Windows-tuned; ubuntu is typically faster — to be confirmed on first run).
- Assumes Supabase boot in the `e2e` job behaves as it does in `test` (same commands, high confidence).

## Success Criteria (Summary)

- The `e2e` check runs on every PR, and a failing browser-level test blocks merge.
- A deliberately-broken spec reds the check and produces a usable failure artifact; reverting greens it.
- No doc in the repo still claims E2E "is not a CI gate."
