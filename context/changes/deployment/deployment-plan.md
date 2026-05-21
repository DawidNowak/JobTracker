# Cloudflare Workers Integration & Deployment Plan

## Context

The JobTracker project is an Astro 6 SSR app with Supabase auth. The `@astrojs/cloudflare` adapter, `wrangler.jsonc`, and `nodejs_compat` flag are already wired. The project is ~85% ready for a live Cloudflare Workers deployment — what remains is: renaming the Worker, wiring secrets, a manual first deploy, and adding a CI auto-deploy step. This plan also covers every known edge-case risk from `context/foundation/infrastructure.md`.

---

## Phase 0 — Prerequisites & CLI Setup

> **Current state** (verified 2026-05-21):
> - Node.js v24.15.0 ✅ | npm 11.12.1 ✅
> - Wrangler: `package-lock.json` resolves to `4.93.0` but `node_modules` contains `3.107.3` — stale install
> - Supabase CLI: `2.98.2` installed, minor update available (`2.100.1`)
> - `.dev.vars`: already present with real Supabase credentials ✅
> - Wrangler auth: **not logged in**
> - Supabase CLI auth: **not logged in**

- [x] **0.1** Sync dependencies — node_modules is stale (wrangler 3.x installed, lock file pins 4.93.0):
  ```
  npm ci
  ```
  Verify after: `npx wrangler --version` should print `4.93.x`

- [x] **0.2** Authenticate Wrangler with your Cloudflare account (browser OAuth):
  ```
  npx wrangler login
  ```
  A browser tab opens → log in → grant access. Confirm with:
  ```
  npx wrangler whoami
  ```
  Expected: `You are logged in with an OAuth Token, associated with the email <your@email>.`

  > **Edge case — no browser / headless env**: use an API token instead:
  > ```
  > set CLOUDFLARE_API_TOKEN=<your-token>
  > npx wrangler whoami
  > ```
  > The token must have `Workers Scripts:Edit` + `Account:Read` permissions.

- [x] **0.3** Authenticate Supabase CLI (needed for region checks and project management):
  ```
  npx supabase login
  ```
  Paste your Supabase personal access token when prompted (dashboard → Account → Access Tokens).
  Confirm with:
  ```
  npx supabase projects list
  ```
  Expected: a table listing your Supabase projects with their regions.

  > **Note**: `.dev.vars` already holds `SUPABASE_URL` and `SUPABASE_KEY` for local Cloudflare dev — those are separate from the CLI login. The CLI login is only needed for management commands (region checks, migrations, etc.).

- [x] **0.4** Optional — update Supabase CLI to latest (`2.100.1`):
  ```
  npm install --save-dev supabase@latest
  ```
  Not blocking; current version works fine.

---

## Phase 1 — Local Config Fixes
> Changes to committed files before any deploy happens.

- [x] **1.1** Rename Worker: edit `wrangler.jsonc`, change `"name"` from `"10x-astro-starter"` → `"job-tracker"`
  - File: `wrangler.jsonc`
  - This becomes the `workers.dev` subdomain and Worker identity in the dashboard.

- [x] **1.2** Rename `package.json` project name from `"10x-astro-starter"` → `"job-tracker"` (cosmetic, avoids confusion)
  - File: `package.json`

- [x] **1.3** Commit both changes on `master` with message: `chore: rename worker and package to job-tracker`

---

## Phase 2 — Local Workerd Smoke Test
> Run the production-faithful runtime locally **before** touching any cloud resources.
> Use `wrangler dev`, NOT `npm run dev` — they use different runtimes (workerd vs Node.js).

- [x] **2.1** Create `.dev.vars` at project root (git-ignored) with real Supabase credentials:
  ```
  SUPABASE_URL=https://<your-project>.supabase.co
  SUPABASE_KEY=<your-anon-key>
  ```
  (Copy from Supabase dashboard → Settings → API)

- [x] **2.2** Run `npm run build && npx wrangler dev` and manually test:
  - [x] Home page loads
  - [x] Sign-up flow completes (email sent or auto-confirmed in dev)
  - [x] Sign-in flow sets a session cookie
  - [x] `/dashboard` redirects unauthenticated → `/auth/signin`
  - [x] Sign-out clears the session

- [x] **2.3** Check `nodejs_compat` necessity: after the build, scan `dist/_worker.js` for any Node.js built-in references (`require('fs')`, `require('net')`, etc.).
  - If none found: `nodejs_compat` flag is safe to leave as-is (no harm, just a precaution).
  - If found: identify the offending package and replace with an edge-compatible alternative before proceeding.

  > **Result (2026-05-21)**: No Node.js built-in imports (`require('...')` or `import ... from 'node:...'`) found in `dist/server/`. The `globalThis.process ??= {}` shims are injected by the Cloudflare adapter itself — not real Node.js dependencies. `nodejs_compat` flag is safe to keep as-is.

  > **Edge case**: `@supabase/ssr` uses Web-standard `fetch` and `Headers` — no Node.js globals expected. `useFormStatus()` (React 19) is client-side only and does not affect the workerd runtime.

---

## Phase 3 — Cloudflare Account Setup
> One-time human steps (require a browser and a Cloudflare login).

