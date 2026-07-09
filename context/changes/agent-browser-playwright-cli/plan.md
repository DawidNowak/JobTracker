# Migrate Agent Browser Verification from Playwright MCP to Playwright CLI — Implementation Plan

## Overview

Replace the Playwright **MCP server** with the **`@playwright/cli`** shell tool as the agent's browser-verification interface, and adopt the CLI's on-disk `state-save`/`state-load` flow so a session's authenticated Supabase cookie persists between shell commands and across sessions. This is a token-efficiency + session-persistence migration for **agent-assisted manual verification** — it is explicitly **not** a CI e2e gate (`context/foundation/test-plan.md` §7 dropped-R2 stands).

The work is proved-first: a blocking Windows/PowerShell smoke-test gates all downstream doc/config work, because the CLI's daemon model is undocumented on Windows and this repo's entire e2e flow is Windows-hosted.

## Current State Analysis

The agent drives the browser through the Playwright **MCP server** (`.mcp.json:7-11`, `npx @playwright/mcp@latest` over stdio). The `e2e-browser` skill (`.claude/skills/e2e-browser/SKILL.md`, 129 lines) is the playbook: it uses `mcp__playwright__*` tools and documents two auth paths — real form sign-in (step 3) and a `document.cookie` injection fast-path (step 3-alt). Session state lives implicitly inside the long-lived MCP process; nothing persists to disk between agent sessions, and every MCP call pushes a full tool schema + snapshot into context (the token cost).

Key facts established by research (`context/changes/agent-browser-playwright-cli/research.md`):

- **No installed Playwright dependency exists** — MCP runs via `npx`; `package.json`/lockfile have zero Playwright entries. So there is nothing to `npm uninstall`.
- **The app is cookie-only for auth.** Every Supabase client is a `createServerClient` with a cookie adapter (`src/lib/supabase.ts:10-24`); there is no `createBrowserClient`. Middleware reads the session from the cookie header per request (`src/middleware.ts:7-12`). The session cookie `sb-127-auth-token` is not httpOnly, host-scoped (shared `:4321`↔`:8787`), and currently a single unchunked ~2.7 KB value.
- **`scripts/e2e-session.ts`** provisions an ephemeral user, signs in, and prints credentials + a `Cookie:` header + `document.cookie` injection lines + a cleanup command. It is browser-tool-agnostic; the only tie to the browser tool is the `document.cookie` print block (`scripts/e2e-session.ts:70-73`) that feeds the skill's fast-path.
- **`playwright-cli` is already installed** on the dev machine and on PATH — the skill/commands call the bare `playwright-cli` binary (no `npx`, no version-pin logistics needed in this plan).

## Desired End State

The agent verifies UI behavior via `playwright-cli` shell commands. Authentication is established **once per session** by form-signing-in through the CLI and persisting the browser state with `state-save auth.json`; subsequent shells reconnect the authenticated session with `state-load auth.json`. Snapshots land on disk under `.playwright-cli/` (gitignored) and are read on demand. The Playwright MCP server is gone from `.mcp.json` and settings; no doc or config references `mcp__playwright__*` or `.playwright-mcp/`.

**Verification of end state:**

- `playwright-cli` drives an authenticated `/dashboard` on the local app end-to-end on Windows/PowerShell (Phase 1 smoke evidence).
- Grep across the repo for `mcp__playwright`, `@playwright/mcp`, and `.playwright-mcp` returns no live references (archive excluded).
- `npm run typecheck` passes after the `e2e-session.ts` trim.
- The rewritten skill contains no `document.cookie` fast-path and a `state-load`-based primary auth path, with all pre-existing gotchas intact.

### Key Discoveries:

- CLI **`state-save`/`state-load`** is a real command pair backed by a background **daemon** that survives across separate shell invocations (`research.md` §A) — this is what preserves the cookie between commands.
- Because the app is cookie-only, a persisted state file needs only `cookies[]` with `origins:[]` (`research.md` §B). Using the CLI's own `state-save` output (decision below) sidesteps hand-building that schema.
- Load-bearing gotchas are **tool-agnostic** and must survive verbatim into the rewritten skill: the `internal error; reference = …` = wedged/stale dev server root cause, host-scoped (not port-scoped) cookies, and the vite re-optimization empty-page (`SKILL.md:99-101`, `research.md` Historical Context).
- **No storageState emitter in `e2e-session.ts`** — the "CLI state-save is canonical" decision means research Finding C (the ~15-line emitter) is intentionally dropped; the CLI writes its own guaranteed-compatible file.

