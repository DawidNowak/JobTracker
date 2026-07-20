# JobTracker

JobTracker is a Polish-language job-application tracker: capture postings — by pasting a LinkedIn or JustJoin.it URL that auto-parses the details, or by typing them in manually — and move them across a Kanban board as your applications progress.

> The product UI is in Polish. This README (setup, development, deployment) is in English.

## Features

JobTracker is a completed MVP for tracking a job search end-to-end:

- **Email + password auth** — sign up, sign in, sign out.
- **Three-column Kanban board** — Interesujące → Zaaplikowano → Rozmowa, with drag-and-drop to move cards between stages.
- **Add postings two ways** — paste a LinkedIn or JustJoin.it URL to auto-parse the posting, or fill in the form manually.
- **Follow-up staleness flags** — each stage has its own threshold; cards that have gone stale are flagged so nothing falls through the cracks.
- **Notes with history** — per-card follow-up notes you can add over time.
- **Edit / delete** applications.
- **Reject → Archive** — rejected applications move to a read-only archive that preserves their note history.

## Tech Stack

- [Astro](https://astro.build/) v6 - server-first SSR (`output: "server"`)
- [React](https://react.dev/) v19 - interactive islands (React Compiler enabled)
- [TypeScript](https://www.typescriptlang.org/) v5.9 - `astro/tsconfigs/strict`, `@/*` path alias
- [Tailwind CSS](https://tailwindcss.com/) v4 (`@tailwindcss/vite`) + [shadcn/ui](https://ui.shadcn.com/) (new-york) + [Radix UI](https://www.radix-ui.com/) + lucide-react
- [zod](https://zod.dev/) v4 - input validation for all API routes
- [`@dnd-kit/core`](https://dndkit.com/) - Kanban board drag-and-drop
- [Supabase](https://supabase.com/) (`@supabase/ssr`) - cookie-based auth sessions + Postgres with RLS
- [Cloudflare Workers](https://workers.cloudflare.com/) (`@astrojs/cloudflare`, workerd runtime) - deploy target; `dev` also runs on workerd
- [Vitest](https://vitest.dev/) v3 + [Playwright](https://playwright.dev/) + [Stryker](https://stryker-mutator.io/) - testing

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/DawidNowak/JobTracker.git
cd JobTracker
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets (there is no `.dev.vars.example` committed — copy from `.env.example` or create it by hand):

```bash
cp .env.example .dev.vars
```

5. Run the development server (runs on the Cloudflare workerd runtime, not plain Node):

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run typecheck` - Run `astro check` (preferred correctness gate — catches narrowing errors `build` misses)
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run db:push` - Apply `supabase/migrations/*.sql` to the linked Supabase project
- `npm run db:types` - Regenerate `src/lib/database.types.ts` from the linked schema
- `npm test` - Run the Vitest suite once
- `npm run test:watch` - Run the Vitest suite in watch mode
- `npm run test:e2e` - Run Playwright E2E tests headlessly
- `npm run test:e2e:ui` - Run Playwright E2E tests in interactive UI mode
- `npm run e2e:session` - Provision an ephemeral E2E user and print session cookies

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages (SSR)
│ │ └── api/ # API endpoints (applications, notes, auth)
│ ├── components/
│ │ ├── ui/ # shadcn/ui components
│ │ ├── app/ # app-shell components (nav, etc.)
│ │ ├── auth/ # auth forms
│ │ └── board/ # Kanban board components (React islands)
│ ├── lib/
│ │ ├── services/ # Supabase queries + domain orchestration
│ │ ├── validation/ # zod schemas
│ │ └── parsers/ # LinkedIn / JustJoin.it HTML parsers
│ ├── middleware.ts # resolves auth user, gates PROTECTED_ROUTES
│ └── types.ts # shared entity + DTO types
├── supabase/
│ └── migrations/ # SQL migrations
├── tests/
│ ├── integration/ # PostgREST-level RLS suites
│ ├── http/ # HTTP smoke suite (astro dev via fetch)
│ ├── unit/ # parser + classifier unit tests
│ └── e2e/ # Playwright, browser-only risks
├── scripts/ # e2e-session.ts, e2e-webserver.ts
├── astro.config.mjs
├── wrangler.jsonc # Cloudflare Workers config
├── vitest.config.ts
└── playwright.config.ts
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication and data. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup

This project uses a hosted Supabase project. Create one at [supabase.com](https://supabase.com/) (or get the project ref from an existing one), then:

1. Create your `.env` and `.dev.vars` files:

```bash
cp .env.example .env
cp .env.example .dev.vars
```

2. Fill in the Supabase credentials in both files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

These are the only two app runtime env vars (`.env.example`). `SUPABASE_SERVICE_ROLE_KEY` is **not** an app variable — it's used only by the test suite; see [Testing](#testing).

3. Link the Supabase CLI to your project (one-time, required before `db:push` / `db:types` work):

```bash
npx supabase link --project-ref <project-ref>
```

4. Apply the committed migrations and regenerate types:

```bash
npm run db:push    # applies supabase/migrations/*.sql to your linked project
npm run db:types   # regenerates src/lib/database.types.ts from the linked schema
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                               |
| `/auth/signup`        | Email/password sign-up form                                               |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                       |
| `/dashboard`          | Kanban board (protected — redirects to `/auth/signin` if unauthenticated) |
| `/archive`            | Read-only archive of rejected applications (protected)                    |

Route protection is handled in `src/middleware.ts`: the `PROTECTED_ROUTES` array currently guards `/dashboard` and `/archive`. Sign-in/up/out are also exposed as API endpoints: `/api/auth/signin`, `/api/auth/signup`, `/api/auth/signout`.

## Testing

Framework is Vitest (integration + unit) and Playwright (local-only E2E); full conventions in `tests/README.md`. Requires Node **22.14.0** (`.nvmrc`).

Vitest runs two projects:

- a **node** pool for `tests/integration/` (PostgREST-level RLS suites), `tests/http/` (HTTP smoke against `astro dev`), and `tests/unit/`
- a **workers** pool (needs `HTMLRewriter`) for the LinkedIn/JustJoin.it parser tests

Stryker mutation testing is configured (`stryker.config.json`) but has no npm script and isn't part of CI — run it manually with `npx stryker run`.

### Prerequisites

```bash
npx supabase start   # start the local stack (first run downloads Docker images)
```

### Environment setup

```bash
cp .env.example .env.test
# fill in the three test values from:
npx supabase status
```

The `.env.test` file needs `SUPABASE_URL`, `SUPABASE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` pointing at `http://127.0.0.1:54321`. The test runner hard-asserts this before constructing any client — pointing `.env.test` at a remote URL is rejected immediately.

### Commands

```bash
npm test             # single run (both Vitest pools)
npm run test:watch   # watch mode
npm run test:e2e     # Playwright E2E, headless (local-only, not a CI gate)
npm run test:e2e:ui  # Playwright E2E, interactive UI mode
npm run e2e:session  # provision an ephemeral E2E user, print session cookies
```

## CI

On every push and PR to `master`, GitHub Actions runs two jobs (`.github/workflows/ci.yml`):

- **`ci`** — `npm run typecheck` → `npm run lint` → `npm run build` (build uses `SUPABASE_URL`/`SUPABASE_KEY` repository secrets).
- **`test`** — provisions a local Supabase stack (`npx supabase start`) and runs `npm test` against it. This job is a **required status check** — a red suite blocks merge.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/) (workerd runtime).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler (there is no `npm run deploy` script — deploy manually):

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put SUPABASE_URL` / `npx wrangler secret put SUPABASE_KEY`.

## License

MIT
