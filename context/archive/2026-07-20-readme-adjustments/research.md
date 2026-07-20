---
date: 2026-07-20T14:33:24+02:00
researcher: Dawid Nowak
git_commit: 79d7fedc56d28a09131fc3c0d7b12e608b2410c7
branch: jobtracker-readme
repository: DawidNowak/JobTracker
topic: "Adjust README.md to actual project state"
tags: [research, codebase, readme, documentation, drift]
status: complete
last_updated: 2026-07-20
last_updated_by: Dawid Nowak
---

# Research: Adjust README.md to actual project state

**Date**: 2026-07-20T14:33:24+02:00
**Researcher**: Dawid Nowak
**Git Commit**: 79d7fedc56d28a09131fc3c0d7b12e608b2410c7
**Branch**: jobtracker-readme
**Repository**: DawidNowak/JobTracker

## Research Question

Adjust the `README.md` to the actual project state. The current README is a generic **"10x Astro Starter"** template doc; the repo is actually **JobTracker**, a completed Polish-language job-application tracker. Scope decision (confirmed with user): **full reframe** — treat the README as JobTracker's product doc (identity + features), and correct every stale technical fact (tech stack, scripts, structure, testing, CI, setup, deployment).

## Summary

The README is substantially stale — it still describes the upstream starter template it was forked from, not JobTracker. Concretely:

- **Identity is wrong.** Title "10x Astro Starter", tagline "modern, opinionated starter template", and the clone URL point at `przeprogramowani/10x-astro-starter`. The real product is **JobTracker** (`package.json` name `job-tracker`), git remote `https://github.com/DawidNowak/JobTracker.git`.
- **No product/feature description exists.** The README never mentions the Kanban board, LinkedIn/JustJoin.it parsing, the application lifecycle, follow-up flags, notes, or the archive — the entire point of the app.
- **Tech stack is under-listed.** Missing: zod (validation), shadcn/ui + Radix, `@dnd-kit` (drag-drop), Vitest + Playwright + Stryker (testing), Cloudflare-Workers-specific detail. Only 6 of the real stack items are named.
- **Scripts list is incomplete.** Missing `typecheck`, `db:push`, `db:types`, `test`, `test:watch`, `test:e2e`, `test:e2e:ui`, `e2e:session`.
- **Project Structure is a toy tree.** Real layout has `pages/api/`, `lib/services/`, `lib/validation/`, `lib/parsers/`, `middleware.ts`, `supabase/migrations/`, `tests/`, `scripts/` — none shown.
- **Testing section is wrong.** Says "Node 20+" (real: **22.14.0**) and omits the workers pool, Playwright, and Stryker.
- **CI section is wrong.** Says "GitHub Actions runs lint + build". Reality: CI runs **typecheck + lint + build** in one job **and** a separate **`test` job that runs full `npm test` against a CI-provisioned local Supabase stack**, which is a **required merge check**.
- **Setup details drift.** `SUPABASE_SERVICE_ROLE_KEY` is presented in the env table but is **test/tooling-only** (not an app env var). `PROTECTED_ROUTES` now also protects `/archive`. No `.dev.vars.example` is committed. There is no `npm run deploy` script. `/api/auth/signout` endpoint is omitted.
- A few claims **are** correct and should be preserved: hosted Supabase, `astro:env` server-only secrets for `SUPABASE_URL`/`SUPABASE_KEY`, the `/auth/signin|signup|confirm-email` routes, email-confirmation flow, and Cloudflare Workers as the deploy target.

## Detailed Findings

### Product identity & features (full reframe input)

**What JobTracker is:** a Polish-language, single-user-per-account job-application tracker. A job seeker captures postings — by pasting a **LinkedIn or JustJoin.it URL** that auto-fills the form via a server-side HTML parser, or by typing fields manually — and organizes them on a **three-column Kanban board** (Interesujące → Zaaplikowano → Rozmowa). Its wedge feature is a **proactive follow-up layer**: on each board load it computes which cards have gone stale past a stage-specific threshold and flags them. Rejected applications move to a read-only **archive** with full note history. It is a **completed MVP** — all 11 roadmap slices + foundation are `done`.

