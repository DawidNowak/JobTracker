---
date: 2026-07-07T15:25:00+02:00
researcher: Claude (Fable 5)
git_commit: 440a3c4b0217ad303d65980ca455365bb8f29492
branch: master
repository: JobTracker
topic: "Agent-driven e2e testing of the local app via Playwright MCP: feasibility, auth flow, test user provisioning, and where to store the playbook"
tags: [research, codebase, playwright-mcp, e2e, auth, supabase, testing]
status: complete
last_updated: 2026-07-07
last_updated_by: Claude (Fable 5)
---

# Research: Agent-driven e2e testing via Playwright MCP

**Date**: 2026-07-07T15:25:00+02:00 (CEST)
**Researcher**: Claude (Fable 5)
**Git Commit**: 440a3c4b0217ad303d65980ca455365bb8f29492
**Branch**: master
**Repository**: JobTracker

## Research Question

Check the possibility of adding a way for the agent to perform e2e tests on the local app using Playwright MCP. Take into consideration the auth flow, whether we need to prepare a user for e2e testing purposes, and where to store the knowledge so the agent won't have to figure out the whole Playwright flow each time.

## Summary

**It is feasible, and most of the infrastructure already exists.** The pieces that are ready:

1. **Playwright MCP is already connected** — configured at user level in `~/.claude.json` (server name `palywright`, running `npx @playwright/mcp@latest`), with browser tool permissions already granted in `.claude/settings.local.json:4-8` and `.playwright-mcp/` artifacts gitignored.
2. **Test user provisioning already exists** — `provisionUser` (`tests/helpers/users.ts`) creates ephemeral, auto-confirmed users via the Supabase admin API; `cleanupUser` cascades deletion. **No seeded/fixed e2e user is needed** — ephemeral users are the established convention.
3. **Session bootstrapping already exists** — `signInAndCaptureCookies` (`tests/helpers/cookies.ts`) produces the exact `@supabase/ssr` cookie string the middleware reads.

The one real blocker is **the auth flow through the browser**: the UI sign-in path (`POST /api/auth/signin`) fails with "internal error" under the Cloudflare-adapter `astro dev` server (known from prior sessions; the same credentials work via `@supabase/ssr` directly). Critically, **this quirk is not documented anywhere in the repo** — it lives only in the assistant's private memory. The recommended path is **cookie injection**: provision a user via the admin API, capture cookies with the existing helper, and inject them into the browser before navigating to protected routes.

**Where to store the knowledge**: a project skill at `.claude/skills/e2e-browser/SKILL.md` (precedent: `.claude/skills/blocker-resolved/`), cross-referenced from `tests/README.md`. The sign-in quirk itself belongs in a durable repo doc regardless of the skill decision.

**Framing caveat**: `context/foundation/test-plan.md:97` explicitly ruled out automated e2e for MVP (cost × signal; dropped requirement R2 at `test-plan.md:108`). What this research covers is different in kind: **agent-assisted manual verification** (the agent driving a browser interactively to verify a change), not a CI-gated e2e suite. That is consistent with the project's existing "manual verification via `wrangler dev`" convention (`context/foundation/infrastructure.md:75-77`).

## Detailed Findings

### 1. Playwright MCP availability and permissions

- The MCP server is configured **at user scope**, not in the project: `~/.claude.json` under this project's entry defines server `palywright` (note the typo in the name — tool prefixes are `mcp__palywright__*`) as `npx @playwright/mcp@latest` (stdio).
- Project `.mcp.json:1-8` only defines the `cloudflare` HTTP server. **Consequence:** Playwright MCP availability depends on the local user config; it is not reproducible from a repo clone. If browser verification becomes a standing workflow, moving the server definition into `.mcp.json` would make it project-durable (and fix the name typo).
- `.claude/settings.local.json:4-8` already allows `mcp__playwright`, `mcp__palywright__browser_snapshot`, `mcp__palywright__browser_fill_form`, `mcp__palywright__browser_click`.
- `.playwright-mcp/` (snapshots, console logs, screenshots) exists with recent artifacts (2026-07-07) and is in `.gitignore` — the MCP has already been used experimentally in this repo.
- The stack snapshot in `context/foundation/test-plan.md:108` still says "Runtime/browser: none exposed (no Playwright MCP); checked: 2026-06-16" — **stale**; the freshness ledger (§8) says to refresh it.

### 2. Auth flow mechanics (what a browser session must satisfy)

