---
change_id: agent-browser-playwright-cli
title: Migrate agent-driven browser verification from Playwright MCP to Playwright CLI
status: impl_reviewed
created: 2026-07-09
updated: 2026-07-09
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Origin: `/10x-research` on adopting the token-efficient `@playwright/cli` (shell + on-disk YAML snapshots + `state-save`/`state-load`) in place of the `@playwright/mcp` server, and persisting the authenticated Supabase session as a Playwright `storageState` file.
- Scope decisions (from research intake, 2026-07-09):
  - **Replace** the Playwright MCP server with the CLI (not run both).
  - Adopt **CLI storageState** for auth persistence (`e2e:session` emits the state file; CLI loads it once).
  - Deliverable: a full research doc feeding a later `/10x-plan`.
- Framing carry-over from the archived MCP change (`context/archive/2026-07-07-agent-e2e-playwright-mcp/`): this remains **agent-assisted manual verification**, NOT a CI e2e gate. `context/foundation/test-plan.md` §7 dropped-R2 stands.

## Phase 1 smoke findings (2026-07-09)

Ran the full smoke sequence on this Win11/PowerShell box (via the Bash tool, each command its own process invocation) against `npm run dev` on `:4321` with a user from `npm run e2e:session`. **All steps passed.**

**CLI version**: `playwright-cli 0.1.15` (`/c/nvm4w/nodejs/playwright-cli`, on PATH, no `npx` needed).

**Exact working commands**:

```
playwright-cli open http://localhost:4321/auth/signin --headed
# → daemon starts, prints pid. First snapshot after `open` was EMPTY (page still
#   mid-load); a follow-up `playwright-cli snapshot` was also empty with a console
#   404 for favicon.ico. `playwright-cli reload` fixed it — second snapshot showed
#   the real sign-in form with element refs. This is a real gotcha to carry into
#   the skill rewrite: don't trust the snapshot from the same call as `open`;
#   reload/re-snapshot once before interacting.

playwright-cli fill <email-ref> "<email>"
playwright-cli fill <password-ref> "<password>"
playwright-cli click <submit-ref>
# → redirected to /dashboard, Page Title "Tablica", board columns rendered
#   (Interesujące / Zaaplikowano / Rozmowa), all "Brak aplikacji" for a fresh user.

playwright-cli state-save auth.json
# → writes ./auth.json relative to cwd.

playwright-cli close-all
# → closes the browser; `playwright-cli list` then reports "(no browsers)".

playwright-cli open http://localhost:4321/ --headed
# → NEW daemon pid (confirmed different from the first), proving this is a fresh
#   browser process, not a reused one.
playwright-cli state-load auth.json
playwright-cli goto http://localhost:4321/dashboard
# → Page Title "Tablica", same user email in the header nav, board renders,
#   NO redirect to /auth/signin. Cross-shell session restore confirmed.

playwright-cli kill-all
# → "No daemon processes found." (close-all had already torn down cleanly).
playwright-cli list
# → "(no browsers)"
```

**State-file schema** (`auth.json`, written by `state-save`):

```json
{
  "cookies": [
    {
      "name": "sb-127-auth-token",
      "value": "base64-<...>",
      "domain": "localhost",
      "path": "/",
      "expires": <unix-ts>,
      "httpOnly": false,
      "secure": false,
      "sameSite": "Lax"
    }
  ],
  "origins": []
}
```

Matches the predicted shape exactly: `cookies[]` + empty `origins[]`, one cookie (`sb-127-auth-token`), `domain: "localhost"` (host-scoped, no port — confirms the research note that the cookie is shared across `:4321`/`:8787`).

**Cross-shell reconnect**: Confirmed working. The second `open` got a distinct daemon pid from the first, and `state-load` + navigation restored the authenticated session without re-running sign-in.

**Teardown**: `playwright-cli close-all` (or `kill-all` if a session is already dead/orphaned) leaves no browser process and no port squatter — verified via `tasklist` (no stray `chrome.exe`) and `netstat` (only the dev server's own `:4321` listener remained). Recommended teardown for the skill: `playwright-cli close-all` as the normal path, `kill-all` as the "something's stuck" fallback.

**Snapshot files**: land under `.playwright-cli/page-<timestamp>.yml` and `.playwright-cli/console-<timestamp>.log`, gitignored-needed (currently untracked/dirty — Phase 3 adds the `.gitignore` entries).

**Verdict**: Gate passed. Proceeding to Phase 2 (skill + docs rewrite) is unblocked.