## What We're NOT Doing

- **Not** adding a Playwright Test Runner, `playwright.config.ts`, or any committed test project — this stays manual verification, not a CI gate (`test-plan.md` §7 dropped-R2).
- **Not** adding a `--state-out` storageState emitter to `scripts/e2e-session.ts` (the "state-save canonical" decision supersedes research Finding C).
- **Not** keeping the `document.cookie` injection fast-path — it is removed from both the skill and `e2e-session.ts`.
- **Not** installing or pinning `@playwright/cli` in this plan — it is already installed on the dev box and invoked as the bare `playwright-cli` binary.
- **Not** touching the four shared test helpers (`tests/helpers/{supabase-clients,users,cookies,seed}.ts`), the `e2e:session` npm wiring, `AGENTS.md`/`CLAUDE.md`, or any §2–§7 test-plan strategy.
- **Not** driving the `wrangler dev` (`:8787`) variant in the Phase 1 smoke-test — the skill keeps documenting it, but the gate is proved against `npm run dev` (`:4321`).

## Implementation Approach

Prove-then-migrate, in three phases with a hard gate:

1. **Prove** the CLI works on the real Windows/PowerShell host — daemon persistence across shells, `state-save`→`state-load` round-trip of an authenticated session, clean `kill-all` teardown. Capture the actual `state-save` file schema. This gates everything else so no doc rewrite is wasted if the daemon misbehaves on Windows.
2. **Rewrite** the skill + docs to the CLI + `state-load` flow, delete the `document.cookie` fast-path (skill step 3-alt and the `e2e-session.ts` print block), and add daemon teardown. Docs are made fully CLI-consistent _before_ the MCP server is removed, so nothing ever points at a removed tool.
3. **Cut over** config last: remove the `playwright` MCP block and its permission/enable entries, swap `.gitignore`, and delete the stale `.playwright-mcp/` artifact dir.

## Critical Implementation Details

- **Timing & lifecycle** — Config removal (Phase 3) must come _after_ the skill rewrite (Phase 2). Removing the `playwright` block from `.mcp.json` while the skill still references `mcp__playwright__*` would leave the agent with a broken, tool-less playbook. MCP and CLI can coexist harmlessly during Phases 1–2 (the unused MCP server just sits idle).
- **Debug & observability** — The Phase 1 `state-load` round-trip _must_ be exercised in a **separate shell invocation** from the `state-save`, not the same one — same-shell success would not prove the daemon persistence property that the whole token/session win depends on. The gate is only meaningful if the second shell reconnects a browser the first shell left alive.

---

## Phase 1: Windows Daemon Smoke-Test (Blocking Gate)

### Overview

Empirically prove `playwright-cli` works on this Win11/PowerShell box before any doc or config change depends on it. Capture the real `state-save` file schema and confirm authenticated session round-trips across separate shells. If any step fails, STOP — the migration's assumptions are invalid and the skill must not be rewritten until resolved.

### Changes Required:

This phase produces **evidence + notes**, not source changes. Record findings in the change folder for the rewrite to cite.

#### 1. Smoke-test run + evidence capture

**File**: `context/changes/agent-browser-playwright-cli/change.md` (append a "Phase 1 smoke findings" note)

**Intent**: Run the CLI against the live local app through a full authenticated flow and record what actually happens on Windows — so the skill rewrite documents proven behavior, not assumptions.

**Contract**: The smoke sequence, each step a _separate_ PowerShell invocation, against `npm run dev` on `http://localhost:4321` with a user from `npm run e2e:session`:

1. `playwright-cli open http://localhost:4321/auth/signin --headed` → confirm a snapshot path is printed and the daemon starts.
2. `playwright-cli` fill Email/Password (from `e2e:session`) + click "Sign in" → confirm redirect to `/dashboard` with the board rendered.
3. `playwright-cli state-save auth.json` → **inspect the file** and record its exact JSON shape (confirm `{ cookies: [...], origins: [...] }`, that `sb-127-auth-token` is present with a `localhost` domain).
4. In a **new shell**: `playwright-cli close-all` (or equivalent to drop the live browser), then `playwright-cli open http://localhost:4321/` → `state-load auth.json` → navigate `/dashboard` → confirm the session is restored (board renders, no bounce to `/auth/signin`).
5. `playwright-cli kill-all` (or `close-all` + daemon stop) → confirm the daemon and browser processes are gone and no listener is left squatting.