- **Sign-in UI**: `src/pages/auth/signin.astro` renders `src/components/auth/SignInForm.tsx:43-87` — form POSTs `email` + `password` (FormData) to `/api/auth/signin`; submit button text "Sign in".
- **Sign-in endpoint**: `src/pages/api/auth/signin.ts:1-20` — calls `supabase.auth.signInWithPassword`, redirects to `/dashboard` on success, to `/auth/signin?error=…` on failure.
- **Sign-up**: `src/components/auth/SignUpForm.tsx:65-134` → `src/pages/api/auth/signup.ts` → redirect to `/auth/confirm-email`. Local Supabase has `enable_confirmations = false` (`supabase/config.toml:209`), and `src/pages/auth/confirm-email.astro:4` auto-confirms messaging in DEV.
- **Sign-out**: POST-only `src/pages/api/auth/signout.ts:1-11`, redirects to `/`.
- **Middleware**: `src/middleware.ts:1-25` — `PROTECTED_ROUTES = ["/dashboard", "/archive"]` (line 4); every request creates a server client, calls `auth.getUser()`, populates `locals.user`, and redirects unauthenticated protected-route requests to `/auth/signin`.
- **Cookies**: `src/lib/supabase.ts:6-25` — `createServerClient` with a pass-through cookie adapter (`parseCookieHeader` on read, `cookies.set(name, value, options)` on write). Cookie names/format are whatever `@supabase/ssr` produces (`sb-<ref>-auth-token`, possibly chunked `.0/.1` for large JWTs). Options come from `@supabase/ssr` defaults, which do **not** set `httpOnly` — so browser-side JS (`document.cookie`) can set them, which is what makes MCP cookie injection viable.
- **Env**: `SUPABASE_URL`/`SUPABASE_KEY` come from `astro:env/server` (`astro.config.mjs:17-22`), which under `@astrojs/cloudflare` dev reads **`.dev.vars`**, not `process.env`. `.dev.vars` currently already points at the local Supabase stack (`http://127.0.0.1:54321`), so a plain `npm run dev` already targets local data.

### 3. The known blocker: UI sign-in fails under `astro dev`

From prior-session experience (assistant memory, **not documented in the repo** — the auth-flow sweep found no trace in code or docs):

- Browser → sign-in form → `/api/auth/signin` returns Supabase "internal error; reference = …" under the Cloudflare-adapter dev server, even though the same credentials work via direct calls to the Supabase auth API.
- Suspected (unconfirmed) cause: how `@supabase/ssr`'s `createServerClient` handles the request/cookie context inside the Cloudflare adapter's dev runtime.
- The test helper path (`signInAndCaptureCookies`, which drives `@supabase/ssr` directly) works fine — which is exactly why cookie injection is the reliable route.
- Related gotcha: Astro's CSRF middleware returns 403 on DELETE requests without `Content-Type: application/json`.
- Untested: whether the UI sign-in works under `wrangler dev` (workerd runtime after `npm run build`) — the failure was only observed under `astro dev`. If it works there, UI-driven sign-in becomes possible for production-faithful sessions.

**This is the single most important fact to persist in the repo** — without it, every future agent session burns time rediscovering that the sign-in form is a dead end in dev.

### 4. Test user provisioning — no seed user needed

- `tests/helpers/users.ts:1-37` — `provisionUser(admin)` creates `u-<uuid>@test.local` with password `test-password-123` via `admin.auth.admin.createUser({ …, email_confirm: true })`, then signs in client-side and returns `{userId, email, password, client}`. `cleanupUser` deletes via admin API; `ON DELETE CASCADE` wipes the user's rows.
- **Hard-won gotcha** (`context/foundation/test-plan.md:271`): `email_confirm: true` is mandatory even though the project disables email confirmations — the two are independent switches; omitting it makes `signInWithPassword` fail with "Email not confirmed".
- `tests/helpers/supabase-clients.ts` — `createAdminClient()` uses `SUPABASE_SERVICE_ROLE_KEY` from `.env.test` (git-ignored; never committed per `AGENTS.md:14`).
- `supabase/seed.sql` does not exist; the established convention is **ephemeral users, not seeded ones** (`tests/README.md:74-76`). For e2e sessions the same pattern applies: provision on demand, optionally clean up after. A durable "e2e user" would add state-drift risk for no benefit — the local stack persists users between runs anyway, so a session can also reuse a previously provisioned user if its credentials are known.
- `tests/helpers/seed.ts` — `seedApplication(client, userId, overrides?)` inserts application rows, useful for arranging board state before a browser check.

### 5. Server strategy for browser sessions

Two viable targets, both backed by the local Supabase stack (`npx supabase start`; API on 54321, Studio on 54323, Inbucket on 54324 — `supabase/config.toml`):

| Target | Command | Runtime | Notes |
|---|---|---|---|
| Dev server | `npm run dev` (port 4321) | Node.js | `.dev.vars` already points at local stack. UI sign-in **broken** (finding 3) — use cookie injection. |
| Production-faithful | `npm run build && npx wrangler dev` | workerd | Established convention for parser/Workers verification (`context/foundation/infrastructure.md:75-77`, `context/archive/2026-05-21-deployment/deployment-plan.md:77-94`). Sign-in behavior untested. |