Shipped features (each verified in live code):

- **Auth** — email+password sign-in/up/out; `src/pages/api/auth/{signin,signup,signout}.ts`, UI `src/pages/auth/{signin,signup,confirm-email}.astro`.
- **Route protection** — `src/middleware.ts:4` `PROTECTED_ROUTES = ["/dashboard", "/archive"]`, redirect at `:18-22`; per-user isolation via Supabase RLS.
- **Kanban board (3 columns)** — `src/pages/dashboard.astro:12-16`; islands `KanbanBoard.tsx`, `KanbanColumn.tsx`; drag-drop via dnd-kit `KanbanCard.tsx:70-74`.
- **Add application (manual + parser)** — `AddApplicationDialog.tsx`, `ApplicationForm.tsx`; create `src/pages/api/applications/index.ts`; URL recognition `src/lib/parsers/recognize.ts:18,30`; LinkedIn parser `linkedin.ts:35-37`; JustJoin.it parser `justjoinit.ts`; parse endpoint `src/pages/api/applications/parse.ts:22-27`.
- **Edit / delete** — `EditApplicationDialog.tsx` + `src/pages/api/applications/[id].ts`; `DeleteApplicationDialog.tsx`.
- **Follow-up recommendation layer** — Interesujące 1-day decision prompt `KanbanCard.tsx:233`; Zaaplikowano 7-day flag `:28-32`; Rozmowa 4-**business-day** flag `:33-36`; staleness computed from `last_action_at`, not persisted (`:138-139`).
- **Notes & card detail** — `CardDetailDialog.tsx`, `CardNotes.tsx`; endpoints `src/pages/api/applications/[id]/notes/index.ts` and `notes/[noteId].ts`.
- **Reject → Archive** — `RejectApplicationDialog.tsx`, archive endpoint `src/pages/api/applications/[id]/archive.ts`; list `src/pages/archive.astro`; read-only detail `src/pages/archive/[id].astro` (guarded to `row?.archived_at`, 404 otherwise).

Planned but **NOT** built (keep out of the README, or list as explicit non-goals): Google/any OAuth (MVP reversed to email+password on 2026-05-25, `prd.md:103`), AI-generated follow-up email drafts (`prd.md:184`), browser extension (`:185`), email/push notifications (`:186`), calendar integration (`:187`), profile/job-match scoring (`:188`), analytics/charts (`:189`), archive search/filter/sort (`:190`), public-holiday awareness (`roadmap.md:251`), additional portals beyond LinkedIn/JustJoin.it.

**UI language: Polish (confirmed).** e.g. nav `"Tablica"`/`"Archiwum"`/`"Wyloguj"` `AppNav.astro:20-30`; flag `"Czas na follow-up z rekruterem"` `KanbanCard.tsx:31`; API error `"Nieobsługiwany portal. Wypełnij dane ręcznie."` `parse.ts:23`.

> **Caveat for the rewrite:** `src/pages/index.astro` still renders the **unmodified starter** `Welcome.astro` (cosmic/starfield placeholder). The public root is not a product landing page; the real app lives at `/dashboard`. Don't describe `/` as a landing page.

### Tech stack (corrected)

Real stack (from `package.json`, `astro.config.mjs`, config files):

