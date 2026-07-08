---
change_id: agent-e2e-playwright-mcp
title: Agent-driven e2e verification via Playwright MCP
status: implemented
created: 2026-07-07
updated: 2026-07-08
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Origin: `/10x-research` query about letting the agent run browser e2e checks on the local app via Playwright MCP.
- Framing constraint: `context/foundation/test-plan.md` explicitly dropped e2e for MVP (R2). This change targets **agent-assisted manual verification**, not an automated e2e gate.

### Spike findings (Phase 3, 2026-07-08)

**Experiment A — cookie injection: WORKS.** Flow verified end to end: `npm run dev` → `npm run e2e:session -- --seed 3` → `browser_navigate` to `http://localhost:4321` (origin must match before injecting) → one `document.cookie = "<name>=<value>; path=/"` statement per captured pair → navigate to `/dashboard` → board renders authenticated with the user's email in the navbar and all 3 seeded cards in the "Zaaplikowano" column.

- **Cookie names observed on the local stack**: exactly one pair, `sb-127-auth-token` (`base64-`-prefixed, value ~2.7 KB). **No `.0`/`.1` chunks** — the token sits below `@supabase/ssr`'s chunking threshold. Chunking remains possible if the session JSON grows (e.g. richer user metadata), so injection code must still loop over all captured pairs rather than hardcode one name.
- Cookies are not `httpOnly` (confirmed: `document.cookie` read them back), and browser cookies are host-scoped, not port-scoped — a cookie set on `localhost:4321` is also sent to `localhost:8787` (`wrangler dev`). Clear cookies between runtime experiments.

**Experiment B — the `astro dev` sign-in "internal error": NOT REPRODUCIBLE on a fresh server; root cause identified as environmental (stale dev-server processes), not a code bug.** No fix needed; no repo code touched.

- Reproduction attempt on a freshly started `npm run dev`: real form sign-in (`/auth/signin`, fields Email/Password, submit "Sign in") with a `provisionUser` user **succeeds** — redirect to `/dashboard`, authenticated board, GoTrue logs the login (`POST /token … status:200`).
- Evidence trail for the historic failure (observed 2026-07-07, snapshots in `.playwright-mcp/page-2026-07-07T10-52-15-167Z.yml` and `…T11-04-46-027Z.yml`, exact text `internal error; reference = <24-char id>`):
  1. Local GoTrue container logs cover 2026-06-18 → now and contain **zero** "internal error" entries and **no trace of the failing browser requests** at the failure timestamps (10:52Z, 11:04Z) — the failing `signInWithPassword` calls never reached local GoTrue. Only the vitest/helper sign-ins (`user_agent: "node"`) appear, all 200.
  2. The `internal error; reference = <id>` format is the **Cloudflare workerd/miniflare runtime's own internal-error response** (the Cloudflare adapter's dev runtime), passed through by supabase-js as the error message and rendered via the signin redirect. It is not a Supabase/GoTrue error despite reading like one.
  3. **Five stale `astro dev` processes from 2026-07-07 were found squatting ports 4321–4324** (astro silently increments to the next free port, so every "restart" yesterday bound a new port while the browser kept hitting the oldest, wedged server on 4321). Today the stale 4321 server also rejected a freshly minted valid session cookie minutes before a fresh server accepted the identical cookie — stale servers produce auth failures indistinguishable from "auth is broken".
- Conclusion: the browser-path fetch from inside the wedged workerd dev runtime failed before reaching Supabase; a healthy, freshly started server has no such problem. The mechanism that wedged the original process is unconfirmed (candidates: long-lived process + vite dep re-optimization; `.dev.vars` swap race from a crashed `npm test` — a stale vitest-spawned test server on port 55010 was also found running). What is confirmed: fresh server ⇒ form sign-in works.

**Experiment C — UI sign-in under `wrangler dev`: WORKS.** `npm run build && npx wrangler dev` (port 8787), same form sign-in → authenticated `/dashboard` with the seeded cards. The production-faithful runtime does not share the (environmental) bug.

**Decision for the Phase 4 skill**: primary flow is **real form sign-in** (verified working under both `astro dev` and `wrangler dev`), with **cookie injection as the fast-path alternative** (skips the form; required only when driving pre-authenticated HTTP-level checks or if sign-in misbehaves). The skill's load-bearing gotcha becomes the **stale-server hazard**: before testing, verify the dev-server startup banner's port matches the port the browser targets (astro silently increments past squatted ports), and kill stale `astro dev`/`wrangler`/test-server processes first (`taskkill /F /T /PID <pid>` on Windows). An "internal error; reference = …" on sign-in means a wedged dev runtime — kill and restart the server, don't debug auth.

Other facts for Phase 4: hydration-mismatch console error on `/dashboard` is a known benign React artifact (relative-time text); `npm run e2e:session -- --cleanup <userId>` re-run is a safe no-op; board column headings are Polish ("Interesujące", "Zaaplikowano", "Rozmowa"), navbar has "Wyloguj" sign-out button.