Hazards:

- `tests/global-setup.ts:66-101` swaps `.dev.vars` to `.env.test` values while `npm test` runs and restores it on teardown. Running a manual dev server and the vitest suite concurrently can race on `.dev.vars`. Vitest's server uses a random free port, so ports won't collide, but avoid running both at once.
- A manually started dev server is not cleaned up by anything — the agent must kill it at session end (on Windows: `taskkill /F /T /PID …`, mirroring `tests/global-setup.ts:54-64`).

### 6. The recommended browser-session flow (what the playbook should encode)

1. Ensure local stack is up: `npx supabase status` (else `npx supabase start`); ensure `.env.test` is populated (`tests/README.md:8-20`).
2. Start the app: `npm run dev` (background), poll until ready.
3. Provision a session user + cookies **outside the browser**: a tiny script (or one-off vitest node test, per the existing memory pattern) that calls `provisionUser(createAdminClient())` then `signInAndCaptureCookies(email, password)` and prints the cookie string.
4. Inject cookies into the browser: `mcp__palywright__browser_navigate` to the base URL (so the origin matches), then set each `name=value` pair via `document.cookie` (browser_evaluate/run_code). Cookies are not `httpOnly` (finding 2), so this works; handle chunked `sb-*-auth-token.0/.1` pairs — the helper returns all of them.
5. Navigate to `/dashboard` — middleware should now see the session and render the board.
6. Verify UI behavior via `browser_snapshot` / `browser_click` / `browser_fill_form`; artifacts land in `.playwright-mcp/` (gitignored).
7. Tear down: kill the dev server; optionally `cleanupUser`.

Step 3–4 could be collapsed later by fixing the `astro dev` sign-in bug (see Open Questions), which would let the agent simply fill the sign-in form.

### 7. Where to store the knowledge

Existing homes for agent-facing knowledge, in precedence order:

- `CLAUDE.md` → defers entirely to `AGENTS.md` (repo root) — hard rules, links to `tests/README.md`.
- `tests/README.md` — the canonical testing conventions doc (pools, helpers, hard rules).
- `context/foundation/test-plan.md` — strategy, risk map, cookbook (§6), stack snapshot with `checked:` dates (§4), freshness ledger (§8).
- `.claude/skills/blocker-resolved/SKILL.md` — **precedent for a project-level skill**: named procedure, steps, edge cases, references to foundation docs.
- Assistant private memory (`feedback_playwright_auth_workaround`) — where the sign-in quirk currently lives; not visible to other agents/humans, wrong place for durable knowledge.

**Recommendation** (for the plan phase):

1. **Primary: a project skill** — `.claude/skills/e2e-browser/SKILL.md` (or similar name) encoding the session flow from finding 6: prerequisites, exact commands, cookie-injection steps, selectors/routes table, gotchas (sign-in dead end, `email_confirm: true`, CSRF Content-Type on DELETE, `.dev.vars` race, Windows process kill), teardown. Skills are agent-invocable and the built-in `run`/`verify` skills explicitly look for project skills first — this is the one place that removes the "figure it out each time" cost.
2. **Secondary: one paragraph + link in `tests/README.md`** ("Browser verification" section) so humans and non-skill-aware agents can find it.
3. **Update `context/foundation/test-plan.md` §4** stack snapshot (Playwright MCP now exposed; refresh `checked:` date) — the ledger in §8 requires it, and it keeps the "e2e not planned for MVP" decision honest by documenting what changed.
4. Move the Playwright MCP server definition from `~/.claude.json` into `.mcp.json` (fixing the `palywright` typo) so the capability is repo-durable.

### 8. Relationship to the test-plan philosophy

`context/foundation/test-plan.md:97` ("E2E not planned for MVP") and the dropped R2 (`test-plan.md:108`) rejected e2e **as a test gate** on cost × signal grounds, with an explicit "reconsider via `--refresh` if a regression class appears that integration cannot catch". Agent-driven Playwright MCP sessions are not that: they are the automation of the *already-sanctioned* manual verification step (`infrastructure.md:89-100` risk-register mitigations; `deployment-plan.md:88-93` manual checklist: sign-up, sign-in, protected-route redirect, sign-out). The playbook should state this framing explicitly so it doesn't read as a backdoor e2e suite.

## Code References

