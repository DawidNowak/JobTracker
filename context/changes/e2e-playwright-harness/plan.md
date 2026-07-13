# Playwright E2E Harness Implementation Plan

## Overview

Introduce a first-class Playwright E2E test harness for JobTracker that **reuses** the project's existing, proven test plumbing (local Supabase stack, `@supabase/ssr` cookie auth, ephemeral-user provisioning, row seeding, the `.dev.vars`-swap dev-server trick) rather than building a parallel stack. The harness is proven by two specs: a **board-load exemplar** (the reference every future spec is modeled on) and a **delete-confirmation risk test** (irreversible data-loss, UI-gated, cross-boundary). It runs as a **local-only npm script** — deliberately NOT a required CI gate, respecting the frozen `test-plan.md` §4/§7 decision to drop E2E-as-a-gate for MVP ("dropped R2").

The motivation is forward-looking: the follow-up-flag slices (S-07 Interesujące decision prompt, S-08 Zaaplikowano flag, S-09 Rozmowa flag) are the project's north-star wedge and are genuinely browser-level risks — state that only exists in the rendered board. S-07 is next up (its change folder was just created, empty). Standing up the harness now means those flag slices land _with_ E2E coverage instead of retrofitting it.

## Current State Analysis

- **No Playwright as a test framework.** `@playwright/test` is not in `package.json`; there is no `playwright.config.*` and no `*.spec.ts` (only `node_modules`). The only Playwright present is the CLI on the dev box used by the `e2e-browser` skill for **agent-assisted manual verification** — explicitly not a test gate.
- **Rich, reusable test infrastructure already exists** (Vitest, two pools):
  - `tests/helpers/cookies.ts` → `signInAndCaptureCookies(email, password)` mints real `@supabase/ssr` cookies via the same `createServerClient` path the middleware reads — this is the "authenticate without the UI" primitive.
  - `tests/helpers/users.ts` → `provisionUser(admin)` (fresh `u-<uuid>@test.local`, `email_confirm: true`) / `cleanupUser(admin, userId)` (cascade wipes owned rows).
  - `tests/helpers/seed.ts` → `seedApplication(client, userId, overrides?)` inserts one row (defaults `source:"test-seed"`, `status:"Zaaplikowano"`) and returns it.
  - `tests/helpers/supabase-clients.ts` → `createAdminClient()` (service role) / `createUserClient()` (anon), both `persistSession:false`.
  - `tests/global-setup.ts` → the load-bearing pattern: temporarily swaps `.dev.vars` to the local Supabase stack (the `@astrojs/cloudflare` adapter reads `astro:env/server` vars from `.dev.vars` via `getPlatformProxy()`, **not** from `process.env`), spawns `astro dev` on a free port, polls readiness (120s Windows cold-start budget), and restores `.dev.vars` in `teardown()` + a `process.on("exit")` safety net.
  - `scripts/e2e-session.ts` → already composes `provisionUser` + `signInAndCaptureCookies` + `seedApplication`, and carries a **local-stack guard** (`ALLOWED_PREFIXES` = `http://127.0.0.1:54321` / `http://localhost:54321`) refusing to run against a non-local `SUPABASE_URL`.
- **The UI under test is built** (S-01…S-06 done): `dashboard.astro` SSR-groups active applications into a `KanbanBoard` (`client:load`) with three `KanbanColumn`s. Confirmed selectors:
  - Columns: `<h2>` headings "Interesujące" / "Zaaplikowano" / "Rozmowa" (`KanbanColumn.tsx:28`); empty state `Brak aplikacji`.
  - Card: `<article>` with company as a semibold `<p>` (`KanbanCard.tsx:100`); the card menu trigger is `button[aria-label="Opcje aplikacji"]` (`KanbanCard.tsx:106`) → dropdown `menuitem`s "Szczegóły" / "Edytuj" / "Usuń".
  - Delete: `DeleteApplicationDialog.tsx` renders an `AlertDialog` (role `alertdialog`) titled "Usuń aplikację", warning copy differs by column (Zaaplikowano/Rozmowa → "Rekord nie zostanie zachowany w archiwum. Tej akcji nie można cofnąć."), footer `Anuluj` / `Usuń`. On DELETE 200/204 it calls `window.location.reload()` (`DeleteApplicationDialog.tsx:47`).