- Astro 6 SSR (`output: "server"`, `astro.config.mjs`), React 19 islands (+ React Compiler, enforced by eslint), TypeScript 5.9 (`astro/tsconfigs/strict`, `@/*` alias).
- Tailwind CSS 4 via `@tailwindcss/vite` (no `tailwind.config`), **shadcn/ui** (new-york, `components.json`) + **Radix UI** + lucide-react.
- **zod 4** — input validation (`src/lib/validation/applications.ts`).
- **`@dnd-kit/core`** — Kanban drag-and-drop.
- Supabase (`@supabase/ssr`) — cookie auth + Postgres with RLS.
- Cloudflare Workers (`@astrojs/cloudflare`, workerd) — deploy target; `dev` also runs on workerd.
- **Testing**: Vitest 3 (node + workers pools), Playwright (local E2E), Stryker (mutation testing).
- `html-rewriter-wasm` — used by parsers/tests for `HTMLRewriter`.
- Node **22.14.0** (`.nvmrc`).

### Available scripts (corrected — from `package.json:5-21`)

Missing from README: `typecheck` (`astro check`), `db:push`, `db:types`, `test` (`vitest run`), `test:watch`, `test:e2e`, `test:e2e:ui`, `e2e:session`. Present-and-listed: `dev`, `build`, `preview`, `lint`, `lint:fix`, `format`.

### Project structure (corrected — actual tree)

- `src/layouts/` — `AppShell.astro`, `Layout.astro`
- `src/pages/` — `index.astro`, `dashboard.astro`, `archive.astro`, `archive/[id].astro`, `auth/{signin,signup,confirm-email}.astro`
- `src/pages/api/` — `applications/index.ts`, `applications/[id].ts`, `applications/[id]/archive.ts`, `applications/[id]/notes/index.ts`, `applications/[id]/notes/[noteId].ts`, `applications/parse.ts`, `auth/{signin,signout,signup}.ts`
- `src/components/` — root `.astro` (`Banner`, `Topbar`, `Welcome`); `app/AppNav.astro`; `auth/*` (6 files); `board/*` (11 files incl. `KanbanBoard.tsx`, `ReadOnlyNotesList.astro`); `ui/*` (shadcn)
- `src/lib/` — `supabase.ts`, `http.ts`, `utils.ts`, `database.types.ts`, `config-status.ts`, `format.ts`; `services/{applications,notes}.ts`; `validation/applications.ts`; `parsers/{justjoinit,linkedin,recognize,status,types}.ts` + `html-rewriter.d.ts`
- `src/` top-level — `middleware.ts`, `types.ts`, `env.d.ts`, `styles/global.css`
- `supabase/` — `config.toml`, `migrations/` (4 files: `20260526123145_applications_schema.sql`, `20260526132205_harden_application_notes_rls.sql`, `20260528153903_lock_trigger_function_search_path.sql`, `20260528154840_drop_redundant_user_id_index.sql`)
- `tests/` — `integration/`, `http/`, `unit/` (incl. `unit/parsers/`), `e2e/`, plus `helpers/`, `fixtures/`, setup files
- `scripts/` — `e2e-session.ts`, `e2e-webserver.ts`
- Root config — `astro.config.mjs`, `wrangler.jsonc` (+ `wrangler.test.jsonc`), `tsconfig.json`, `eslint.config.js`, `playwright.config.ts`, `vitest.config.ts` (+ `vitest.stryker.config.ts`), `stryker.config.json`, `components.json`, `.nvmrc`, `.env.example`

> **Caveat:** `components.json` declares a `@/hooks` alias, but **no `src/components/hooks/` or `src/hooks/` directory exists**. AGENTS.md/CLAUDE.md mention `src/components/hooks/` — don't claim a hooks folder in the README.

### Testing (corrected)