- `src/middleware.ts:4-21` — protected routes and redirect-to-signin behavior
- `src/lib/supabase.ts:10-24` — `createServerClient` cookie pass-through (names/format = `@supabase/ssr` defaults, not httpOnly)
- `src/pages/api/auth/signin.ts:13-19` — FormData sign-in, redirect semantics
- `src/components/auth/SignInForm.tsx:43-84` — form fields `email`/`password`, submit "Sign in"
- `src/pages/api/auth/signout.ts:1-11` — POST-only sign-out
- `tests/helpers/users.ts:13-36` — `provisionUser` (admin API, `email_confirm: true`, password `test-password-123`), `cleanupUser`
- `tests/helpers/cookies.ts:8-37` — `signInAndCaptureCookies` returns `name=value; name2=value2` string
- `tests/helpers/supabase-clients.ts:11-18` — admin (service-role) vs anon clients, `persistSession: false`
- `tests/helpers/seed.ts:1-23` — `seedApplication` for arranging board state
- `tests/global-setup.ts:66-124` — `.dev.vars` swap, free-port `astro dev` spawn, Windows `taskkill` teardown
- `supabase/config.toml:10,209` — API port 54321; `enable_confirmations = false`
- `astro.config.mjs:17-22` — `SUPABASE_URL`/`SUPABASE_KEY` as `astro:env/server` secrets
- `.claude/settings.local.json:4-8` — Playwright MCP tool permissions already granted
- `.mcp.json:1-8` — only `cloudflare` server at project scope (Playwright MCP is user-scoped)

## Architecture Insights

- **Cookie-injection over UI sign-in** is the load-bearing pattern: `signInAndCaptureCookies` deliberately uses the same `@supabase/ssr` `createServerClient` path as production middleware, so its output is byte-compatible with what `src/middleware.ts` expects. Anything that can present those cookies (fetch header *or* browser cookie jar) is authenticated.
- **`.dev.vars` is the single env source of truth under the Cloudflare adapter** — `process.env` does not reach `astro:env/server` in dev. Any e2e tooling must respect (and not race) the `tests/global-setup.ts` swap.
- **Ephemeral users are a convention, not an accident** — cascade-delete cleanup and per-test isolation (`tests/README.md:74-82`). An e2e playbook should reuse `provisionUser` rather than introduce a seeded account.
- **Two-runtime split** (`astro dev` = Node, `wrangler dev` = workerd) is the project's documented divergence risk (`infrastructure.md:75-77`); a browser playbook should name which runtime it targets and why.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md:97,108` — e2e explicitly deferred for MVP; Playwright MCP marked "none exposed" as of 2026-06-16 (now stale); manual `wrangler dev` verification is the sanctioned fallback (dropped R2)
- `context/foundation/test-plan.md:271` — Phase 1+3 shipped notes: the `email_confirm: true` independence gotcha
- `context/foundation/infrastructure.md:70-100` — pre-mortem and risk register establishing manual production-faithful verification (`wrangler dev`) as an operational practice
- `context/archive/2026-05-21-deployment/deployment-plan.md:77-94` — the manual smoke checklist (sign-up, sign-in cookie, protected redirect, sign-out) an agent-driven browser session would automate
- `context/archive/2026-06-16-testing-bootstrap-and-data-isolation/plan.md:76-77` — origin of the user-provisioning helper pattern
- Assistant memory `feedback_playwright_auth_workaround` (private, session-scoped origin 2026-07-x) — the `astro dev` sign-in "internal error" and the vitest-based verification workaround; **needs to be promoted into the repo**

## Related Research

- `context/archive/2026-06-16-testing-bootstrap-and-data-isolation/research.md` — Supabase auth path, two-client pattern
- `context/archive/2026-06-18-parser-correctness-and-abuse-surface/research.md` — manual verification checklist, pool boundaries
- `context/archive/2026-06-23-testing-lastactionat-and-idor/research.md` — RLS/trigger assertions the browser layer sits on top of

## Open Questions

1. **Does UI sign-in work under `wrangler dev` (workerd)?** The "internal error" was only observed under `astro dev`. One 10-minute experiment decides whether the playbook needs cookie injection for production-faithful sessions too.
2. **Empirically confirm `document.cookie` injection works** — `@supabase/ssr` defaults imply not-httpOnly, and chunked tokens (`.0/.1`) must all be set. One trial run settles it; the fallback is a tiny dev-only "session handoff" route or diagnosing the sign-in bug first.
3. **Should the `astro dev` sign-in bug get its own diagnosis change?** If fixed, the agent could drive the real sign-in form (higher-fidelity flow, simpler playbook). The suspected area is `@supabase/ssr` request/cookie context under the Cloudflare adapter dev runtime.
4. **Session-user script shape**: standalone `npx tsx scripts/e2e-session.ts` vs a one-off vitest node test reusing `global-setup`. Standalone is lighter (no `.dev.vars` swap needed since it only talks to Supabase directly), but adds a `tsx` dependency question.
5. **Whether to promote the Playwright MCP server into `.mcp.json`** (repo-durable, fixes the `palywright` typo) — touches every collaborator's tool surface, so worth an explicit decision rather than a drive-by edit.