Record: exact commands that worked, the state-file schema, whether cross-shell reconnect worked, and the correct teardown command(s).

### Success Criteria:

#### Automated Verification:

- Local Supabase stack reachable: `npx supabase status`
- Ports clean before the run: `netstat -ano | findstr LISTENING | findstr ":4321 :4322 :4323 :4324 :8787"` returns nothing
- The saved `auth.json` parses as JSON and contains a `cookies` array including `sb-127-auth-token`

#### Manual Verification:

- CLI drives form sign-in to an authenticated `/dashboard` on `:4321`
- `state-save` → `state-load` in a **separate shell** restores the authenticated session (board renders, no redirect to `/auth/signin`)
- `kill-all`/teardown leaves no orphaned daemon, browser, or port squatter
- The exact working commands + state-file schema + teardown command are recorded in `change.md`

**Implementation Note**: This phase is predominantly manual. After the automated checks pass and the smoke run succeeds, pause for human confirmation that the round-trip and teardown genuinely worked on the Windows box before starting Phase 2. If the daemon does not persist across shells or teardown is unclean, STOP and resolve before rewriting docs.

---

## Phase 2: Skill + Docs Rewrite

### Overview

Rewrite the `e2e-browser` skill and supporting docs to the `playwright-cli` + `state-load` flow using the proven commands from Phase 1, remove the `document.cookie` fast-path everywhere, and add daemon teardown — all while the MCP server still exists (removed in Phase 3), so the playbook is never tool-less.

### Changes Required:

#### 1. Rewrite the skill playbook

**File**: `.claude/skills/e2e-browser/SKILL.md`

**Intent**: Replace `mcp__playwright__*` interaction steps with `playwright-cli` shell commands; make `state-load auth.json` the primary authenticated-session path (established via a one-time CLI form sign-in + `state-save`, per Phase 1); delete the `document.cookie` fast-path; add daemon teardown. Preserve every prerequisite, gotcha, route, and the `wrangler dev` variant verbatim — they remain valid and load-bearing.

**Contract**: Concrete edits —

- Frontmatter `description` (line 3): "via Playwright MCP" → "via Playwright CLI".
- Body intro (line 8): `mcp__playwright__*` tools → `playwright-cli` shell commands.
- Steps 3/3-alt: keep form sign-in as the mint path; **replace** the `browser_*` tool calls with `playwright-cli` equivalents from Phase 1; add the `state-save auth.json` step after a successful sign-in and a `state-load auth.json` re-use path; **delete** step 3-alt (`document.cookie` injection) entirely.
- Step 4: `browser_snapshot`/`browser_click`/`browser_fill_form` → the `playwright-cli` snapshot/click/fill commands; artifact dir `.playwright-mcp/` → `.playwright-cli/`.
- Teardown: add a daemon `kill-all` (or the exact teardown command proven in Phase 1) as the first teardown step, before the server `taskkill`.
- Preserve unchanged: all of Prerequisites, "Routes & selectors", the `wrangler dev` variant, every bullet under "Gotchas", and the cleanup `e2e:session -- --cleanup` step.

#### 2. Trim the removed fast-path from the session script

**File**: `scripts/e2e-session.ts`

**Intent**: Remove the `document.cookie` injection print block now that the fast-path is gone from the skill. Keep user provisioning, the `Cookie:` header line (still useful for raw HTTP/curl checks), and the cleanup command.

**Contract**: Delete the `cookiePairs` `document.cookie` print loop (`scripts/e2e-session.ts:70-73`) and its "Cookie pairs (for document.cookie injection…)" header line. `cookiePairs` (`:63`) becomes unused — remove it too. The `signInAndCaptureCookies` call and the `Cookie header` print (`:69`) stay. Must keep `npm run typecheck` green (no unused-variable / narrowing errors).

#### 3. Refresh the testing README

**File**: `tests/README.md`

**Intent**: Update the "Browser verification (agent-driven)" prose so it points at the CLI flow and mentions the `state-save`/`state-load` auth file.

**Contract**: Section at `tests/README.md:86-88` — replace MCP wording with `playwright-cli`; note that auth is persisted via `state-save auth.json` and restored with `state-load`. Keep the pointer to the `e2e-browser` skill.

