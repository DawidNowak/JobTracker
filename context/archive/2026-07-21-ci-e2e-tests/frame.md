# Frame Brief: E2E as a PR-pipeline quality gate

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

A Playwright E2E suite exists locally (`tests/e2e/`, ~10 specs + a fixtures
harness) and runs via `npm run test:e2e`, but it is **not** exercised in the
PR pipeline. Today only the Vitest suite (`npm test`, `.github/workflows/ci.yml`
`test` job) gates PRs to `master`. Browser-level risks therefore go unverified
before merge.

## Initial Framing (preserved)

- **User's stated cause or approach**: The pipeline should also run the E2E
  tests — promote them to a quality gate alongside `npm test`.
- **User's proposed direction**: Add a CI step/job that runs
  `npm run test:e2e` on PRs to `master`.
- **Pre-dispatch narrowing** (Step 1.5 answers):
  - Trigger = **manual runs get skipped** — nobody reliably runs the local
    suite, so browser-level risks reach merge unverified.
  - Standing decision = **reverse it** — make E2E a required gate and update
    the §7 "not a gate" decision to match.
  - Failure mode = **block merge (hard gate)** — a required status check,
    consistent with the project's `retries: 0` "a flake is a bug" stance.

## Dimension Map

The gap ("browser risks unverified at merge") and the proposed fix ("hard E2E
gate") could break at any of these dimensions:

1. **CI portability of the harness** — does the E2E harness even run on
   ubuntu CI as-is (Supabase stack, `.dev.vars` swap, browser install, port)?
2. **Empirical CI stability of a `retries: 0` suite** — the suite has only
   ever run on the author's Windows box; a hard gate that flakes red on
   ubuntu blocks good PRs and gets routed around. ← the load-bearing risk
3. **Does E2E cover _unique_ risk** — §1 forbids gating for coverage's sake;
   if specs duplicate integration/HTTP coverage, a blocking gate adds flake
   surface + CI minutes for no new signal.
4. **Enforcement mechanism** — is a hard CI gate the right answer to "manual
   runs get skipped," or a co-located separate job vs. folding into `test`? ← initial framing lands here

## Hypothesis Investigation

| Hypothesis                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Verdict                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Dim 1 — harness not CI-portable**               | Harness reuses the _exact_ machinery the existing `test` job already runs: local Supabase + `.env.test` (`scripts/e2e-webserver.ts:7,20-26`), ephemeral users + `signInAndCaptureCookies` (`tests/e2e/fixtures.ts:55-71`), and a self-contained `astro dev` wrapper that backs up/swaps/restores `.dev.vars` with hard-kill safety nets (`e2e-webserver.ts:33-101`). Fixed port `4331`/`127.0.0.1` (`tests/e2e/config.ts:4-5`). The _only_ genuinely new CI need is a Playwright browser install (`npx playwright install --with-deps chromium`) and a **separate** job (README:109 — must not co-run with `npm test`). | **WEAK** (portable by construction; small, known delta) |
| **Dim 2 — unproven CI stability of `retries: 0`** | `playwright.config.ts:16` sets `retries: 0` deliberately; hydration is gated deterministically via `waitForBoardHydration` (`board-load.spec.ts:16`) rather than papered with retries — good. BUT: cold-compile flaked at 30s→60s and the webServer timeout is 120s, both attributed to **Windows first-compile** (`test-plan.md:279`, `playwright.config.ts:34`). The suite has **never run in CI/ubuntu**; §8 ledger only ever verified it locally. A hard gate on an empirically-unproven-in-CI suite is the exact failure mode that defeats the purpose.                                                            | **STRONG** (this is where the framing breaks)           |
| **Dim 3 — E2E duplicates existing coverage**      | §2 risk map: **none** of the top-6 risks (#1–#6) name E2E/browser as "likely cheapest layer" — all are unit/integration/HTTP (`test-plan.md` §2 Response Guidance). E2E specs instead cover rendered-UI interaction risks from the S-07+ flag slices (`decision-prompt-*`, `followup-flag`, `reject-application`, `rozmowa-followup-flag`) — a genuinely distinct, non-duplicated class per the suite's mandate (`tests/e2e/AGENTS.md`). So the gate _is_ value-additive.                                                                                                                                               | **NONE** (no duplication; unique risk confirmed)        |
| **Dim 4 (initial framing) — "add a CI step"**     | Correct as far as it goes, but understates the work: it's a _separate job_ (parallel to `test`), needs browser install, and — critically — reversing §7 means reconciling contradicting docs that currently assert "not a gate": `test-plan.md` §4/§7/§8, `tests/README.md:88-92,113`, `tests/e2e/AGENTS.md:1`, `playwright.config.ts:11-15`.                                                                                                                                                                                                                                                                           | **WEAK** (right direction, wrong center of gravity)     |

## Narrowing Signals

- User confirmed the trigger is **skipped manual runs**, not a specific
  escaped regression — so the goal is _enforcement of an existing suite_,
  not building new coverage. The suite already exists and covers unique risk.
- User explicitly chose **hard gate** over "advisory until stable." That
  rejects a permanent soft gate — but makes Dim 2 (CI stability) the
  make-or-break prerequisite, not an optional nicety.
- The original "dropped R2 / not a gate" call was a **cost×signal** decision
  ("integration via the Supabase SSR client still covers most of §2",
  `test-plan.md:97`). What changed since is the _new browser-only surface_
  from S-07+ slices — which integration tests structurally cannot reach.
  That is the legitimate basis for the reversal.

## Cross-System Convention

The project's whole test strategy is risk-based and cost-conscious (§1:
"the cheapest test that gives a real signal wins; do not promote to e2e
because e2e feels safer"). A hard E2E gate is only convention-compliant if it
guards risk _no cheaper layer covers_ (satisfied — Dim 3) **and** stays green
when the code is correct (unproven — Dim 2). The existing `test` job is the
template: boots Supabase in-job, derives `.env.test` at runtime, no secrets.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is: make the existing browser-level
> suite a _trustworthy_ required gate on ubuntu CI — not merely "add a step."**

The user's direction is sound and the reversal is justified (unique S-07+
browser risk; skipped manual runs leave it unguarded). But the center of
gravity is not the YAML step — it is (a) standing up a **separate** CI job
that ports the harness (Supabase stack + `.env.test` + `playwright install`),
(b) **proving green stability on ubuntu before flipping branch protection to
required** — a flake-on-first-CI-run hard gate would block good PRs and get
disabled, recreating the original problem, and (c) reconciling the several
docs that currently assert "E2E is not a gate." Addressing only (a) ships a
gate that may be worse than none.

## Confidence

**MEDIUM–HIGH.** Feasibility, uniqueness, and intent are all resolved with
file:line evidence (HIGH). The one open variable is empirical: whether a
`retries: 0` suite that has only ever run on Windows stays green on ubuntu CI.
Because the user chose a hard gate, the plan must treat CI-stability
verification as a first-class phase — e.g. land the job non-required, get N
consecutive green runs on the branch, then set branch protection to required.
That is _not_ the rejected "advisory forever" option; it's "prove, then
require," consistent with `retries: 0` (root-cause flakes, don't retry them).

## What Changes for /10x-plan

Plan around **three** deliverables, not one: (1) a separate ubuntu CI job that
ports the E2E harness (Supabase + `.env.test` + chromium install + the
`.dev.vars`-swapping webserver), (2) a CI-stability burn-in gate before
promotion to a _required_ status check, and (3) documentation reconciliation
across `test-plan.md` §4/§7/§8, `tests/README.md`, `tests/e2e/AGENTS.md`, and
the `playwright.config.ts` comment. Do not scope this as a one-line workflow edit.

## References

- Source files: `.github/workflows/ci.yml:27-48`, `scripts/e2e-webserver.ts:7-101`,
  `playwright.config.ts:11-36`, `tests/e2e/config.ts:4-5`, `tests/e2e/fixtures.ts:46-76`,
  `tests/e2e/board-load.spec.ts:16`, `tests/e2e/AGENTS.md:1`, `tests/README.md:88-133`
- Standing decision reversed: `context/foundation/test-plan.md` §1, §2, §4 (line 97),
  §5, §7, §8 (lines 305-306) — "dropped R2 / not a gate"
- Prior related changes: `context/archive/2026-07-09-e2e-playwright-harness/`,
  `context/archive/2026-07-20-e2e-suite-cleanup/`,
  `context/archive/2026-06-23-testing-quality-gate-wiring/` (the `test`-job wiring precedent)
- Investigation method: direct file:line reads (sub-agents not spawned — evidence
  gathered inline against this project's own source)