- **Environment verified live** during planning: local Supabase up (`/rest/v1/` → 200), `.env.test` present, no dev-server port squatters, `.gitignore` already ignores `.env.test`, `.dev.vars`, `.playwright-cli/`.
- **The flag feature is NOT built** — `KanbanCard.tsx` renders no flag/badge; zero `requiresAction`/follow-up logic in `src/`; roadmap S-07/08/09 are `proposed`. Hence the first risk test targets **delete** (a shipped feature), not the flag.

## Desired End State

Running `npm run test:e2e` against a local Supabase stack:

1. Swaps `.dev.vars` to the local stack, boots `astro dev` on a fixed port, waits for readiness, runs the chromium E2E suite, tears the server down, and restores `.dev.vars`.
2. Executes two green specs — `board-load.spec.ts` (authenticated board renders seeded cards in the correct columns) and `delete-application.spec.ts` (delete flow removes the card from the board and the row from the DB).
3. Leaves no residue: every test provisions and cleans up its own ephemeral user; no committed artifacts (reports/results/backups are gitignored).

`npm run lint` and `npm run typecheck` cover the new specs. `npm test` (Vitest) is unaffected — it never picks up `*.spec.ts`. `test-plan.md` and `tests/README.md` truthfully describe the harness as local-only and not a gate.

### Key Discoveries:

- **Auth without the UI is a one-liner via existing code**: `signInAndCaptureCookies()` returns a `name=value; …` cookie string; converting to `context.addCookies([{ name, value, url }])` yields an authenticated Playwright context. The token cookie is `sb-127-auth-token`; if it grows it chunks into `.0`/`.1` — parsing the returned string handles any number of chunks (`e2e-browser` SKILL.md gotcha).
- **Config is evaluated before `globalSetup`** in Playwright, so a dynamically-chosen dev-server port cannot reach `use.baseURL`. → Use a **fixed port** and a **wrapper-script `webServer`** that owns the `.dev.vars` swap (guaranteed to run before `astro dev` spawns, since the same script spawns it).
- **`.dev.vars` restore must survive a hard kill**: mirror `global-setup.ts`'s belt-and-suspenders — the wrapper writes a backup file and restores on graceful exit, and a Playwright `globalTeardown` authoritatively restores from that backup after the run (covers SIGKILL of the wrapper).
- **Vitest/Playwright never collide**: `vitest.config.ts` `include` globs are `*.test.ts`; E2E files are `*.spec.ts` under `tests/e2e/`. Keep that split.
- **Same-origin real-UI DELETE passes CSRF**: the `e2e-browser` CSRF-403 gotcha is about _manual_ cross-tool requests; the app's own in-browser `fetch` (which the test drives) sends a matching Origin, exactly as in production. Driving the real UI is the point.

## What We're NOT Doing

- **Not** making E2E a required CI status check, and **not** adding a Playwright job to `.github/workflows/ci.yml`. The `test-plan.md` §5 "e2e not a gate" decision stands; promotion to a gate is a future `/10x-test-plan --refresh` decision.
- **Not** writing the follow-up-**flag** E2E test — that feature isn't built (S-07/08/09 `proposed`). The harness is built so those slices add their own flag spec.
- **Not** testing the add-from-URL parse flow, drag-and-drop status transitions, notes, edit, archive, or auth form flows in this change. One exemplar + one risk test only.
- **Not** adding Firefox/WebKit projects (chromium-only now; Chrome/Edge share the engine).
- **Not** introducing visual/screenshot assertions (test-plan §7 excludes them for MVP).
- **Not** mocking Supabase or any internal boundary — auth, routing, and DB stay real (that is where E2E value lives).
- **Not** rewriting `test-plan.md`'s strategy — only a single factual note in §4.

## Implementation Approach

Build the harness bottom-up so each phase ends green and verifiable. Phase 1 stands up everything needed to run _any_ E2E test and proves it with the lowest-flake, highest-leverage spec (authenticated board render) — which doubles as the reference exemplar. Phase 2 layers the delete risk test on the same fixtures and hardens it with a DB-level assertion + deliberate-break check. Phase 3 documents usage and reconciles the strategy docs. Everything reuses `tests/helpers/*`; the only genuinely new logic is (a) the `.dev.vars`-swapping webServer wrapper and (b) the cookie→context auth fixture.

## Critical Implementation Details

