# Quality Gate Wiring — Plan Brief

> Full plan: `context/changes/testing-quality-gate-wiring/plan.md`

## What & Why

Phase 4 (final) of the test rollout in `context/foundation/test-plan.md`. Phases 1–3 built a
real Vitest suite (parser fixtures, Supabase-local RLS/trigger integration, HTTP smoke). This
phase **locks the floor**: it runs the existing `npm test` as a **required CI gate** on
push/PR so a regression in Risks #1–#5 can't merge. No new test logic.

## Starting Point

CI today is one `ci` job (`typecheck → lint → build`) with no test step. The suite needs more
than that job offers: a local Supabase stack (`supabase start`), a localhost-pointed
`.env.test` (hard-asserted by `tests/setup.ts`), and an `astro dev` (spawned by
`tests/global-setup.ts` inside the run).

## Desired End State

A parallel `test` job boots local Supabase, derives `.env.test` from the CLI, and runs
`npm test` (both pools) green on every push to `master` and every PR. The check is a
**required** branch-protection rule, so a red suite blocks merge. Rollout docs reflect the
wired gate; the parser-drift canary is recorded as a deferred follow-up.

## Key Decisions Made

| Decision                   | Choice                                                      | Why (1 sentence)                                                                 | Source     |
| -------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| Job layout                 | Separate `test` job, parallel to `ci`                       | Keeps lint/typecheck/build fast-failing; stable check name for branch protection | Plan       |
| Supabase in CI             | `supabase start` + derive keys via `supabase status -o env` | Local stack keys are deterministic demo keys — no secrets to manage              | Plan       |
| Triggers                   | push to `master` + PR (match current `ci`)                  | Keeps `master` provably green; required check works on PRs                       | Plan       |
| Enforcement                | Plan provides `gh` branch-protection command; user runs it  | Outward-facing repo-settings change belongs to the admin                         | Plan       |
| Canary (Risk #1 slow-burn) | Defer — document as a follow-up change                      | Live-network drift detection needs its own design (ToS, alerting, flakiness)     | Plan       |
| Coverage / workerd gates   | Excluded                                                    | §7 of test-plan.md forbids both                                                  | Foundation |

## Scope

**In scope:** new `test` job in `ci.yml`; `supabase start` + runtime `.env.test`; `npm test`
both pools; branch-protection command; doc updates; deferred-canary note.

**Out of scope:** new tests; coverage thresholds; workerd-divergence gate; bare-Postgres
container; merge queue; changing the existing build's remote secrets.

## Architecture / Approach

`ci.yml` gains a second job. Steps: `checkout → setup-node (cache npm) → npm ci → astro sync →
supabase start → write .env.test from CLI → npm test`. `npm test` spawns/kills `astro dev`
itself, so no separate dev-server step. No secrets referenced — the test stack keys come from
the running CLI. Branch protection lists the `test` check as required to make it blocking.

## Phases at a Glance

| Phase                       | What it delivers                                                                    | Key risk                                                              |
| --------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Wire the test job        | Green `test` job booting Supabase + running both pools in CI                        | `astro dev` cold-compile / Supabase boot timing; CLI key-name mapping |
| 2. Enforce + close out docs | Required-check branch protection (user-run) + doc reconciliation + canary follow-up | Branch protection needs admin; check-name must match the real run     |

**Prerequisites:** Phases 1–3 complete (they are); GitHub admin rights for branch protection.
**Estimated effort:** ~1 session — one workflow edit + a CI debug loop, then docs.

## Open Risks & Assumptions

- The three `supabase status -o env --override-name` source keys (`api.url`, `auth.anon_key`,
  `auth.service_role_key`) must be confirmed against the installed CLI's actual output.
- `astro dev` first-compile in CI stays within the 60s readiness timeout.
- `supabase start` Docker pull adds ~1–3 min per run — accepted.

## Success Criteria (Summary)

- A red suite blocks merge on a PR; reverting unblocks it.
- `npm test` (both pools) runs green in CI against a CI-booted local Supabase, no secrets.
- `test-plan.md` §3/§5 reflect the wired, required gate.
