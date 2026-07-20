# README Adjustments — Implementation Plan

## Overview

Rewrite `README.md` end-to-end so it documents **JobTracker** — a completed Polish-language job-application tracker — instead of the stale upstream **"10x Astro Starter"** template it was forked from. Every user-facing and technical section is brought into alignment with the actual repository state (verified in `context/changes/readme-adjustments/research.md`). The README stays a **developer/contributor-facing document in English**, while noting that the product UI is in Polish.

## Current State Analysis

`README.md` is a near-verbatim copy of the ancestor starter's README and was never re-authored after the repo was built into JobTracker. Concrete drift (all verified in research):

- **Identity**: title "10x Astro Starter", tagline "modern, opinionated starter template", hero image `./public/template.png`, clone URL `przeprogramowani/10x-astro-starter.git`. Real remote: `https://github.com/DawidNowak/JobTracker.git`; `package.json` name is `job-tracker`.
- **No product description** — nothing about the Kanban board, LinkedIn/JustJoin.it parsing, follow-up flags, notes, or archive.
- **Tech Stack** (`README.md:9-14`) lists 6 items; missing zod, shadcn/ui + Radix, `@dnd-kit`, Vitest/Playwright/Stryker.
- **Scripts** (`README.md:52-57`) omit `typecheck`, `db:push`, `db:types`, `test`, `test:watch`, `test:e2e`, `test:e2e:ui`, `e2e:session`.
- **Project Structure** (`README.md:61-71`) is a toy tree — no `pages/api/`, `lib/services/`, `lib/validation/`, `lib/parsers/`, `middleware.ts`, `supabase/migrations/`, `tests/`, `scripts/`.
- **Supabase config** (`README.md:90-93`) presents `SUPABASE_SERVICE_ROLE_KEY` in a way that reads as an app env var; it is **test/tooling-only**.
- **Auth routes** (`README.md:123-132`) omit `/api/auth/signout` and state only `/dashboard` is protected — `src/middleware.ts:4` protects `["/dashboard", "/archive"]`.
- **Testing** (`README.md:152-177`) says "Node 20+" (real: **22.14.0**, `.nvmrc`) and omits the Vitest workers pool, Playwright E2E, and Stryker.
- **CI** (`README.md:179-181`) says "runs lint + build". Reality (`.github/workflows/ci.yml`): a `ci` job runs **typecheck + lint + build**, and a separate `test` job runs **full `npm test` against a CI-provisioned local Supabase stack** — a **required merge check**.
- **Deployment** (`README.md:134-150`) is broadly correct but implies tooling that doesn't exist: there is **no `.dev.vars.example`** committed and **no `npm run deploy`** script.

**Authoritative sources for the rewrite**: `AGENTS.md` (accurate internal spec — stack, structure, commands, boundaries), `package.json`, `.github/workflows/ci.yml`, `tests/README.md`, `.nvmrc`, `src/middleware.ts`, `astro.config.mjs`, and the research doc.

## Desired End State

`README.md` reads as JobTracker's own contributor doc:

- Correct title/identity, no starter tagline, no `template.png` reference.
- A concise "What is JobTracker" paragraph + a tight feature bullet list, with an explicit note that the **product UI is in Polish** (README itself in English).
- Accurate Tech Stack, Prerequisites (Node 22.14.0), Getting Started (correct clone URL), Scripts, Project Structure, Supabase/env config, Auth routes, Testing, CI, and Deployment sections — each matching the live repo.
- No mention of unbuilt features (OAuth, AI drafts, browser extension, notifications, calendar, analytics, archive search) as if they exist.

**Verification**: `npm run format` leaves the file Prettier-clean; a manual read-through against the research "Code References" confirms no stale claim survives; every internal path/route/script named in the README exists in the repo.

### Key Discoveries:

