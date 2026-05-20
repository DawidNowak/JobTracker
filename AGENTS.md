# Repository Guidelines

Job tracking application built with Astro 6 SSR, React 19, Tailwind CSS 4, Supabase auth (cookie-based sessions), and shadcn/ui. Deployed to Cloudflare Workers.

## Hard Rules

- API routes **must** export `const prerender = false`; all other pages are SSR by default (`output: "server"`).
- Use `cn()` from `@/lib/utils` for all class name merging — never concatenate Tailwind class strings manually.
- We enforce strict island architecture: React components are only permitted when browser events, state, or hooks are required. Do not default to React for static content.
- Do not use Next.js-style directives (`"use client"`, `"use server"`).
- Every new Supabase table must have RLS enabled with separate SELECT, INSERT, UPDATE, and DELETE policies for each relevant role (`anon`, `authenticated`), each using `auth.uid()` or an explicit role clause — never `USING (true)`. Define all policies in the table's migration file.
- Validate all API route inputs with zod; export uppercase handler names (`GET`, `POST`, etc.).
- No test framework is configured — do not scaffold tests. See `@.github/workflows/ci.yml` for the full pipeline. See `@README.md` → CI section for secrets setup.
- `SUPABASE_URL` and `SUPABASE_KEY` are server-only secrets — never reference them in client-side code or expose them in responses. Use `.dev.vars` for local Cloudflare dev (not `.env`). Copy `.env.example` for Node-only tooling.

## Project Structure

- `src/pages/` — Astro pages; `src/pages/api/` for API endpoints
- `src/components/ui/` — shadcn/ui components (new-york variant);
- `src/components/hooks/` — React hooks
- `src/lib/` — pure utility functions only (no Supabase calls, no domain logic); `src/lib/services/` — functions that query Supabase or orchestrate domain operations
- `src/lib/supabase.ts` — Supabase SSR client
- `src/middleware.ts` — resolves auth user on every request; lists `PROTECTED_ROUTES`
- `src/types.ts` — shared entity and DTO types
- `supabase/migrations/` — migrations named `YYYYMMDDHHmmss_short_description.sql`

## Commands

See `@package.json` for the full script list. Key context:
- `dev` runs under the Cloudflare workerd runtime (not standard Node)
- `lint` is the CI gate — must pass before merge
- Pre-commit hooks (husky + lint-staged) auto-run `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on `*.{json,css,md}`

## Coding Conventions

- Always use the `@/*` path alias for internal imports (mapping defined in `@tsconfig.json`).
- For getting-started and deployment steps, see `@README.md`.