#### 4. Refresh the test-plan snapshot rows

**File**: `context/foundation/test-plan.md`

**Intent**: Update the two rows that cite Playwright MCP so the foundation docs reflect the CLI, without altering the e2e-not-a-gate decision.

**Contract**: §4 stack snapshot (`:108`) and §8 freshness ledger (`:305`) — replace "Playwright MCP" with "Playwright CLI"; keep the dropped-R2 / e2e-not-a-gate wording (§7) exactly as-is.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- No `document.cookie` or `mcp__playwright` references remain in `.claude/skills/e2e-browser/SKILL.md` or `scripts/e2e-session.ts` (grep)
- `SKILL.md` references `playwright-cli` and `state-load`

#### Manual Verification:

- Following the rewritten skill end-to-end drives an authenticated `/dashboard` via `playwright-cli` (using Phase 1's proven commands)
- All original gotchas, prerequisites, routes, and the `wrangler dev` variant are still present and accurate
- `npm run e2e:session` still prints usable credentials + `Cookie:` header + cleanup command (no broken output after the trim)

**Implementation Note**: After automated checks pass, pause for human confirmation that a clean run through the rewritten skill actually authenticates and verifies UI before proceeding to Phase 3 (config removal is the irreversible commit step).

---

## Phase 3: Config Cutover + Cleanup

### Overview

With the CLI proven (Phase 1) and all docs CLI-consistent (Phase 2), remove the Playwright MCP server and its wiring, swap gitignore entries to the CLI artifact/state paths, and delete the stale MCP artifact dir. This is the point of no return for the MCP flow.

### Changes Required:

#### 1. Remove the MCP server block

**File**: `.mcp.json`

**Intent**: Drop the Playwright MCP server; keep the `cloudflare` server.

**Contract**: Remove the `"playwright"` stdio server block (`.mcp.json:7-11`). Result: `mcpServers` contains only `cloudflare`. File must remain valid JSON.

#### 2. Prune the MCP permission + enable entries

**File**: `.claude/settings.local.json`

**Intent**: Remove the MCP permission and the enabled-server entry now that the server is gone; optionally allow the CLI binary if a permission prompt is otherwise triggered.

**Contract**: Remove `"mcp__playwright"` from `permissions.allow` (`:4`) and `"playwright"` from `enabledMcpjsonServers` (`:12-15`, leaving `"cloudflare"`). Optionally add a `Bash(playwright-cli *)` allow entry if invoking the CLI prompts. File must remain valid JSON.

#### 3. Swap gitignore entries

**File**: `.gitignore`

**Intent**: Ignore the CLI artifact dir and the state file; drop the stale MCP ignore.

**Contract**: At `.gitignore:49-50`, replace the `# playwright mcp artifacts` / `.playwright-mcp/` block with `.playwright-cli/` and the state-file path (`auth.json`, or the exact path confirmed in Phase 1). Comment updated to reference the CLI.

#### 4. Delete the stale MCP artifact dir

**File**: `.playwright-mcp/` (directory, ~70 gitignored artifacts)

**Intent**: Remove dead spike artifacts from the old flow.

**Contract**: Delete the `.playwright-mcp/` directory. It is gitignored and non-load-bearing; no code reads it.

### Success Criteria:

#### Automated Verification:

- `.mcp.json` parses as JSON and contains only the `cloudflare` server
- `.claude/settings.local.json` parses as JSON with no `mcp__playwright` / `playwright` MCP entries
- Repo-wide grep for `mcp__playwright`, `@playwright/mcp`, `.playwright-mcp` returns no live (non-archive) references
- `.playwright-mcp/` directory no longer exists

#### Manual Verification:

- After removing the MCP server, a fresh agent run using the `e2e-browser` skill still drives the browser via `playwright-cli` (no dependence on the removed server)
- `.gitignore` correctly ignores generated `.playwright-cli/` artifacts and `auth.json` (a smoke run leaves the working tree clean of new tracked files)

**Implementation Note**: After automated checks pass, do a final manual run through the skill to confirm the whole flow works with the MCP server removed. This closes the migration.

---

## Testing Strategy

### Unit Tests:

- None added — this is tooling/config/docs. The existing vitest suite and its shared helpers are untouched and must remain green (`npm run typecheck` + existing `npm test` unaffected by the `e2e-session.ts` trim).

### Integration Tests:

- The Phase 1 smoke run _is_ the integration test for the tool itself: provision → CLI form sign-in → `state-save` → cross-shell `state-load` → authenticated `/dashboard` → teardown.

### Manual Testing Steps:

1. `npx supabase status` (start if down); confirm ports 4321–4324/8787 are clear.
2. `npm run dev` (background); confirm the startup banner says `http://localhost:4321/`.
3. `npm run e2e:session` → capture email/password/cleanup command.
4. Drive the full rewritten-skill flow with `playwright-cli`: sign in, `state-save auth.json`, then in a new shell `state-load auth.json` → `/dashboard` renders authenticated.
5. Exercise a representative UI check (board columns "Interesujące"/"Zaaplikowano"/"Rozmowa" render).
6. Teardown: `playwright-cli kill-all`, `taskkill` the dev server, `npm run e2e:session -- --cleanup <userId>`.

## Performance Considerations

The migration's entire point is token efficiency: snapshots go to disk (read on demand) instead of MCP pushing a ~30-tool schema + full snapshot into context every call (research cites ~4.6× fewer tokens). No runtime performance concern for the app itself — this is dev-tooling only.

## Migration Notes

- No data migration. The only stateful artifact is the on-disk `auth.json`, which is regenerated per session (short-lived Supabase access token) and gitignored.
- MCP and CLI coexist safely through Phases 1–2; the cutover (Phase 3) is the single irreversible step. Rollback, if ever needed, is restoring the `playwright` block in `.mcp.json` + the two `settings.local.json` entries (git-tracked, trivially revertible).

## References

- Research: `context/changes/agent-browser-playwright-cli/research.md`
- Change intake / scope decisions: `context/changes/agent-browser-playwright-cli/change.md`
- Current skill (rewrite target): `.claude/skills/e2e-browser/SKILL.md`
- Session script (trim target): `scripts/e2e-session.ts:63,70-73`
- Prior MCP spike (predecessor): `context/archive/2026-07-07-agent-e2e-playwright-mcp/`
- Cookie-only auth confirmation: `src/lib/supabase.ts:10-24`, `src/middleware.ts:7-12`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Windows Daemon Smoke-Test (Blocking Gate)

#### Automated

- [x] 1.1 Local Supabase stack reachable (`npx supabase status`)
- [x] 1.2 Ports 4321–4324/8787 clean before the run
- [x] 1.3 Saved `auth.json` parses as JSON and contains `sb-127-auth-token` in `cookies`

#### Manual

- [x] 1.4 CLI drives form sign-in to authenticated `/dashboard` on `:4321`
- [x] 1.5 `state-save`→`state-load` in a separate shell restores the authenticated session
- [x] 1.6 `kill-all`/teardown leaves no orphaned daemon, browser, or port squatter
- [x] 1.7 Working commands + state-file schema + teardown command recorded in `change.md`

### Phase 2: Skill + Docs Rewrite

#### Automated

- [ ] 2.1 Type checking passes (`npm run typecheck`)
- [ ] 2.2 No `document.cookie` / `mcp__playwright` references remain in `SKILL.md` or `e2e-session.ts`
- [ ] 2.3 `SKILL.md` references `playwright-cli` and `state-load`

#### Manual

- [ ] 2.4 Rewritten skill drives an authenticated `/dashboard` via `playwright-cli` end-to-end
- [ ] 2.5 All original gotchas, prerequisites, routes, and `wrangler dev` variant still present and accurate
- [ ] 2.6 `npm run e2e:session` still prints usable credentials + `Cookie:` header + cleanup command

### Phase 3: Config Cutover + Cleanup

#### Automated

- [ ] 3.1 `.mcp.json` parses as JSON and contains only the `cloudflare` server
- [ ] 3.2 `.claude/settings.local.json` parses with no `mcp__playwright` / `playwright` MCP entries
- [ ] 3.3 Repo-wide grep for `mcp__playwright` / `@playwright/mcp` / `.playwright-mcp` returns no live references
- [ ] 3.4 `.playwright-mcp/` directory no longer exists

#### Manual

- [ ] 3.5 Fresh skill run drives the browser via `playwright-cli` with the MCP server removed
- [ ] 3.6 `.gitignore` ignores generated `.playwright-cli/` artifacts and `auth.json` (clean working tree after a run)