- [x] **3.1** Log into [dash.cloudflare.com](https://dash.cloudflare.com) → **My Profile → API Tokens → Create Token**
  - Use the **"Edit Cloudflare Workers"** template
  - Permissions needed: `Workers Scripts:Edit` + `Workers Routes:Edit`
  - Copy the token immediately (shown only once)

- [x] **3.2** Copy your **Account ID** from the Cloudflare dashboard sidebar (shown on the Workers & Pages overview page)

- [x] **3.3** Wire Worker secrets (run in terminal, interactive prompt for each value):
  ```
  npx wrangler secret put SUPABASE_URL
  npx wrangler secret put SUPABASE_KEY
  ```
  Verify with: `npx wrangler secret list`
  Expected output: two entries — `SUPABASE_URL` and `SUPABASE_KEY`

- [x] **3.4** Supabase region check (edge case from risk register):
  - Open Supabase dashboard → Project Settings → General → **Region**
  - If region is `us-east-1` (AWS Virginia): migrate the project to `eu-central-1` (Frankfurt) or `eu-west-1` (Ireland)
    - Free tier: pause existing project, create new project in EU region, re-run any schema migrations
  - If already EU: proceed

- [x] **3.5** Supabase inactivity guard (edge case):
  - If using Supabase Free tier: keep the project active during development (make at least one request per week)
  - Before first external user demo: upgrade to Supabase Pro ($25/month) to prevent cold-start pauses

---

## Phase 4 — First Manual Deploy
> Verify the full build + deploy pipeline end-to-end before automating it.

- [x] **4.1** Run:
  ```
  npm run build
  npx wrangler deploy
  ```
  Expected output: `Deployed job-tracker ... https://job-tracker.<your-subdomain>.workers.dev`

- [x] **4.2** Visit the live URL in a browser. Run the same smoke-test checklist as Phase 2.2 (home, sign-up, sign-in, protected route, sign-out).

- [x] **4.3** Check logs in real-time during smoke test:
  ```
  npx wrangler tail job-tracker --format json
  ```
  No errors should appear for the happy path.

- [ ] **4.4** Disable Cloudflare Auto Minify (edge case — breaks React hydration):
  - Cloudflare dashboard → **Speed → Optimization → Content Optimization**
  - Disable **Auto Minify** for JavaScript (and HTML/CSS if enabled)
  - Verify client-side React components still work (sign-in form, password toggle)

---

## Phase 5 — CI/CD Auto-Deploy via Cloudflare Git Integration
> Connect the GitHub repo directly to Cloudflare so that every push to `master` triggers a build and deploy on Cloudflare's own infrastructure — no GitHub Actions secrets or `wrangler deploy` step needed.

- [x] **5.1** In the Cloudflare dashboard → **Workers & Pages** → select (or create) `job-tracker` → **Settings** → **Build & Deployments** → **Connect to Git**
  - Authorize the Cloudflare GitHub App on your GitHub account/org when prompted
  - Select the `JobTracker` repository
  - Set the **Production branch**: `master`

- [x] **5.2** Configure build settings in the dashboard:
  - **Build command**: `npm run build`
  - **Deploy directory**: `dist`
  - **Node.js version**: `22` (set under Environment Variables or the Node version selector)

  > Cloudflare uses its own build runner (same infra as Cloudflare Pages). It runs `npm ci` then your build command, then uploads the `dist` directory. No wrangler invocation needed on your side.

- [x] **5.3** Add environment variables for the build in the dashboard (**Settings → Environment Variables → Production**):
  - `SUPABASE_URL` — your Supabase project URL
  - `SUPABASE_KEY` — your Supabase anon key

  > These replace the `wrangler secret put` commands from Phase 3.3 for the Git-integration deploy path. The secrets set via `wrangler secret put` are used by the Worker at runtime; these env vars are injected at **build time** by Cloudflare's runner. Both are needed.

- [x] **5.4** Push a test commit to `master` and verify:
  - Cloudflare dashboard → `job-tracker` → **Deployments**: a new deployment entry should appear within ~1 minute
  - Deployment log should show a clean build with no errors
  - Visit the live `workers.dev` URL and confirm the app loads

- [x] **5.5** Rollback if needed (no CLI required):
  - Cloudflare dashboard → `job-tracker` → **Deployments** → pick any prior deployment → **Rollback to this deployment**
  - Or via CLI: `npx wrangler rollback <version-id>` then re-push to re-sync

---

## Phase 6 — Post-Deploy Validation & Monitoring

- [ ] **6.1** Error log monitoring: run for 2 minutes after deploy, confirm no 5xx errors:
  ```
  npx wrangler tail job-tracker --status error
  ```

- [ ] **6.2** CPU time check (edge case — free tier 10ms CPU limit):
  - In Cloudflare dashboard → Workers & Pages → `job-tracker` → Metrics
  - Check **CPU Time** P50/P99 for auth routes
  - If P99 approaches 8ms: upgrade to Workers Paid ($5/month) before adding any CPU-intensive routes

- [ ] **6.3** Preview worker for future PRs (optional, follow-up):
  ```
  npx wrangler deploy --name job-tracker-preview
  ```
  Add a separate GitHub Actions job on `pull_request` events that deploys to the preview worker using the same secrets.

---

## Critical Files

| File | Change |
|------|--------|
| `wrangler.jsonc` | Rename `name` field |
| `package.json` | Rename `name` field |
| `.dev.vars` (new, git-ignored) | Local Cloudflare dev secrets |

> `.github/workflows/ci.yml` does **not** need a deploy step — deployment is handled by Cloudflare's Git integration, not GitHub Actions.

---

## Verification Checklist (End-to-End)

1. `npx wrangler dev` passes all auth flows locally in workerd runtime
2. `npm run build && npx wrangler deploy` produces a live URL with working auth
3. Cloudflare dashboard shows no 5xx errors after smoke test
4. Auto Minify is disabled; React hydration works in browser
5. Cloudflare Git integration deploys on push to `master` without any GitHub Actions step
6. `npx wrangler tail` streams logs with no unexpected errors
7. Supabase project is in an EU region (eu-central-1 or eu-west-1)