- **Timing & lifecycle**: The `.dev.vars` swap MUST happen inside the `webServer` wrapper script (before it spawns `astro dev`), not in `globalSetup` — Playwright's `globalSetup`/`webServer` ordering is not a safe place to hang the swap given config-eval timing. Restoration is dual-path: wrapper on graceful exit + `globalTeardown` from a backup file for hard kills. The wrapper must also reuse the `ALLOWED_PREFIXES` local-stack guard so E2E can never point `astro dev` at a non-local DB.
- **User experience spec**: `DeleteApplicationDialog` reloads the page on success (`window.location.reload()`), so the delete assertion must wait for navigation/network-idle and then assert the card's absence — not assert synchronously right after the click.

## Phase 1: Harness foundation + board-load exemplar

### Overview

Install Playwright (chromium), create the config + dev-server wrapper + auth/seed fixtures + authoring-rules lever + tooling wiring, and prove the whole plumbing with a green `board-load.spec.ts`.

### Changes Required:

#### 1. Playwright dependency + browser

**File**: `package.json` (+ lockfile)

**Intent**: Add `@playwright/test` as a devDependency and install the Chromium binary so specs can run.

**Contract**: `devDependencies["@playwright/test"]` present; `npx playwright install chromium` completed. No change to `dependencies`. Version pinned to the current stable `^1.x`.

#### 2. npm scripts

**File**: `package.json`

**Intent**: Add a local-only entry point for the suite (plus a headed/debug convenience) without touching the `test` (Vitest) script.

**Contract**: `scripts["test:e2e"] = "playwright test"` and `scripts["test:e2e:ui"] = "playwright test --ui"`. `scripts.test` (Vitest) unchanged.

#### 3. Dev-server wrapper (the `.dev.vars` swap owner)

**File**: `scripts/e2e-webserver.ts` (new)

**Intent**: A Playwright-`webServer`-invoked wrapper that makes the app hermetic for E2E: guard that `SUPABASE_URL` is the local stack, back up and swap `.dev.vars` to the local-stack creds, spawn `astro dev` on the fixed E2E port bound to `127.0.0.1`, forward its stdout, and restore `.dev.vars` on graceful shutdown. Mirrors `tests/global-setup.ts` (swap/spawn/restore + Windows `taskkill /F /T` tree-kill).

