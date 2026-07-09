---
name: e2e-browser
description: Drive an authenticated browser session against the local JobTracker app via Playwright CLI to verify UI behavior. Invoke when the user asks to verify a change in the browser, check the board/dashboard visually, run a browser smoke check, or says "e2e", "browser check", or "verify in the browser". Agent-assisted manual verification only — NOT an automated e2e gate.
---

# /e2e-browser

Use this skill to verify UI behavior of the local app in a real browser through `playwright-cli` shell commands: authenticated dashboard, board interactions, auth flows.

## Framing

This is **agent-assisted manual verification** — the automation of the already-sanctioned manual smoke check (`context/foundation/infrastructure.md`). It is **not** a CI e2e gate: `context/foundation/test-plan.md` §4/§7 explicitly dropped e2e for MVP (dropped requirement R2). Do not turn this flow into a committed test suite.

## Prerequisites

1. **Local Supabase stack up**: `npx supabase status` — else `npx supabase start`.
2. **`.env.test` populated** (see `tests/README.md` Prerequisites).
3. **No concurrent `npm test`** — the vitest global-setup swaps `.dev.vars` while the suite runs; racing it corrupts the dev server's env.
4. **No stale app servers** (load-bearing — see Gotchas):

   ```powershell
   netstat -ano | findstr LISTENING | findstr ":4321 :4322 :4323 :4324 :8787"
   ```

   Expected: no output. Kill any squatter: `taskkill /F /T /PID <pid>` (Windows; `/T` kills the process tree).

## Steps

### 1. Start the app

```
npm run dev
```

Run in background. **Read the startup banner**: it must say `http://localhost:4321/`. Astro silently increments past occupied ports (4322, 4323, …) — if the banner shows any other port, either target that port in every browser step below or go back to prerequisite 4 and kill the squatters.

### 2. Provision a session user

```
npm run e2e:session            # user + cookies only
npm run e2e:session -- --seed 3  # additionally seed 3 application rows for board state
```

Prints `userId`, `email`, `password` (`test-password-123`), a `Cookie:` header string (for raw HTTP/curl checks), and the cleanup command. Ephemeral users (`u-<uuid>@test.local`) are the convention — never create a permanent e2e account.

### 3. Sign in (primary flow — real form)

Verified working under both `astro dev` and `wrangler dev` (spike 2026-07-08; re-verified via `playwright-cli` 2026-07-09):

1. `playwright-cli open http://localhost:4321/auth/signin --headed` — starts the daemon.
2. **Reload before interacting**: the snapshot from the same call as `open` can come back empty (page still mid-load). Run `playwright-cli reload` then `playwright-cli snapshot` to get real element refs before filling the form.
3. `playwright-cli fill <email-ref> "<printed email>"`
4. `playwright-cli fill <password-ref> "<printed password>"`
5. `playwright-cli click <submit-ref>` (button "Sign in")
6. Expect redirect to `/dashboard` with the board rendered and the user's email in the navbar.
7. **Persist the session**: `playwright-cli state-save auth.json` — writes the authenticated cookie state to `./auth.json` (gitignored). Reuse it in later shells instead of re-running sign-in:

   ```
   playwright-cli open http://localhost:4321/ --headed
   playwright-cli state-load auth.json
   playwright-cli goto http://localhost:4321/dashboard
   ```

   This restores the session without a form submission — confirmed to work across **separate shell invocations** (the daemon persists the loaded browser between commands).

### 4. Verify UI behavior

Use `playwright-cli snapshot` (preferred over screenshots), `playwright-cli click`, `playwright-cli fill`. Artifacts land in `.playwright-cli/` (gitignored): `page-<timestamp>.yml` snapshots and `console-<timestamp>.log`.

## Routes & selectors

