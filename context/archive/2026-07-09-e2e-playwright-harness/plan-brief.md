# Playwright E2E Harness — Plan Brief

> Full plan: `context/changes/e2e-playwright-harness/plan.md`

## What & Why

Stand up a first-class Playwright E2E harness that **reuses** JobTracker's existing Supabase test plumbing (local stack, `@supabase/ssr` cookie auth, ephemeral users, row seeding, the `.dev.vars`-swap dev-server trick) instead of a parallel stack. It runs as a local-only npm script — deliberately NOT a CI gate. The motivation is forward-looking: the follow-up-**flag** slices (S-07/08/09) are the product's north-star wedge and are genuinely browser-level risks; S-07 is next up. Building the harness now means those slices land _with_ E2E coverage rather than retrofitting it.

## Starting Point

No Playwright as a test framework (not in `package.json`, no config, no `*.spec.ts`) — only the CLI used by the `e2e-browser` skill for manual verification. But a rich Vitest test base already exists: `signInAndCaptureCookies()` (auth without the UI), `provisionUser`/`cleanupUser`/`seedApplication` (isolation + seeding), and `tests/global-setup.ts`'s proven `.dev.vars`-swap + `astro dev` spawn. The board UI (S-01…S-06) is fully built; the flag UI is not.

## Desired End State

`npm run test:e2e` swaps `.dev.vars` to the local stack, boots `astro dev` on a fixed port, runs a chromium suite, tears down, and restores `.dev.vars`. Two green specs: a **board-load exemplar** (auth + seeded cards render in the right columns) and a **delete-confirmation risk test** (card removed from board _and_ row removed from DB). Each test provisions/cleans its own ephemeral user; lint + typecheck cover the specs; Vitest is unaffected.

## Key Decisions Made

| Decision        | Choice                                                    | Why (1 sentence)                                                                                             | Source |
| --------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------ |
| First risk test | Delete-confirmation                                       | Flag feature isn't built (S-07 proposed); delete is shipped, irreversible, UI-gated, cross-boundary.         | Plan   |
| Run mode        | Local-only npm script                                     | Respects the frozen test-plan §4/§7 "e2e not a gate" (dropped-R2) decision.                                  | Plan   |
| Auth/isolation  | Per-test ephemeral user + cookie injection                | Zero cross-test bleed, unique data, safe for the mutating delete test and parallel runs.                     | Plan   |
| Dev server      | Self-managed webServer on a fixed port + `.dev.vars` swap | Hermetic (always test DB); fixed port sidesteps config-eval-before-globalSetup.                              | Plan   |
| Browsers        | Chromium only                                             | Dominant PRD target (Chrome/Edge share the engine); fast; easy to extend later.                              | Plan   |
| Tooling         | Lint + typecheck cover specs; Vitest excludes them        | Specs stay type-safe/lint-clean; `*.spec.ts` vs `*.test.ts` split prevents runner collision.                 | Plan   |
| Delete rigor    | UI + DB row check                                         | Catches "UI hides it but the row survives" — the actual persistence risk; makes deliberate-break meaningful. | Plan   |
| Docs            | tests/README section + one factual test-plan §4 note      | Keeps docs truthful without reversing strategy.                                                              | Plan   |

## Scope

**In scope:** Playwright install (chromium); `playwright.config.ts`; `scripts/e2e-webserver.ts` (`.dev.vars` swap + `astro dev`); `tests/e2e/fixtures.ts` (auth/seed/isolation); `global-teardown.ts`; `board-load.spec.ts`; `delete-application.spec.ts`; `tests/e2e/AGENTS.md` rules; gitignore/package/tsconfig/eslint wiring; README + test-plan note.

**Out of scope:** CI gate / ci.yml job; the flag E2E test (feature unbuilt); add-from-URL, drag-status, notes, edit, archive, auth-form flows; Firefox/WebKit; visual/screenshot tests; mocking any internal boundary; test-plan strategy rewrite.

## Architecture / Approach

Playwright config → `webServer` runs a wrapper script that guards the local-stack `SUPABASE_URL`, backs up + swaps `.dev.vars`, and spawns `astro dev` on a fixed port; `globalTeardown` authoritatively restores `.dev.vars` from the backup (covers hard kill). A `fixtures.ts` extends `test` with a worker-scoped admin client, a per-test ephemeral `account`, an authenticated `context` (built by injecting `signInAndCaptureCookies()` cookies — no UI login), and a `seedApp` helper. Specs are role-locator, one-per-file, web-first-assertion.

## Phases at a Glance

| Phase                    | What it delivers                                                                                      | Key risk                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1. Foundation + exemplar | Install, config, webserver wrapper, fixtures, rules lever, tooling wiring, green `board-load.spec.ts` | `.dev.vars` restore across kill paths; fixed-port collisions    |
| 2. Delete risk test      | Green `delete-application.spec.ts` (UI + DB) + deliberate-break check                                 | Reload timing; scoping the dialog-confirm "Usuń" vs menu "Usuń" |
| 3. Docs                  | tests/README E2E section + factual test-plan §4 note                                                  | Not reversing the dropped-R2 decision                           |

**Prerequisites:** Local Supabase up (`npx supabase start`); `.env.test` populated; no dev-server port squatters.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Assumes the fixed E2E port is free; the wrapper must fail loudly if squatted (Windows port-hygiene is a known pain point per the `e2e-browser` playbook).
- Assumes same-origin real-UI DELETE passes Astro CSRF (it does in production; the manual-request 403 gotcha doesn't apply to the app's own fetch).
- Assumes `astro check` / eslint accept `@playwright/test` types with at most a minimal tsconfig include; a small, scoped override may be needed.

## Success Criteria (Summary)

- `npm run test:e2e` runs both specs green against the local stack and leaves no residue (`.dev.vars` restored, no orphan users/processes).
- The delete test fails at the DB-row assertion when the delete path is deliberately broken.
- Lint + typecheck cover the specs; Vitest (`npm test`) is unaffected; the strategy docs remain truthful and un-reversed.
