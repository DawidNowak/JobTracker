# Project Spec: JobTracker

## Objective

Job tracking application: capture job postings (including scraping/parsing from LinkedIn and JustJoin.it), organize them on a Kanban board, and move them through an application lifecycle. UI copy is in **Polish** — match existing wording in user-facing strings and error messages.

## Boundaries

- ✅ **Always**: export `const prerender = false` from every API route · validate inputs with zod · use `cn()` for class merging · use the `@/*` alias · reach for React **only** when browser events, state, or hooks are required (strict island architecture — no React for static content) · give every new Supabase table RLS with **separate** SELECT/INSERT/UPDATE/DELETE policies per role (`anon`, `authenticated`) using `auth.uid()` or an explicit role clause, defined in the table's migration.
- ⚠️ **Ask first**: database schema / migration changes · adding dependencies · changing CI config (`.github/workflows/`) or `wrangler.jsonc` · touching `src/components/ui/` (keep shadcn files as upstream ships them so future installs diff-merge cleanly).
- 🚫 **Never**: commit secrets — `SUPABASE_URL`, `SUPABASE_KEY` are **server-only** (never in client code or responses), and `SUPABASE_SERVICE_ROLE_KEY` must never land in a tracked file · use `USING (true)` in an RLS policy · mock the Supabase client in tests (RLS is the SUT) · assert through `src/lib/services/` in RLS tests (assert at the PostgREST row level) · use Next.js directives (`"use client"` / `"use server"`) in authored code · use `.env` for Cloudflare dev secrets (use `.dev.vars`).

## Tech Stack

- **Astro 6** (SSR, `output: "server"`)
- **React 19** — interactive islands only (see island rule under Boundaries)
- **TypeScript 5.9** — `astro/tsconfigs/strict`, `@/*` path alias → `src/*`
- **Tailwind CSS 4** (`@tailwindcss/vite`) + **shadcn/ui** (new-york variant) + Radix UI + lucide-react
- **Supabase** (`@supabase/ssr`) — cookie-based auth sessions + Postgres with RLS
- **zod 4** — all API input validation
- **Cloudflare Workers** (`@astrojs/cloudflare`, workerd runtime) — deploy target; `dev` also runs on workerd
- **Vitest 3** + **Playwright** — integration/unit tests + local-only E2E
- Node **v22.14.0** (`.nvmrc`); tooling via `.env`, Cloudflare dev via `.dev.vars`

Full dependency list: see `@package.json`.

## Commands

- Dev server: `npm run dev` (Astro on the Cloudflare **workerd** runtime, not plain Node)
- Build: `npm run build`
- Preview: `npm run preview`
- **Typecheck (preferred gate): `npm run typecheck`** (`astro check` — catches narrowing errors `build` misses)
- Lint (CI gate — must pass before merge): `npm run lint` (`eslint .`)
- Lint autofix: `npm run lint:fix`
- Format: `npm run format` (`prettier --write .`)
- DB migrate: `npm run db:push` (`supabase db push`)
- DB types: `npm run db:types` (regenerates `src/lib/database.types.ts` from the linked schema)

**Definition of done** — before proposing a change as complete, run: `npm run typecheck && npm run lint && npm test` (all green).

Setup and deployment steps: see `@README.md`.

## Testing

Framework is **Vitest** (integration + unit); **Playwright** for local-only E2E. Full conventions: `@tests/README.md`.

- Run tests: `npm test` (single run) · `npm run test:watch` (watch)
- Run E2E: `npm run test:e2e` (headless) · `npm run test:e2e:ui` (interactive)
- E2E browser session helper: `npm run e2e:session` (provisions an ephemeral user, prints cookies)

Where things live and how they run:

- `tests/integration/` — PostgREST-level RLS suites (no HTTP). **RLS is the system under test.**
- `tests/http/` — HTTP smoke suite; drives `astro dev` via `fetch`.
- `tests/unit/parsers/` — parser unit tests (**workers** pool, needs `HTMLRewriter`) + `recognize()` classifier (**node** pool).
- `tests/e2e/` — Playwright, browser-only risks. **Not a CI gate**; do not run concurrently with `npm test`.
- `.env.test` (git-ignored) must point at the **local** stack (`http://127.0.0.1:54321`); the runner hard-asserts this. Start it with `npx supabase start`, populate from `npx supabase status`.
- CI runs `npm test` (both pools) as a required check on push/PR to `master`; the local Supabase stack is provisioned in-job. See `@.github/workflows/ci.yml`.

## Project Structure

- `src/pages/` — Astro pages (SSR); `src/pages/api/` — API endpoints (`GET`, `POST`, … handlers)
- `src/layouts/` — Astro layouts
- `src/components/ui/` — shadcn/ui components (keep as upstream ships them); `src/components/{app,auth,board}/` — feature components; `src/components/hooks/` — React hooks
- `src/lib/` — **pure utilities only** (no Supabase, no domain logic); `src/lib/services/` — Supabase queries + domain orchestration
- `src/lib/validation/` — zod schemas · `src/lib/parsers/` — job-posting HTML parsers · `src/lib/supabase.ts` — SSR client · `src/lib/http.ts` — `jsonResponse` + error formatting
- `src/middleware.ts` — resolves auth user on every request; `PROTECTED_ROUTES` array gates auth
- `src/types.ts` — shared entity + DTO types
- `supabase/migrations/` — SQL migrations named `YYYYMMDDHHmmss_short_description.sql`
- `tests/` — see Testing above

## Code Style

- Internal imports **always** use the `@/*` alias — never relative deep paths.
- Merge Tailwind classes **only** via `cn()` from `@/lib/utils` — never concatenate class strings, and never use Astro's `class:list` (no `tailwind-merge` conflict resolution). Applies inside `.astro` too.
- API routes: `export const prerender = false`, uppercase handler names, zod-validated input, JSON via `@/lib/http` helpers, Polish error copy. Representative route: `@src/pages/api/applications/index.ts`.
- Formatting is enforced by Prettier (with `prettier-plugin-astro` + `prettier-plugin-tailwindcss`); don't hand-format.

## Git Workflow

- Main branch: `master`. Work on feature branches (e.g. `jobtracker-reject-to-archive`); never commit directly to `master`.
- **Conventional Commits**, scoped by change-id: `type(change-id): summary` — e.g. `feat(zaaplikowano-followup-flag): Follow-up Flag + Button`. Common types in history: `feat`, `fix`, `test`, `docs`, `chore`.
- Pre-commit hooks (husky + lint-staged) auto-run on staged files: `eslint --fix` on `*.{ts,tsx,astro}`, `vitest related --run` on `*.{ts,tsx}`, `prettier --write` on `*.{json,css,md}`.
- CI runs lint + build + `npm test` on every push/PR to `master`; `npm test` is a **required status check** — a red suite blocks merge.