**Contract**: Loads `.env.test` via dotenv; reuses the `ALLOWED_PREFIXES` guard (`http://127.0.0.1:54321` / `http://localhost:54321`) — throws if `SUPABASE_URL` is non-local or `SUPABASE_KEY` missing. Writes a backup file (e.g. `.dev.vars.e2e-backup`) with the original `.dev.vars` contents (or records "none" if absent), then writes `SUPABASE_URL=…\nSUPABASE_KEY=…\n`. Spawns `astro dev --port <E2E_PORT> --host 127.0.0.1`. Restores `.dev.vars` + removes backup on `SIGTERM`/`SIGINT`/child-exit/`process.on("exit")`. Exposes the fixed port via a shared constant (see #4).

#### 4. Shared E2E constants

**File**: `tests/e2e/config.ts` (new) — or inline in the config

**Intent**: Single source for the fixed E2E port, `baseURL`, and backup-file path so the config, the wrapper, and `globalTeardown` agree.

**Contract**: Exports `E2E_PORT` (a fixed, uncommon port, e.g. `4331`), `E2E_BASE_URL = "http://127.0.0.1:${E2E_PORT}"`, and `DEV_VARS_BACKUP = ".dev.vars.e2e-backup"`.

#### 5. Playwright config

**File**: `playwright.config.ts` (new)

**Intent**: Configure a single chromium project against the fixed local `baseURL`, wire the `webServer` to the wrapper with a Windows-safe cold-start timeout, load `.env.test` for the test process, and register `globalTeardown` for authoritative `.dev.vars` restore.

**Contract**: `testDir: "tests/e2e"`, `testMatch: "**/*.spec.ts"`; single project `{ name: "chromium", use: devices["Desktop Chrome"] }`; `use.baseURL = E2E_BASE_URL`; `webServer = { command: "tsx scripts/e2e-webserver.ts", url: E2E_BASE_URL, reuseExistingServer: false, timeout: 120_000 }`; `globalTeardown` path set; top-level `config({ path: ".env.test" })`. `fullyParallel: true`; retries `0` locally. Trace/screenshot `on-first-retry` (kept for later CI use, cheap locally).

#### 6. globalTeardown (authoritative `.dev.vars` restore)

**File**: `tests/e2e/global-teardown.ts` (new)

**Intent**: After the run, restore `.dev.vars` from the backup file if present (covers a hard-killed wrapper) and delete the backup.

**Contract**: Default export `async () => {…}`; if `DEV_VARS_BACKUP` exists, restore its recorded content to `.dev.vars` (or delete `.dev.vars` if the backup recorded "originally absent"), then remove the backup. Idempotent / best-effort.

#### 7. Auth + seed + isolation fixtures (the core lever)

**File**: `tests/e2e/fixtures.ts` (new)

**Intent**: Extend Playwright's `test` with per-test isolation reusing the existing helpers: a worker-scoped `admin` client, a test-scoped `account` (provision → yield → cleanup), an authenticated `context` (override the built-in fixture to inject `@supabase/ssr` cookies so every `page` is signed in without the UI), and a `seedApp` helper bound to the test's user. Addresses all five E2E anti-patterns structurally (isolation, unique data, auth-without-UI, cleanup).

**Contract**: Loads `.env.test` at module top via `config({ path: ".env.test" })` (dotenv) — do NOT rely on `playwright.config.ts`'s dotenv side-effect reaching worker processes; the helpers (`signInAndCaptureCookies`, `createAdminClient`/`createUserClient`) read `process.env.SUPABASE_URL`/`SUPABASE_KEY`/`SUPABASE_SERVICE_ROLE_KEY` and throw hard if unset. This mirrors the defensive pattern in `tests/global-setup.ts` and `scripts/e2e-session.ts`. `export const test = base.extend<Fixtures>({ … })` and `export { expect }`. Fixtures: `admin: SupabaseClient<Database>` (worker-scoped, `createAdminClient()`); `account: { userId; email; password }` (via `provisionUser` / `cleanupUser` in teardown); `context` override → after `browser.newContext()`, parse `await signInAndCaptureCookies(account.email, account.password)` into `[{ name, value, url: E2E_BASE_URL }]` and `context.addCookies(...)`; `seedApp: (overrides?) => Promise<ApplicationRow>` → `seedApplication(admin, account.userId, overrides)`. Cookie parsing splits on `;`, trims, splits first `=` (tolerant of chunked `sb-…-auth-token.N`).

#### 8. E2E authoring rules (lever) + tsconfig/eslint wiring

**File**: `tests/e2e/AGENTS.md` (new); `tsconfig.json` and/or eslint config (edits as needed)

**Intent**: Encode the E2E quality rules future authors (human or agent) follow — role-based locators, one test per file, per-test isolation via the fixtures, wait-for-state (never `waitForTimeout`), auth without the UI, unique data, risk-bound test names, Polish UI copy, the local-stack + no-mock-internal-boundaries rules — and ensure the new `*.spec.ts` typecheck (`astro check`) and lint (`eslint`) cleanly.

**Contract**: `tests/e2e/AGENTS.md` documents the rules + points at `board-load.spec.ts` as the exemplar. `tsconfig.json` includes `tests/e2e/**` (or already does via its glob) so `@playwright/test` types resolve; eslint runs green on the specs (add a minimal override only if a rule genuinely misfires on test files). The likely one: `no-empty-pattern` on worker/admin fixtures written as `async ({}, use) => …` — if it fires, scope the disable to `tests/e2e/**` only. No disabling of project-wide rules.

#### 9. gitignore

**File**: `.gitignore`

**Intent**: Ignore Playwright run artifacts and the `.dev.vars` backup.

**Contract**: Add `test-results/`, `playwright-report/`, `playwright/.cache/`, and `.dev.vars.e2e-backup`.

#### 10. Board-load exemplar spec

**File**: `tests/e2e/board-load.spec.ts` (new)

**Intent**: Prove the harness end-to-end and serve as the reference exemplar: seed applications into distinct columns for the test's user, load `/dashboard`, and assert each card renders under the correct column heading using role-based locators.

**Contract**: Uses `test`/`expect` from `./fixtures`. Seeds ≥1 uniquely-tagged card in "Interesujące" and ≥1 in "Zaaplikowano" (unique `company` marker per run). `page.goto("/dashboard")`; assert the column `heading`s are visible and each seeded company text appears (scoped so the Zaaplikowano card is not counted under Interesujące). **Column-scoping locator (KanbanColumn renders a plain `<div>` with no `region`/landmark role — only the `<h2>` is named)**: locate each column container by its heading, e.g. `const column = (name) => page.locator("div").filter({ has: page.getByRole("heading", { name }) }).last();` then assert `column("Interesujące").getByText(companyA)` and `column("Zaaplikowano").getByText(companyB)`. Unique per-run `company` markers keep each card unambiguous. Document this exact pattern in the exemplar as the copyable reference for future specs. No `waitForTimeout`; rely on web-first `expect(...).toBeVisible()`.

### Success Criteria:

#### Automated Verification:

- [ ] `@playwright/test` present in `package.json` and `npx playwright install chromium` succeeds
- [ ] `npm run test:e2e` boots the app and passes `board-load.spec.ts` (chromium) green
- [ ] `npm run typecheck` (astro check) passes with the new spec/fixtures present
- [ ] `npm run lint` passes on `tests/e2e/**`
- [ ] `npm test` (Vitest) still runs and does not pick up `*.spec.ts`

#### Manual Verification:

- [ ] After a run, `.dev.vars` is byte-identical to its pre-run content and `.dev.vars.e2e-backup` is gone
- [ ] No leftover `astro dev` process on the E2E port; no leftover `u-<uuid>@test.local` users
- [ ] Wrapper refuses to run when `SUPABASE_URL` is non-local (guard fires)

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual items before Phase 2.

---

## Phase 2: Delete-confirmation risk test

### Overview

Layer the first real risk test on the Phase 1 fixtures: the irreversible delete flow, asserted at both the UI and DB layers, then hardened with a deliberate-break check.

### Changes Required:

#### 1. Delete-confirmation spec

**File**: `tests/e2e/delete-application.spec.ts` (new)

**Intent**: Drive the full destructive path through the real UI and prove the card is removed from the board AND the row is deleted from the DB — the persistence guarantee that makes the irreversible-delete risk real.

**Contract**: Uses `test`/`expect` from `./fixtures`. Seeds one card in `status:"Zaaplikowano"` with a unique `company` marker. `page.goto("/dashboard")`; open `getByRole("button", { name: "Opcje aplikacji" })` on that card; click `getByRole("menuitem", { name: "Usuń" })`; in the `getByRole("alertdialog")` assert title "Usuń aplikację" + the archive-warning copy, then click the dialog-scoped confirm `getByRole("button", { name: "Usuń" })`. Wait for the reload; assert the card's company text is no longer on the board. Then re-read via `admin` (or the fixture's `account.userId`) and assert the row no longer exists. Test name binds to the risk (e.g. `deletes a Zaaplikowano card from board and database`). Menu-trigger vs dialog-confirm both read "Usuń" — scope the confirm to the `alertdialog`.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e` passes both specs (chromium) green
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes on the new spec

#### Manual Verification:

- [ ] Deliberate-break check: temporarily weaken the delete path (e.g. make the confirm a no-op / invert the DB assertion target) and confirm the test goes RED at the DB-row assertion; then revert the break and confirm GREEN. (The break is never committed.)
- [ ] No orphaned rows/users after the run

**Implementation Note**: Commit only after both specs are green and the deliberate-break edit is reverted. Pause for human confirmation of the manual items before Phase 3.

---

## Phase 3: Docs

### Overview

Document harness usage and reconcile the strategy docs, without reversing the E2E-not-a-gate decision.

### Changes Required:

#### 1. tests/README E2E section

**File**: `tests/README.md`

**Intent**: Add a concise "E2E (Playwright)" section: prerequisites (local Supabase up, `.env.test`), how to run (`npm run test:e2e` / `:ui`), the fixed-port + `.dev.vars`-swap behavior, the per-test-ephemeral-user isolation model, the one-test-per-file + role-locator conventions (pointing at `tests/e2e/AGENTS.md`), and the "not concurrent with `npm test`" caveat.

**Contract**: New section near the existing "Browser verification (agent-driven)" section; cross-links `tests/e2e/AGENTS.md` and `board-load.spec.ts` as the exemplar. Clarifies E2E is local-only, not a required gate.

#### 2. test-plan factual note

**File**: `context/foundation/test-plan.md`

**Intent**: One factual line in §4 (Stack, e2e row / Runtime note) recording that a local-only Playwright harness now exists for browser-level slices, explicitly NOT a required gate — the dropped-R2 decision stands. Update the §8 freshness ledger date for the touched line.

**Contract**: Minimal, additive edit — no change to §1–§3 strategy, §5 gates, or §7 exclusions beyond the factual pointer. Frame as "harness available for S-07+ flag slices; still not a CI gate."

### Success Criteria:

#### Automated Verification:

- [ ] `npm run format` (prettier) leaves the edited `.md` files clean (or formats them)
- [ ] No broken relative links in the edited docs

#### Manual Verification:

- [ ] `tests/README.md` E2E section is accurate against the shipped scripts/config
- [ ] `test-plan.md` note reads as factual and does not contradict the §7 dropped-R2 decision

**Implementation Note**: Docs-only phase; commit after review.

---

## Testing Strategy

### Unit Tests:

- None added — this change _is_ test infrastructure. Existing Vitest unit/integration/HTTP suites are untouched and must continue to pass.

### Integration / E2E Tests:

- `board-load.spec.ts` — authenticated `/dashboard` renders seeded cards in the correct columns (harness proof + exemplar).
- `delete-application.spec.ts` — real-UI delete removes the card from the board and the row from the DB (risk test).

### Manual Testing Steps:

1. `npx supabase start` (if not running) and confirm `.env.test` is populated.
2. `npm run test:e2e` — both specs pass; observe `astro dev` boot on the fixed port and shut down.
3. Confirm `.dev.vars` unchanged and `.dev.vars.e2e-backup` absent after the run.
4. Run the Phase 2 deliberate-break check and confirm the test reds, then reverts to green.
5. `npm test` — Vitest suite still green and did not run any `*.spec.ts`.

## Performance Considerations

Per-test ephemeral-user provisioning adds ~1–2s per test (provision + signin + cleanup); acceptable for a small, risk-tied suite. `astro dev` cold start on Windows can exceed 60s — the `webServer.timeout` is 120s to match `global-setup.ts`. Chromium-only keeps install and run time minimal.

## Migration Notes

None — purely additive. No schema, data, or runtime changes to the app. `.dev.vars` is mutated only transiently during a run and restored (dual-path).

## References

- Change identity: `context/changes/e2e-playwright-harness/change.md`
- Reused plumbing: `tests/global-setup.ts`, `tests/helpers/{cookies,users,seed,supabase-clients}.ts`, `scripts/e2e-session.ts`
- UI under test: `src/pages/dashboard.astro`, `src/components/board/{KanbanBoard,KanbanColumn,KanbanCard,DeleteApplicationDialog}.tsx`
- Browser playbook & gotchas: `.claude/skills/e2e-browser/SKILL.md`
- Strategy context: `context/foundation/test-plan.md` §4/§5/§7; PRD US-03/FR-006 (delete), roadmap S-07/08/09 (future flag slices)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Harness foundation + board-load exemplar

#### Automated

- [x] 1.1 `@playwright/test` present in `package.json` and `npx playwright install chromium` succeeds — a2bda16
- [x] 1.2 `npm run test:e2e` boots the app and passes `board-load.spec.ts` (chromium) green — a2bda16
- [x] 1.3 `npm run typecheck` (astro check) passes with the new spec/fixtures present — a2bda16
- [x] 1.4 `npm run lint` passes on `tests/e2e/**` — a2bda16
- [x] 1.5 `npm test` (Vitest) still runs and does not pick up `*.spec.ts` — a2bda16

#### Manual

- [x] 1.6 `.dev.vars` byte-identical to pre-run content and `.dev.vars.e2e-backup` gone after a run — a2bda16
- [x] 1.7 No leftover `astro dev` process on the E2E port; no leftover `u-<uuid>@test.local` users — a2bda16
- [x] 1.8 Wrapper refuses to run when `SUPABASE_URL` is non-local (guard fires) — a2bda16

### Phase 2: Delete-confirmation risk test

#### Automated

- [ ] 2.1 `npm run test:e2e` passes both specs (chromium) green
- [ ] 2.2 `npm run typecheck` passes
- [ ] 2.3 `npm run lint` passes on the new spec

#### Manual

- [ ] 2.4 Deliberate-break check reds the test at the DB-row assertion, then reverts to green (break never committed)
- [ ] 2.5 No orphaned rows/users after the run

### Phase 3: Docs

#### Automated

- [ ] 3.1 `npm run format` leaves the edited `.md` files clean
- [ ] 3.2 No broken relative links in the edited docs

#### Manual

- [ ] 3.3 `tests/README.md` E2E section is accurate against the shipped scripts/config
- [ ] 3.4 `test-plan.md` note is factual and does not contradict the §7 dropped-R2 decision
