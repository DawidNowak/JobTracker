# Agent-driven e2e verification via Playwright MCP — Implementation Plan

## Overview

Give agent sessions a durable, verified way to drive browser-based verification of the local app through Playwright MCP: promote the MCP server into the repo, add a session-bootstrap script, empirically settle the three auth unknowns (cookie injection, the `astro dev` sign-in bug, `wrangler dev` sign-in), then encode the whole flow into a project skill plus doc updates.

**Framing constraint** (from `change.md` and `context/foundation/test-plan.md:97,108`): this is **agent-assisted manual verification** — the automation of the already-sanctioned manual smoke check (`infrastructure.md:75-77`) — NOT the CI e2e gate that the test plan explicitly dropped (R2). The skill must state this framing so it doesn't read as a backdoor e2e suite.

## Current State Analysis

From `context/changes/agent-e2e-playwright-mcp/research.md` (authoritative baseline):

- **Playwright MCP is connected but user-scoped**: server `palywright` (typo) in `~/.claude.json`, not in project `.mcp.json` (which only has `cloudflare`). Tool permissions partially granted in `.claude/settings.local.json:4-8` — including a typo-free `mcp__playwright` wildcard that is currently dead but becomes the only entry needed after the rename.
- **Session helpers exist**: `tests/helpers/users.ts:7-33` (`provisionUser` — ephemeral `u-<uuid>@test.local`, password `test-password-123`, `email_confirm: true` mandatory) and `tests/helpers/cookies.ts:8-37` (`signInAndCaptureCookies` — returns a `name=value; …` cookie string byte-compatible with what `src/middleware.ts` reads).
- **The blocker**: UI sign-in (`POST /api/auth/signin`) fails with Supabase "internal error" under the Cloudflare-adapter `astro dev` server. Known only from private assistant memory — documented nowhere in the repo. Cookie injection is the workaround (cookies are not `httpOnly` per `@supabase/ssr` defaults, so `document.cookie` should work — unverified).
- **Stale docs**: `test-plan.md:108` still says "no Playwright MCP; checked: 2026-06-16".
- **No `tsx`** in devDependencies; `dotenv` is present. `tests/helpers/users.ts` imports via the `@/` path alias, so the script runner must resolve tsconfig paths (tsx does).

## Desired End State

An agent (or human) can run one script + follow one skill to get an authenticated browser session against the local app and verify UI behavior. Verified by a fresh-session dry run: invoke the skill, reach `/dashboard` authenticated, interact with the board, tear down cleanly.

### Key Discoveries:

- `.claude/settings.local.json:4` already contains a typo-free `mcp__playwright` wildcard permission — the rename makes permissions simpler, not more complex.
- `signInAndCaptureCookies` reads `process.env.SUPABASE_URL`/`SUPABASE_KEY` directly (`tests/helpers/cookies.ts:9-10`) — a standalone script only needs `dotenv` to load `.env.test`; no `.dev.vars` swap, no test harness.
- `enabledMcpjsonServers` in `.claude/settings.local.json:11-13` lists only `cloudflare` — the new server must be added there too or it won't auto-enable.
- `tests/global-setup.ts:66-101` swaps `.dev.vars` during `npm test` — a manually started dev server and the vitest suite must not run concurrently.

## What We're NOT Doing

- **No CI e2e gate, no Playwright test-runner suite** — dropped R2 stays dropped; this is interactive verification only.
- **No seeded/permanent e2e user** — ephemeral `provisionUser` users are the convention (`tests/README.md:74-76`).
- **No invasive sign-in fix** — the bug gets diagnosed to root cause; a fix is applied only if contained (roughly: a small change in `src/lib/supabase.ts` / `src/middleware.ts` / config). An invasive fix becomes a documented follow-up change.
- **No changes to test-plan strategy sections** (§1–§3, §5–§7) — only the §4 stack snapshot and §8 ledger get factual refreshes.
- **No CI wiring for the bootstrap script** — it is a local operator tool.

## Implementation Approach