- Real remote `https://github.com/DawidNowak/JobTracker.git`; package name `job-tracker` (`package.json:2`).
- `PROTECTED_ROUTES = ["/dashboard", "/archive"]` (`src/middleware.ts:4`).
- CI is two jobs; `test` job provisions Supabase and runs `npm test` as a required check (`.github/workflows/ci.yml:27-48`).
- Node pinned to `22.14.0` (`.nvmrc`; CI uses node 22).
- `SUPABASE_SERVICE_ROLE_KEY` is used only by tests/tooling (`tests/setup.ts:15`, `tests/helpers/supabase-clients.ts:11`, `scripts/e2e-session.ts:26`) — not an app runtime var.
- `components.json` declares a `@/hooks` alias but **no hooks folder exists** — do not document one.
- `src/pages/index.astro` still renders the starter `Welcome.astro` — `/` is not a product landing page (out of scope; the app lives at `/dashboard`).
- No `.dev.vars.example` committed; no `deploy` npm script (`package.json:5-21`).

## What We're NOT Doing

- **Not** touching any file other than `README.md` (no `src/`, no config, no deleting `public/template.png` — only removing the README's reference to it).
- **Not** fixing the starter landing page (`src/pages/index.astro` / `Welcome.astro`) — logged as a separate follow-up.
- **Not** fixing the English confirm-email copy (`src/pages/auth/confirm-email.astro`) — separate follow-up, code concern not a README concern.
- **Not** translating the README to Polish — it stays English (UI-is-Polish noted).
- **Not** documenting unbuilt/roadmap features (OAuth, AI email drafts, browser extension, notifications, calendar, analytics, archive search) as current capabilities.
- **Not** adding a real product screenshot (removing the stale one; a real hero image can come later).

## Implementation Approach

Single-pass rewrite of `README.md`, section by section, using `AGENTS.md` + `package.json` + the research doc as the source of truth. Preserve the sections of the current README that are already correct (hosted-Supabase setup flow, `astro:env` server-only secrets explanation, email-confirmation dev toggle, the general Supabase first-time-setup / `db:push` / `db:types` steps) and correct or replace the rest. Keep the tone and structure conventional for a contributor README (Features → Stack → Prereqs → Getting Started → Scripts → Structure → Config → Testing → CI → Deployment → License). Finish with `npm run format` so Prettier + the tailwind/markdown plugins normalize formatting.

## Phase 1: Full README Rewrite

### Overview

Rewrite `README.md` in one pass so every section reflects the actual JobTracker repository. Below, each change entry names the section and the corrected contract; the implementer writes the prose.

### Changes Required:

#### 1. Header / Identity

**File**: `README.md`

**Intent**: Replace the starter identity with JobTracker's, and drop the misleading starter screenshot.

**Contract**: Title becomes `# JobTracker` (or similar). Remove the `![](./public/template.png)` image line. Replace the "modern, opinionated starter template" tagline with a one-sentence description of JobTracker. Add a short note that the **product UI is in Polish** while this README is in English.

#### 2. Features section (new)

**File**: `README.md`

**Intent**: Add a concise product overview so a new reader understands what JobTracker does — the section the current README lacks entirely.

**Contract**: One-paragraph "What is JobTracker" intro + a tight bullet list of **shipped** features only: email+password auth; three-column Kanban board (Interesujące → Zaaplikowano → Rozmowa) with drag-and-drop; add postings manually or by pasting a **LinkedIn / JustJoin.it** URL that auto-parses; follow-up staleness flags per stage; per-card follow-up notes with history; edit/delete; reject → read-only archive. Do **not** list roadmap/unbuilt items as current. Optionally note it is a completed MVP.

#### 3. Tech Stack section

**File**: `README.md`

**Intent**: Correct and complete the stack list.

**Contract**: Astro 6 (SSR, `output: "server"`), React 19 islands (+ React Compiler), TypeScript 5.9 (`astro/tsconfigs/strict`, `@/*` alias), Tailwind CSS 4 (`@tailwindcss/vite`) + shadcn/ui + Radix + lucide-react, zod 4 (validation), `@dnd-kit/core` (Kanban drag-drop), Supabase (`@supabase/ssr`, Postgres + RLS), Cloudflare Workers (`@astrojs/cloudflare`, workerd — dev also runs on workerd), Vitest 3 + Playwright + Stryker (testing). Node 22.14.0.

#### 4. Prerequisites section

**File**: `README.md`

**Intent**: Fix the Node version.

**Contract**: Node.js **22.14.0** (from `.nvmrc`), npm. (Current README says nothing wrong here except it should match `.nvmrc`; the "Node 20+" error lives in the Testing section — fix both.)

#### 5. Getting Started section

**File**: `README.md`

**Intent**: Fix the clone URL and keep the install/dev steps accurate.

**Contract**: Clone URL → `https://github.com/DawidNowak/JobTracker.git`, directory `JobTracker`. Keep steps: `npm install`; configure Supabase env (link to the config section); create `.dev.vars` manually (note there is **no** `.dev.vars.example` — copy from `.env.example` or create by hand); `npm run dev` (note it runs on the Cloudflare workerd runtime).

#### 6. Available Scripts section

**File**: `README.md`

**Intent**: List the real script set from `package.json`.

**Contract**: `dev`, `build`, `preview`, `typecheck` (`astro check`), `lint`, `lint:fix`, `format`, `db:push`, `db:types`, `test`, `test:watch`, `test:e2e`, `test:e2e:ui`, `e2e:session` — each with a one-line description. Note `typecheck` is the preferred gate.

#### 7. Project Structure section

**File**: `README.md`

**Intent**: Replace the toy tree with the real (abbreviated) layout.

**Contract**: Show `src/{pages,pages/api,layouts,components/{ui,app,auth,board},lib/{services,validation,parsers},middleware.ts,types.ts}`, `supabase/migrations/`, `tests/{integration,http,unit,e2e}`, `scripts/`, and key root config (`astro.config.mjs`, `wrangler.jsonc`, `vitest.config.ts`, `playwright.config.ts`). Do **not** list a `hooks/` folder (none exists). Keep it abbreviated — representative, not exhaustive.

#### 8. Supabase Configuration section

**File**: `README.md`

**Intent**: Keep the correct hosted-Supabase flow; fix the service-role-key framing.

**Contract**: Preserve the accurate parts (hosted project, `astro:env` server-only secrets, `.env`/`.dev.vars` creation, `supabase link`, `db:push`, `db:types`, email-confirmation dev toggle). The **app** env vars are only `SUPABASE_URL` and `SUPABASE_KEY` (`.env.example` has exactly these two). Scope `SUPABASE_SERVICE_ROLE_KEY` to the **Testing** section (`.env.test` for the local stack) — do not present it as an app runtime var.

#### 9. Auth routes subsection

**File**: `README.md`

**Intent**: Correct the protected-routes claim and route list.

**Contract**: Route table keeps `/auth/signin`, `/auth/signup`, `/auth/confirm-email`, `/dashboard`; add `/archive` as a protected page. State that route protection is `PROTECTED_ROUTES` in `src/middleware.ts` and currently guards **both** `/dashboard` and `/archive`. Optionally mention the `/api/auth/{signin,signup,signout}` endpoints.

#### 10. Testing section

**File**: `README.md`

**Intent**: Replace the inaccurate testing description.

**Contract**: Node **22.14.0** (not "20+"). Frameworks: Vitest (two projects — a **node** pool for `integration/`, `http/`, `unit/`, and a **workers** pool for the LinkedIn/JustJoin.it parser tests), Playwright E2E (local-only, **not** a CI gate), Stryker mutation testing (available via `npx stryker run`, not gated). Local stack: `npx supabase start`, populate `.env.test` from `npx supabase status` with `SUPABASE_URL`/`SUPABASE_KEY`/`SUPABASE_SERVICE_ROLE_KEY` pointing at `http://127.0.0.1:54321` (runner hard-asserts local URL). Commands: `npm test`, `npm run test:watch`, `npm run test:e2e`, `npm run e2e:session`.

#### 11. CI section

**File**: `README.md`

**Intent**: Correct the CI description to the actual two-job pipeline.

**Contract**: On push/PR to `master`: a `ci` job runs **typecheck + lint + build** (build uses `SUPABASE_URL`/`SUPABASE_KEY` repo secrets), and a `test` job spins up a local Supabase stack (`npx supabase start`) and runs **`npm test`** — a **required status check** that blocks merge. Remove the "runs lint + build" / "integration tests run locally today" wording.

#### 12. Deployment section

**File**: `README.md`

**Intent**: Keep the Cloudflare Workers target; remove implied tooling that doesn't exist.

**Contract**: `npm run build` then **manual** `npx wrangler deploy` (there is no `npm run deploy` script). Set secrets via `npx wrangler secret put SUPABASE_URL` / `SUPABASE_KEY` (or the Cloudflare dashboard). Note the app runs on the workerd runtime.

#### 13. License section

**File**: `README.md`

**Intent**: Preserve.

**Contract**: Leave `## License` / `MIT` as-is unless the user indicates otherwise.

### Success Criteria:

#### Automated Verification:

- Prettier is clean: `npm run format` produces no changes to `README.md` after the rewrite (or `npx prettier --check README.md` passes).
- No reference to the removed screenshot remains: a search for `template.png` in `README.md` returns nothing.
- No stale identity remains: a search for `10x-astro-starter` / `10x Astro Starter` / `przeprogramowani` in `README.md` returns nothing.
- Every npm script named in the README exists in `package.json` (spot-check `typecheck`, `db:push`, `test:e2e`, `e2e:session`).

#### Manual Verification:

- Read-through against `research.md` "Code References": no drifted claim survives (Node version, CI two-job/required-test, `/archive` protection, service-role-key scoping, clone URL, no `.dev.vars.example`, no `deploy` script).
- Features section lists only shipped features — no OAuth/AI/extension/notifications/calendar/analytics/archive-search presented as current.
- README reads as English contributor doc with an explicit note that the product UI is Polish.
- Project Structure tree matches the real repo and omits a `hooks/` folder.

**Implementation Note**: After the rewrite and automated checks pass, pause for the human to confirm the manual read-through before considering the change complete. Phase blocks use plain bullets; the `## Progress` section below owns the checkbox state.

## Testing Strategy

### Manual Testing Steps:

1. Run `npm run format` (or `npx prettier --check README.md`) — confirm clean.
2. `grep` the README for `template.png`, `10x-astro-starter`, `10x Astro Starter`, `przeprogramowani`, `Node 20`, `lint + build` — confirm zero hits.
3. Cross-read each corrected section against the matching research "Code References" line.
4. Verify the clone URL resolves to the real repo and the Getting Started steps are followable end-to-end.

(No unit/integration tests apply — this is a documentation-only change.)

## Migration Notes

None — documentation-only. `public/template.png` remains in the repo (only its README reference is removed); deleting the asset is deferred to a future cleanup change.

## References

- Related research: `context/changes/readme-adjustments/research.md`
- Authoritative spec: `AGENTS.md`
- Scripts: `package.json:5-21`
- CI: `.github/workflows/ci.yml`
- Route protection: `src/middleware.ts:4`
- Node version: `.nvmrc`
- Testing conventions: `tests/README.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Full README Rewrite

#### Automated

- [x] 1.1 Prettier clean: `npm run format` / `npx prettier --check README.md` passes — 821a551
- [x] 1.2 No `template.png` reference remains in README — 821a551
- [x] 1.3 No stale identity (`10x-astro-starter` / `10x Astro Starter` / `przeprogramowani`) remains in README — 821a551
- [x] 1.4 Every npm script named in README exists in `package.json` — 821a551

#### Manual

- [x] 1.5 Read-through vs research "Code References" — no drifted claim survives — 821a551
- [x] 1.6 Features section lists only shipped features — 821a551
- [x] 1.7 README is English with an explicit "UI is in Polish" note — 821a551
- [x] 1.8 Project Structure tree matches the repo and omits a `hooks/` folder — 821a551