- **Vitest**, two projects in `vitest.config.ts`: **node pool** (`:16-21`, environment `node`, includes `tests/integration/**`, `tests/http/**`, `tests/unit/**`) and **workers pool** (`:23-34`, `defineWorkersProject`, workerd, includes only the two parser tests `linkedin.test.ts`/`justjoinit.test.ts`, uses `wrangler.test.jsonc`).
- **Playwright** E2E — `playwright.config.ts` (`testDir: tests/e2e`, chromium, port 4331, webServer `tsx scripts/e2e-webserver.ts`). **Not a CI gate** (`tests/README.md:92`).
- **Stryker** mutation testing — `stryker.config.json` + `vitest.stryker.config.ts`. Present but **no npm script and not in CI**; run manually via `npx stryker run`.
- **Node version** — `.nvmrc` = **22.14.0** (README's "Node 20+" is wrong; CI pins node 22).
- **`.env.test` hard-assert** — `tests/setup.ts` (node pool): requires `SUPABASE_URL`/`SUPABASE_KEY`/`SUPABASE_SERVICE_ROLE_KEY`; `ALLOWED_PREFIXES = ["http://127.0.0.1:54321", "http://localhost:54321"]` (`:5`), throws if `SUPABASE_URL` doesn't match (`:17-21`).
- tests/ layout: `integration/` = PostgREST-level RLS (RLS is the SUT), `http/` = HTTP smoke via `fetch` against `astro dev`, `unit/parsers/` = parser tests (workers) + `recognize()` classifier (node), `e2e/` = local-only Playwright.

### CI (corrected — `.github/workflows/ci.yml`)

Triggers on push and PR to `master` (`:3-7`). **Two jobs:**

- **`ci`** (`:10-25`): `npm ci` → `npx astro sync` → **`npm run typecheck`** (`:20`) → `npm run lint` (`:21`) → `npm run build` (`:22`); build gets `SUPABASE_URL`/`SUPABASE_KEY` from repo secrets (`:23-25`).
- **`test`** (`:27-48`): `npm ci` → `npx astro sync` → **`npx supabase start`** (`:37`) → generate `.env.test` from `npx supabase status -o env` (`:38-44`) → **`npm test`** (`:45`) → `npx supabase stop` on `always()` (`:46-48`). No secrets needed (local stack uses well-known demo JWTs).

So the correct statement is: **CI runs typecheck + lint + build, plus a full `npm test` against a CI-provisioned local Supabase stack**, and `npm test` is a **required status check** that blocks merge.

### Setup / env / auth / deployment (corrected)

- **Env vars** — `.env.example` has exactly two: `SUPABASE_URL`, `SUPABASE_KEY`. Declared in `astro.config.mjs:19-20` via `envField.string({ context: "server", access: "secret", optional: true })`, consumed in `src/lib/supabase.ts:3` from `astro:env/server`. The `astro:env` claim is **correct**. `SUPABASE_SERVICE_ROLE_KEY` is **NOT** an app env var — it's test/tooling only (`tests/helpers/supabase-clients.ts:11`, `tests/setup.ts:15`, `scripts/e2e-session.ts:26`); scope it to `.env.test`, not the main env table.
- **Clone URL** — real remote is `https://github.com/DawidNowak/JobTracker.git` (README's `przeprogramowani/10x-astro-starter.git` is the upstream starter, wrong).
- **Auth routes** — `/auth/signin`, `/auth/signup`, `/auth/confirm-email` exist (correct). Also `/api/auth/signout` (README omits). `/dashboard` is a page, not an auth route.
- **PROTECTED_ROUTES** — `src/middleware.ts:4` = `["/dashboard", "/archive"]`. **`/archive` is now also protected** (README implies only `/dashboard`).
- **Email confirmation** — still exists; `src/pages/api/auth/signup.ts:19` redirects to `/auth/confirm-email`, which branches on `import.meta.env.DEV` (dev: "you can now sign in"; prod: "check your email"). (Note: confirm-email copy is currently **English**, an existing code inconsistency vs the Polish mandate — not a README concern, but flagged.)
- **Deployment** — Cloudflare Workers (`astro.config.mjs:16` `adapter: cloudflare()`, `wrangler.jsonc` name `job-tracker`, `nodejs_compat`, assets from `./dist`). **No `.dev.vars.example` committed** — user must create `.dev.vars` manually. **No `npm run deploy` script** — deploy is manual `npx wrangler deploy`; secrets via `npx wrangler secret put SUPABASE_URL|SUPABASE_KEY`.

## Code References

- `package.json:2` — name `job-tracker` (not "10x-astro-starter")
- `package.json:5-21` — full scripts list (typecheck, db:_, test:_, e2e:session missing from README)
- `README.md:1-5` — stale title/tagline/template image
- `README.md:26` — wrong clone URL
- `README.md:52-57` — incomplete scripts list
- `README.md:61-71` — toy project-structure tree
- `README.md:90-93` — env table wrongly includes service-role framing context
- `README.md:154` — "Node 20+" (should be 22.14.0)
- `README.md:181` — "GitHub Actions runs lint + build" (should be typecheck+lint+build + test job)
- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/archive"]`
- `src/lib/supabase.ts:3` — `astro:env/server` import of `SUPABASE_URL`/`SUPABASE_KEY`
- `astro.config.mjs:11,16,19-20` — `output: "server"`, cloudflare adapter, env schema
- `.github/workflows/ci.yml:20-22,37,45` — typecheck/lint/build + supabase start + npm test
- `.nvmrc` — `22.14.0`
- `tests/setup.ts:5,17-21` — local-stack URL hard-assert
- `src/pages/index.astro` / `src/components/Welcome.astro` — still the starter placeholder

## Architecture Insights

- The repo is a **fork of the `10x-astro-starter`** that was built out into a full app; the README was never re-authored, so it still reflects the ancestor. AGENTS.md/CLAUDE.md are the _accurate_ current spec — the README should be brought into alignment with them (they're the source of truth for stack, structure, boundaries).
- **AGENTS.md is the authoritative internal spec** and already contains correct, concise descriptions of tech stack, commands, structure, testing, and boundaries. The README rewrite can lean on AGENTS.md for accuracy but should stay **user/contributor-facing** (setup, run, deploy, feature overview) rather than duplicating the agent-oriented boundaries.
- Two documentation audiences: **README** = humans onboarding/running/deploying; **AGENTS.md/CLAUDE.md** = agents. Keep the README from drifting into agent-rule territory.
- The app is **workerd-first** (dev and prod both run on the Cloudflare runtime, not plain Node) — a nuance worth stating so contributors don't assume `node`-only behavior.

## Historical Context (from prior changes)

- `context/foundation/prd.md:103` — OAuth-only plan **reversed to email+password** on 2026-05-25; README must reflect email+password, and the "Google OAuth planned" memory ([[project_auth_state]]) matches: shipped = email+password, OAuth = future.
- `context/foundation/prd.md:182-191` — Non-Goals list (the "planned but not built" set above).
- `context/foundation/roadmap.md:34-46,256-267` — all slices `done` (completed MVP).
- Recent git history (archive-view, reject-to-archive, followup-flag branches) confirms the archive + follow-up features are shipped and merged.

## Related Research

- `context/foundation/jobtracker-followup-research.md` — prior research on the follow-up feature.
- No prior `research.md` under `context/changes/**` or `context/archive/**` covers the README specifically; this is the first.

## Open Questions

1. **Starter landing page (`/`)** — the public root still renders the starter `Welcome.astro`. Should the README (a) ignore `/` and document `/dashboard` as the entry, or (b) should this be flagged as a cleanup task outside the README change? (Recommend: README documents `/dashboard`; note `/` placeholder as out-of-scope.)
2. **Depth of feature section** — full feature walkthrough vs. a concise "Features" bullet list. (Recommend concise bullets + a one-paragraph "What is JobTracker".)
3. **`template.png` image** — `public/template.png` is the starter screenshot. Replace with a JobTracker screenshot, drop the image, or leave a TODO? (Planning decision.)
4. **Polish vs English README** — AGENTS.md mandates Polish _UI copy_, but the README is developer-facing and currently English. Keep README in English (recommended) unless the user wants Polish.