Order matters: MCP promotion first (so the spike and skill use final `mcp__playwright__*` tool names), then the script (the spike needs it), then the spike (its outcomes decide the skill's primary flow), then the skill + docs (written from verified facts, not hypotheses).

The spike outcome creates one branch point: if the `astro dev` sign-in bug gets a cheap fix, the skill's primary flow is real form sign-in with cookie injection as the fast-path alternative; if not, cookie injection is primary and the bug is documented as a known dead end with root-cause notes.

## Critical Implementation Details

- **Timing & lifecycle**: Phase 1's server rename invalidates the `mcp__palywright__*` tool prefix mid-session — after editing configs, the session must be restarted before Phase 3's browser work. A manually started dev server is not cleaned up by anything; kill it at session end (Windows: `taskkill /F /T /PID <pid>`, mirroring `tests/global-setup.ts:54-64`). Never run the manual dev server and `npm test` concurrently (`.dev.vars` race).
- **Safety guard**: the bootstrap script uses the service-role key. It must hard-assert `SUPABASE_URL` points at the local stack (mirror `tests/setup.ts`) before creating any client, so it can never provision users against a remote project.
- **Cookie chunking**: `@supabase/ssr` may split the auth token into `sb-<ref>-auth-token.0` / `.1` chunks. Injection must set **every** captured pair, and the skill must warn that missing one chunk yields a silent redirect to sign-in, not an error.

## Phase 1: MCP server promotion

### Overview

Make Playwright MCP repo-durable under the correct name and reconcile permissions.

### Changes Required:

#### 1. Project MCP config

**File**: `.mcp.json`

**Intent**: Add the Playwright MCP server at project scope so any clone/agent gets the capability, under the typo-free name `playwright`.

**Contract**: New `mcpServers.playwright` entry — stdio server, `command: "npx"`, `args: ["@playwright/mcp@latest"]` (mirroring the current user-scoped definition). Existing `cloudflare` entry untouched.

#### 2. Permissions & enablement

**File**: `.claude/settings.local.json`

**Intent**: Point permissions at the new tool prefix and auto-enable the project server.

**Contract**: Remove the three `mcp__palywright__browser_*` allow entries (the existing `mcp__playwright` wildcard now covers all tools of the renamed server); add `"playwright"` to `enabledMcpjsonServers`.

#### 3. User-scoped duplicate removal

**File**: `~/.claude.json` (outside repo — user-level config)

**Intent**: Remove the `palywright` server from this project's entry so the session doesn't start two browser servers.

**Contract**: Delete only the `palywright` key under this project's `mcpServers`; touch nothing else in the file.

### Success Criteria:

#### Automated Verification:

- Both config files parse: `node -e "JSON.parse(require('fs').readFileSync('.mcp.json','utf8')); JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8'))"`

#### Manual Verification:

- After a session restart, `mcp__playwright__*` tools are available and no `mcp__palywright__*` tools remain
- `browser_navigate` to any page works without a new permission prompt

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation (requires session restart) before proceeding.

---

## Phase 2: Session bootstrap script

### Overview

A standalone script that provisions an ephemeral user and prints everything a browser session needs — no test harness, no `.dev.vars` swap.

### Changes Required:

#### 1. tsx devDependency

**File**: `package.json`

**Intent**: Add `tsx` as a devDependency (runs TS directly, resolves the `@/` tsconfig path alias that `tests/helpers/users.ts` uses). Add an npm script `e2e:session` for discoverability.

**Contract**: `"e2e:session": "tsx scripts/e2e-session.ts"` in `scripts`; `tsx` in `devDependencies`.

#### 2. Bootstrap script

**File**: `scripts/e2e-session.ts` (new)

**Intent**: One command that yields an authenticated session's ingredients. Loads `.env.test` via `dotenv`, hard-asserts `SUPABASE_URL` is the local stack (mirror `tests/setup.ts` — this script wields the service-role key), then reuses the existing helpers.

**Contract**: Three modes, dispatched on argv:
- default — `provisionUser(createAdminClient())` + `signInAndCaptureCookies(email, password)`; prints userId, email, password, and the cookie pairs (both as a single `Cookie:` header string and as one `name=value` per line for `document.cookie` injection).
- `--seed <n>` — additionally inserts `n` application rows for the new user via `tests/helpers/seed.ts` `seedApplication`, so the board has state to verify against.
- `--cleanup <userId>` — `cleanupUser(admin, userId)`; cascade wipes the user's rows.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- With the local stack up: `npm run e2e:session` prints a userId and a non-empty cookie string
- `npm run e2e:session -- --cleanup <userId>` removes the user (verify: re-running cleanup for the same id is a no-op/handled error)

#### Manual Verification:

- Script refuses to run when `.env.test` points at a non-local `SUPABASE_URL` (temporarily edit to confirm the guard fires)

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Spike — settle the empirical unknowns

### Overview

Three live experiments whose outcomes shape the Phase 4 playbook. No repo changes required by A and C; B may produce a contained fix. All findings — including negative results — get recorded.

### Changes Required:

#### 1. Experiment A — cookie injection (load-bearing)

**File**: none (browser session)

**Intent**: Prove the recommended flow end to end: local stack up → `npm run dev` (background) → `npm run e2e:session -- --seed 3` → `browser_navigate` to `http://localhost:4321` → inject every cookie pair → navigate to `/dashboard` → the board renders with the seeded applications (no redirect to `/auth/signin`).

**Contract**: Injection via `browser_evaluate` / `browser_run_code_unsafe`, one statement per captured pair:

```js
document.cookie = `${name}=${value}; path=/`;
```

All chunks (`sb-*-auth-token`, `.0`, `.1`, …) must be set; record exactly which cookie names the local stack produced.

#### 2. Experiment B — diagnose the `astro dev` sign-in "internal error"

**File**: potentially `src/lib/supabase.ts` / `src/middleware.ts` / config (only if the fix is contained)

**Intent**: Reproduce the failure through the real form (`/auth/signin`, fields `email`/`password`, submit "Sign in") with the Phase 2 user, then root-cause it: capture the exact error + reference id, check dev-server logs, determine whether the failing call reaches the local GoTrue (`http://127.0.0.1:54321`) or something else (env resolution, request/cookie context under the Cloudflare adapter dev runtime). Apply a fix only if contained; otherwise document root cause (or the best evidence-backed hypothesis) and open a follow-up change.

**Contract**: If a fix lands, the full suite must stay green (`npm test`) and the fix must not change middleware cookie semantics (that would invalidate `signInAndCaptureCookies` compatibility).

#### 3. Experiment C — UI sign-in under `wrangler dev`

**File**: none (browser session)

**Intent**: `npm run build && npx wrangler dev`, attempt the same form sign-in. Records whether the production-faithful runtime shares the bug — this decides what the skill's `wrangler dev` variant section says.

**Contract**: One attempt, outcome recorded; no fixing anything workerd-specific in this change.

#### 4. Findings record

**File**: `context/changes/agent-e2e-playwright-mcp/change.md`

**Intent**: Append a "Spike findings" subsection under Notes: outcome of A/B/C, exact cookie names observed, root cause (or hypothesis + evidence) for B, and the resulting decision for the skill's primary flow.

**Contract**: Free-form notes; must state the A/B/C outcomes explicitly enough that Phase 4 can be written from this record alone.

### Success Criteria:

#### Automated Verification:

- `npm run typecheck` and `npm test` pass (trivially true if Experiment B produced no code change)

#### Manual Verification:

- Experiment A: authenticated `/dashboard` reached in the MCP browser with seeded board state visible
- Experiment B: root cause identified (or evidence-backed hypothesis documented); fix applied only if contained
- Experiment C: `wrangler dev` sign-in outcome recorded
- Spike findings written to `change.md`
- All spawned servers killed; spike user cleaned up

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding — the findings decide the shape of Phase 4.

---

## Phase 4: Playbook + docs

### Overview

Encode the verified flow into a project skill and promote the private-memory knowledge into durable repo docs.

### Changes Required:

#### 1. Project skill

**File**: `.claude/skills/e2e-browser/SKILL.md` (new)

**Intent**: The full session playbook, written from Phase 3's verified facts. Follows the `blocker-resolved` skill shape (frontmatter with name + invocation-trigger description; numbered steps; explicit edge cases; related-docs links).

**Contract**: Must cover, in order:
- **Framing**: agent-assisted manual verification, not an e2e gate (link `test-plan.md` dropped R2).
- **Prerequisites**: `npx supabase status` (else `start`), `.env.test` populated, no concurrent `npm test` (`.dev.vars` race).
- **Primary flow** (branch on spike outcome): start `npm run dev` in background, `npm run e2e:session [-- --seed <n>]`, then either form sign-in (if B fixed it) or cookie injection (exact verified steps from Experiment A).
- **Routes & selectors table**: `/auth/signin` (fields `email`/`password`, submit "Sign in"), `/dashboard` (protected, board), `/archive` (protected), sign-out (POST-only `/api/auth/signout`).
- **`wrangler dev` variant**: production-faithful path with Experiment C's verified sign-in behavior.
- **Gotchas**: sign-in dead end under `astro dev` (with root cause from B), `email_confirm: true` independence, CSRF 403 on DELETE without `Content-Type: application/json`, chunked cookie names, artifacts land in `.playwright-mcp/` (gitignored).
- **Teardown**: kill dev server (`taskkill /F /T /PID` on Windows), `npm run e2e:session -- --cleanup <userId>`.

#### 2. Testing docs pointer

**File**: `tests/README.md`

**Intent**: A short "Browser verification (agent-driven)" section so humans and non-skill-aware agents can find the flow; promotes the sign-in quirk out of private memory.

**Contract**: One paragraph + link to the skill and `scripts/e2e-session.ts`; states the sign-in-under-`astro dev` caveat in one sentence.

#### 3. Test-plan freshness refresh

**File**: `context/foundation/test-plan.md`

**Intent**: The §4 stack snapshot line "Runtime/browser: none exposed (no Playwright MCP); checked: 2026-06-16" is stale; the §8 ledger requires the refresh. Keeps the "e2e not planned for MVP" decision honest by documenting what changed.

**Contract**: Update the §4 Runtime/browser line (Playwright MCP now project-scoped in `.mcp.json`; agent-assisted manual verification available via the `e2e-browser` skill; `checked: <today>`); add a ledger note in §8. No strategy-section edits.

#### 4. Assistant memory update

**File**: `~/.claude/projects/C--Dev-JobTracker/memory/feedback_playwright_auth_workaround.md`

**Intent**: The private memory that held the sign-in quirk should now point at the durable repo docs (and reflect Experiment B's root cause) instead of being the only home of the knowledge.

**Contract**: Rewrite to reference the skill + `tests/README.md`; update `MEMORY.md` index line accordingly.

### Success Criteria:

#### Automated Verification:

- `.claude/skills/e2e-browser/SKILL.md` and the `tests/README.md` section exist: `ls .claude/skills/e2e-browser/SKILL.md`
- Markdown formatting passes: `npx prettier --check .claude/skills/e2e-browser/SKILL.md tests/README.md context/foundation/test-plan.md`

#### Manual Verification:

- Fresh-session dry run: a new agent session invokes the skill and completes a full cycle (bootstrap → authenticated `/dashboard` → one board interaction verified → teardown) without consulting `research.md` or private memory
- `test-plan.md` §4/§8 read correctly and touch no strategy content

---

## Testing Strategy

### Unit Tests:

- None new — the script reuses already-tested helpers (`provisionUser`, `signInAndCaptureCookies`, `seedApplication`); it is operator tooling, not product code.

### Integration Tests:

- Existing suite (`npm test`) must stay green, especially if Experiment B lands a fix in `src/lib/supabase.ts` — the HTTP smoke suite (`tests/http/**`) exercises the same cookie path.

### Manual Testing Steps:

1. Phase 1: restart session, confirm `mcp__playwright__*` tools respond.
2. Phase 2: run `npm run e2e:session` with the stack up; confirm printed cookie string; run `--cleanup`; confirm the guard refuses a non-local URL.
3. Phase 3: the spike IS the manual test — follow the experiment steps.
4. Phase 4: the fresh-session dry run of the skill (the change's true acceptance test).

## Performance Considerations

None — local developer tooling. The only cost worth noting: `npx @playwright/mcp@latest` downloads on first use per collaborator (accepted in the MCP-promotion decision).

## Migration Notes

- Collaborators with their own user-scoped `palywright` entry should remove it to avoid duplicate servers (mention in the PR description).
- `.playwright-mcp/` is already gitignored; no repo hygiene changes needed.

## References

- Related research: `context/changes/agent-e2e-playwright-mcp/research.md`
- Skill-shape precedent: `.claude/skills/blocker-resolved/SKILL.md`
- Session helpers: `tests/helpers/users.ts:7-33`, `tests/helpers/cookies.ts:8-37`, `tests/helpers/seed.ts:1-23`
- Auth path: `src/middleware.ts:4-21`, `src/lib/supabase.ts:6-25`, `src/pages/api/auth/signin.ts:4-20`
- E2e-not-a-gate framing: `context/foundation/test-plan.md:97,108`, `context/foundation/infrastructure.md:75-77`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: MCP server promotion

#### Automated

- [ ] 1.1 Both config files parse via node JSON.parse check

#### Manual

- [ ] 1.2 After session restart, `mcp__playwright__*` tools available and `mcp__palywright__*` gone
- [ ] 1.3 `browser_navigate` works without a new permission prompt

### Phase 2: Session bootstrap script

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`
- [ ] 2.3 `npm run e2e:session` prints userId + non-empty cookie string (stack up)
- [ ] 2.4 `--cleanup <userId>` removes the user; re-run is handled

#### Manual

- [ ] 2.5 Local-URL guard refuses a non-local `SUPABASE_URL`

### Phase 3: Spike — settle the empirical unknowns

#### Automated

- [ ] 3.1 `npm run typecheck` and `npm test` pass

#### Manual

- [ ] 3.2 Experiment A: authenticated `/dashboard` reached with seeded board state
- [ ] 3.3 Experiment B: root cause identified (or evidence-backed hypothesis); fix only if contained
- [ ] 3.4 Experiment C: `wrangler dev` sign-in outcome recorded
- [ ] 3.5 Spike findings written to `change.md`
- [ ] 3.6 Servers killed; spike user cleaned up

### Phase 4: Playbook + docs

#### Automated

- [ ] 4.1 Skill file and README section exist
- [ ] 4.2 Markdown formatting passes prettier check

#### Manual

- [ ] 4.3 Fresh-session dry run completes a full cycle from the skill alone
- [ ] 4.4 `test-plan.md` §4/§8 refreshed without strategy edits
