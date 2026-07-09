# Migrate Agent Browser Verification: Playwright MCP → CLI — Plan Brief

> Full plan: `context/changes/agent-browser-playwright-cli/plan.md`
> Research: `context/changes/agent-browser-playwright-cli/research.md`

## What & Why

Replace the Playwright **MCP server** with the **`@playwright/cli`** shell tool as the agent's browser-verification interface, and use the CLI's on-disk `state-save`/`state-load` so an authenticated Supabase session persists between shell commands and across sessions. MCP is token-heavy (pushes a ~30-tool schema + full snapshot into context every call) and can't preserve login state; the CLI writes snapshots to disk (read on demand, ~4.6× fewer tokens) and keeps a live browser via a background daemon. This is **agent-assisted manual verification only — not a CI e2e gate**.

## Starting Point

The agent drives the browser through the MCP server (`.mcp.json`, `npx @playwright/mcp`) using the 129-line `e2e-browser` skill, which documents two auth paths: real form sign-in and a `document.cookie` injection fast-path. No installed Playwright dependency exists (MCP runs via `npx`), and the app is cookie-only for auth (`createServerClient` everywhere, session in the `sb-127-auth-token` cookie) — so persisted state needs only cookies.

## Desired End State

The agent verifies UI via `playwright-cli` shell commands. It form-signs-in once through the CLI, persists the session with `state-save auth.json`, and later shells reconnect with `state-load auth.json`. The MCP server, its permissions, and its `.playwright-mcp/` artifacts are gone; no doc or config references `mcp__playwright__*`.

## Key Decisions Made

| Decision                     | Choice                                   | Why (1 sentence)                                                                                  | Source   |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | -------- |
| Install/pin the CLI          | Bare `playwright-cli` binary, no npx/pin | Already installed and on PATH on the dev box                                                      | Plan     |
| storageState source          | CLI `state-save` is canonical            | The CLI writes its own guaranteed-compatible file; drops the need for an `e2e-session.ts` emitter | Plan     |
| `document.cookie` fast-path  | Remove it now                            | One clean auth path (`state-load`); simplifies skill + script                                     | Plan     |
| Windows daemon smoke-test    | Dedicated blocking Phase 1               | Daemon behavior is undocumented on Windows; prove before investing in the doc rewrite             | Plan     |
| Stale `.playwright-mcp/` dir | Delete dir, swap `.gitignore`            | Clean cut; artifacts are gitignored and non-load-bearing                                          | Plan     |
| e2e-as-a-gate                | Stays out of scope                       | `test-plan.md` §7 dropped-R2; verification tooling only                                           | Research |

## Scope

**In scope:** prove the CLI on Windows; rewrite the `e2e-browser` skill to `playwright-cli` + `state-load`; remove the `document.cookie` fast-path (skill + `e2e-session.ts`); refresh `tests/README.md` + `test-plan.md`; remove the MCP server from `.mcp.json`/settings; swap `.gitignore`; delete `.playwright-mcp/`.

**Out of scope:** any Playwright Test Runner / `playwright.config.ts` / CI gate; a `--state-out` emitter in `e2e-session.ts` (superseded by state-save-canonical); installing/pinning the CLI; the four shared test helpers, `e2e:session` wiring, and §2–§7 test-plan strategy.

## Architecture / Approach

Prove-then-migrate. A blocking Windows/PowerShell smoke-test proves the daemon persists across separate shells and `state-save`→`state-load` round-trips an authenticated session, capturing the real state-file schema. Only then is the skill/docs rewritten to the CLI (while MCP still exists, so the playbook is never tool-less). Config removal is last and irreversible — nothing references a removed tool mid-flight. `e2e-session.ts` stays the credential bootstrap; it loses only its `document.cookie` print block.

## Phases at a Glance

| Phase                        | What it delivers                                                         | Key risk                                                                        |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1. Windows smoke-test (gate) | Proven CLI commands + state-file schema + teardown on Win11/PowerShell   | Daemon may not persist across shells on Windows — undocumented                  |
| 2. Skill + docs rewrite      | CLI-based `e2e-browser` skill, `document.cookie` removed, docs refreshed | Losing a load-bearing gotcha in the rewrite; typecheck break on the script trim |
| 3. Config cutover + cleanup  | MCP server removed, `.gitignore` swapped, `.playwright-mcp/` deleted     | Removing config before docs are consistent (mitigated by ordering)              |

**Prerequisites:** local Supabase stack up; `.env.test` populated; `playwright-cli` installed (done); ports 4321–8787 clear.
**Estimated effort:** ~1–2 sessions across 3 phases; Phase 1 is the pacing item (manual, human-verified).

## Open Risks & Assumptions

- The `playwright-cli` daemon persisting across separate PowerShell invocations is unverified on Windows — Phase 1 exists specifically to de-risk this; if it fails, the migration pauses.
- The exact `state-save` JSON schema is confirmed empirically in Phase 1 (assumed `{cookies, origins}`).
- Supabase access tokens expire, so `auth.json` is regenerated per session — a mid-session `/dashboard`→`/auth/signin` bounce means re-mint the state file.

## Success Criteria (Summary)

- The agent drives an authenticated `/dashboard` end-to-end via `playwright-cli`, with `state-load` restoring the session in a fresh shell.
- No live repo reference to `mcp__playwright` / `@playwright/mcp` / `.playwright-mcp`; MCP server removed from config.
- `npm run typecheck` passes; all original skill gotchas/routes/prereqs preserved; e2e stays manual-only.