| Route               | Access    | Notes                                                                                                          |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `/auth/signin`      | public    | Fields: textbox "Email", textbox "Password"; submit: button "Sign in"; errors render via `?error=` query param |
| `/auth/signup`      | public    | Redirects to `/auth/confirm-email`; local stack auto-confirms                                                  |
| `/dashboard`        | protected | The board ("Tablica"); columns "Interesujące" / "Zaaplikowano" / "Rozmowa"; navbar shows email + "Wyloguj"     |
| `/archive`          | protected | Archived applications ("Archiwum")                                                                             |
| `/api/auth/signout` | POST-only | The "Wyloguj" button posts here; redirects to `/`                                                              |

Unauthenticated requests to protected routes redirect to `/auth/signin`.

## `wrangler dev` variant (production-faithful)

For workerd-runtime verification (parser-touching changes, per `infrastructure.md`):

```
npm run build
npx wrangler dev   # Ready on http://127.0.0.1:8787
```

Form sign-in **works** under workerd (verified 2026-07-08). Same steps as above with base `http://localhost:8787`. **Clear cookies first**: browser cookies are host-scoped, not port-scoped — a session cookie set during an `astro dev` run on `:4321` is also sent to `:8787` and can fake an authenticated state.

## Gotchas

- **`internal error; reference = <id>` on sign-in = wedged dev server, not an auth bug.** Root-caused 2026-07-08: the message is the Cloudflare workerd/miniflare dev-runtime's own internal-error response (the `signInWithPassword` fetch dies inside the runtime and never reaches GoTrue), passed through verbatim by supabase-js. Trigger: stale, long-lived `astro dev` processes squatting ports — the browser talks to the oldest one no matter how many fresh servers you start. **Kill and restart the server; do not debug the auth path.** Full evidence: `context/archive/2026-07-07-agent-e2e-playwright-mcp/change.md` (Spike findings).
- **Stale servers reject valid cookies too** — a wedged server bounces a freshly minted session cookie to `/auth/signin`, indistinguishable from broken auth. Always run prerequisite 4.
- **Empty page on the first navigation after a fresh server start = vite re-optimization, not an app bug.** Observed 2026-07-08: a request landing during vite's "optimized dependencies changed. reloading" window returns an empty body, and the dev log shows a transient React SSR error ("Invalid hook call" / `Cannot read properties of null (reading 'useState')` in the rendered component). The server self-recovers within seconds. **Reload the page once before debugging anything** — `curl` the route to confirm the server is serving HTML again.
- **The snapshot from the same call as `playwright-cli open` can come back empty** (page still mid-load, sometimes with a console 404 for `favicon.ico`). Observed 2026-07-09. Run `playwright-cli reload` then take a fresh `playwright-cli snapshot` before interacting with elements.
- **`email_confirm: true` is mandatory** in user provisioning even though the project disables email confirmations — two independent switches (`provisionUser` already handles this).
- **CSRF 403 on DELETE**: Astro's CSRF middleware rejects DELETE requests without `Content-Type: application/json`.
- **Hydration-mismatch console error on `/dashboard` is benign** — a known React artifact from relative-time text ("dodano X minut temu"); not a regression signal.
- **UI copy is Polish** — assert on "Tablica", "Interesujące", "Zaaplikowano", "Rozmowa", "Wyloguj", "Brak aplikacji".

## Teardown

1. Stop the browser daemon:

   ```
   playwright-cli close-all   # normal path — closes the browser cleanly
   playwright-cli kill-all    # fallback if a daemon/browser is stuck
   ```

   Verify with `playwright-cli list` (expect "(no browsers)").

2. Kill every server you started — nothing cleans them up for you:

   ```powershell
   taskkill /F /T /PID <pid>   # find PIDs via the netstat line from prerequisite 4
   ```

3. Clean up the session user:

   ```
   npm run e2e:session -- --cleanup <userId>
   ```

   Re-running cleanup for the same id is a safe no-op.

## Related docs

- `tests/README.md` — testing conventions; "Browser verification (agent-driven)" section points here.
- `scripts/e2e-session.ts` — the session bootstrap script (local-stack guard, `--seed`, `--cleanup`).
- `context/foundation/test-plan.md` §4 — stack snapshot; e2e-not-a-gate decision (§7).
- `context/archive/2026-07-07-agent-e2e-playwright-mcp/change.md` — spike findings with the full evidence trail.
