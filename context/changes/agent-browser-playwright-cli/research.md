---
date: 2026-07-09T12:23:02+02:00
researcher: Dawid Nowak
git_commit: 20a6c506b905c2e0e075e8d4b29b9b6c919a4c62
branch: master
repository: DawidNowak/JobTracker
topic: "Migrate agent-driven browser verification from Playwright MCP to Playwright CLI (with storageState auth persistence)"
tags: [research, codebase, playwright-cli, e2e-browser, auth, supabase-ssr, mcp]
status: complete
last_updated: 2026-07-09
last_updated_by: Dawid Nowak
---

# Research: Playwright CLI as the agent browser interface (replacing Playwright MCP)

**Date**: 2026-07-09T12:23:02+02:00
**Researcher**: Dawid Nowak
**Git Commit**: 20a6c506b905c2e0e075e8d4b29b9b6c919a4c62
**Branch**: master
**Repository**: DawidNowak/JobTracker

## Research Question

We have Playwright MCP configured; the agent knows how to seed and authenticate against the app. MCP is token-heavy and cannot preserve the logged-in state between sessions. Analyze the "Playwright CLI as agent interface" article and plan how to implement it here — specifically: **replace** the MCP server with `@playwright/cli`, and adopt the article's **`storageState`** flow so the agent starts already authenticated.

## Summary

The migration is **feasible and well-supported**, and the two pain points the question names are exactly what the CLI is built to fix:

1. **Token cost** — `@playwright/cli` (verified: real, first-party Microsoft, v0.1.15, ~652k weekly downloads, Apache-2.0) writes accessibility-tree snapshots to disk as timestamped YAML under `.playwright-cli/` and each command just prints the snapshot path. The agent reads a snapshot only when it needs one, instead of MCP pushing a full tool schema (~30 tools) + snapshot into context every call. Docs cite ~4.6× fewer tokens than MCP for the same flow.
2. **Session persistence** — the CLI has a real `state-save <file>` / `state-load <file>` pair (a _daemon_ keeps the browser alive across shell invocations). Crucially, this app stores its session **in a cookie only** (`sb-127-auth-token`, not httpOnly, no localStorage), so a Playwright `storageState` file needs **only the `cookies[]` array** — a clean 1:1 with what the app actually consumes. `scripts/e2e-session.ts` already holds the cookie name/value pairs in memory, so it can emit the state file directly (~15 lines).

The blast radius is small and almost entirely **config + docs**: no installed Playwright dependency exists today (MCP runs via `npx`), the `e2e:session` bootstrap and its four test helpers are browser-tool-agnostic and stay untouched, and the only executable change beyond docs is the storageState emitter in `e2e-session.ts`.

**Two corrections to the article** before planning: (a) loading state is a **command** `state-load <file>`, not a Playwright-Test-Runner `storageState` config block (we have no Playwright Test Runner and should not add one — this is manual verification, not a CI gate); (b) `@playwright/cli` is **pre-1.0 (0.1.15)** so the command surface may drift — pin a version and smoke-test on Windows before committing the skill.

## Detailed Findings

### A. The tool: `@playwright/cli` is real and fits the use case

Verified against the npm registry JSON, `playwright.dev/agent-cli/*` docs, and `github.com/microsoft/playwright-cli`:

- **Identity**: package `@playwright/cli`, binary `playwright-cli`, latest **0.1.15** (published 2026-06-30), Microsoft / Apache-2.0. Install: `npm install -g @playwright/cli@latest` (or `npx playwright-cli`). Distinct from `@playwright/mcp`, `playwright`, `@playwright/test`, and the older unrelated codegen `playwright-cli`.
- **Daemon architecture** (the key design point): a persistent background browser process survives across separate shell invocations — "no startup cost per command." This is what makes one-shell-command-per-action cheap, and it's why cookies/state persist between commands within a session. Named isolated sessions via `-s=<name> <cmd>`; lifecycle via `list` / `close-all` / `kill-all` / `delete-data`.
- **Snapshots**: accessibility tree written to disk as timestamped YAML (e.g. `.playwright-cli/page-<ts>.yml`); refs like `e5`, `e21`, frame-scoped `f0e2`; only interactive elements get refs; refs valid until the next page change. Each command prints the snapshot path (Markdown link), so the agent reads on demand.
- **Command surface** (article claims all verified correct): `open <url> --headed`, `click <ref>`, `fill <ref> <text>`, `press <key>`, `screenshot`, plus `type/check/hover/select/upload/drag/eval/reload/go-back`, tabs, network `route`, `console`, `requests`, `run-code`, tracing/video.
- **State**: `state-save [filename]` (cookies + localStorage) and `state-load <filename>` — _"Save and restore the full browser state in a single file."_

**Caveats to carry into the plan** (verified-vs-inferred was tracked):

- Pre-1.0 → surface may shift between releases; **pin the version** in the skill/commands.
- Node **20+** per the installation page (npm `engines` says 18+ — treat 20+ as safe).
- Browsers auto-download on first use; explicit `playwright-cli install-browser` exists.
- **No Windows-specific docs exist** — the daemon/background-process behavior under PowerShell is unverified and must be smoke-tested on the Win11 box before the skill is trusted (this repo's whole e2e flow is Windows-hosted).
- **Not confirmed**: that the on-disk state file is byte-identical to Playwright Test's `storageState` JSON schema (`cookies[]` + `origins[]`). It saves cookies + localStorage; treat the exact schema as "verify during implementation."

### B. Auth persistence maps cleanly — this app is cookie-only

The decisive finding for the storageState adoption:

- **Session lives in a cookie, never localStorage.** Every Supabase client in `src/` is a `createServerClient` with a cookie adapter (`src/lib/supabase.ts:10-24`); there is **no `createBrowserClient` anywhere**. Middleware reads the session from the cookie header on every request (`src/middleware.ts:7-12`); all auth endpoints go through the same adapter (`src/pages/api/auth/{signin,signup,signout}.ts`). Nothing ever reads session from `localStorage`.
- **Cookie**: `sb-127-auth-token` on the local stack (ref `127` derived from the Supabase URL host, _not_ the app host — so the name is stable across `localhost:4321` and `127.0.0.1:8787`). Value is `base64-`-prefixed encoded session JSON, ~2.7 KB, currently unchunked; `@supabase/ssr` splits into `.0`/`.1`… above 3180 bytes (`chunker.js` `MAX_CHUNK_SIZE`). Iterating captured pairs is chunk-safe by construction.
- **Not httpOnly** — `@supabase/ssr` `DEFAULT_COOKIE_OPTIONS` sets `httpOnly:false` and the app passes them through unmodified (`src/lib/supabase.ts:20`). So the current `document.cookie` fast-path works _at all_ only because of this. Implication: the httpOnly argument for storageState is **neutral today**, but storageState is more future-proof — if the cookie is ever hardened to `httpOnly:true`, `document.cookie` injection breaks and storageState/`addCookies` becomes mandatory.
- **storageState needs cookies only** (`origins: []`). A 1:1 model with what the app consumes.

### C. Emitting `storageState` from `scripts/e2e-session.ts` is ~15 lines

`e2e-session.ts` already has the cookie pairs in memory (`signInAndCaptureCookies` → `cookieString`, split into `cookiePairs` at `scripts/e2e-session.ts:63`; helper at `tests/helpers/cookies.ts:8-37` returns `name=value; …` with attributes stripped). To emit a state file, for each pair synthesize:

```jsonc
{
  "name":     "<from pair>",
  "value":    "<from pair, keep RAW base64- string — do not decode/split>",
  "domain":   "localhost",   // MUST match the host the CLI drives (see risk below)
  "path":     "/",
  "httpOnly": false,
  "secure":   false,          // http on localhost dev
  "sameSite": "Lax",
  "expires":  <now + 400d in epoch seconds>  // or -1 for a session cookie
}
```

Wrap as `{ "cookies": [ … ], "origins": [] }`. The only field requiring a decision is `domain`.

Suggested surface: a new `--state-out <path>` flag (default e.g. `.playwright-cli/auth.json`) on `e2e:session`, keeping the existing `document.cookie` output as a fallback during transition.

### D. Blast radius of removing the MCP server (config + docs, one code file)

**No installed dependency to remove** — `@playwright/mcp` runs via `npx` only; `package.json` / lockfile have zero Playwright entries. Files that reference the MCP flow:

| #   | File / location                                     | What it is                                                                 | Action                                                                                                                                        |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `.mcp.json:7-11`                                    | `playwright` stdio server (`npx @playwright/mcp@latest`)                   | **Remove** the `playwright` server block (keep `cloudflare`)                                                                                  |
| 2   | `.claude/settings.local.json:4`                     | permission `"mcp__playwright"`                                             | Remove; add Bash allow(s) for `playwright-cli` if desired                                                                                     |
| 3   | `.claude/settings.local.json:12-15`                 | `"playwright"` in `enabledMcpjsonServers`                                  | Remove the array entry                                                                                                                        |
| 4   | `.claude/skills/e2e-browser/SKILL.md` (129 lines)   | full playbook; `mcp__playwright__*` at lines 3, 8, 72                      | **Rewrite** interaction steps to `playwright-cli` shell commands + `state-load`; keep all prerequisites/gotchas/routes/teardown (still valid) |
| 5   | `.gitignore:49-50`                                  | `# playwright mcp artifacts` / `.playwright-mcp/`                          | Add `.playwright-cli/` and `*/auth.json` (or the chosen state path); optionally drop the stale `.playwright-mcp/`                             |
| 6   | `scripts/e2e-session.ts:63-73`                      | prints Cookie header + `document.cookie` lines                             | **Add** storageState emitter (Finding C)                                                                                                      |
| 7   | `tests/README.md:86-88`                             | "Browser verification (agent-driven)" section                              | Update prose (MCP → CLI; mention state file)                                                                                                  |
| 8   | `context/foundation/test-plan.md:108,305`           | §4 stack snapshot + §8 ledger (both dated 2026-07-08, cite Playwright MCP) | Refresh rows: CLI replaces MCP; keep dropped-R2 wording                                                                                       |
| 9   | `.playwright-mcp/` (dir, ~70 artifacts)             | past spike snapshots/logs                                                  | Delete (gitignored, non-load-bearing)                                                                                                         |
| 10  | `.playwright-cli/` (empty dir, currently untracked) | future artifact home                                                       | Becomes the CLI artifact dir                                                                                                                  |

**Untouched / load-bearing (do NOT change):** the four test helpers `tests/helpers/{supabase-clients,users,cookies,seed}.ts` (shared with the vitest suite and `tests/global-setup.ts` — they only talk to Supabase, never to a browser tool), the `e2e:session` npm script wiring itself, `AGENTS.md` / `CLAUDE.md` (no Playwright references), and all §2–§7 test-plan strategy.

## Code References

- `.mcp.json:7-11` — Playwright MCP server block to remove
- `.claude/settings.local.json:4,12-15` — MCP permission + `enabledMcpjsonServers` entry
- `.claude/skills/e2e-browser/SKILL.md:3,8,72` — `mcp__playwright__*` references / `.playwright-mcp/` artifact note (full rewrite target)
- `scripts/e2e-session.ts:52,63-73` — sign-in + current Cookie/`document.cookie` emission (add storageState emitter here)
- `tests/helpers/cookies.ts:8-37` — `signInAndCaptureCookies`; returns `name=value` pairs (raw base64- value)
- `src/lib/supabase.ts:10-24` — sole server client + cookie adapter (`httpOnly:false` pass-through at :20)
- `src/middleware.ts:7-12` — session read from cookies per request
- `src/pages/api/auth/{signin,signup,signout}.ts` — all cookie-adapter based
- `.gitignore:49-50` — `.playwright-mcp/` (add `.playwright-cli/` + state file)
- `tests/README.md:86-88` — agent-driven browser verification section
- `context/foundation/test-plan.md:108,305` — §4 stack snapshot + §8 freshness ledger

## Architecture Insights

- **The bootstrap is already decoupled from the browser tool.** `e2e-session.ts` provisions a user and captures cookies via the Supabase admin/SSR path only — swapping MCP for CLI does not touch it beyond _adding_ a state-file emitter. This is why the migration is mostly config + docs.
- **Cookie-only session = the simplest possible storageState.** Server-client-only architecture means `origins:[]` is correct; there is no localStorage reconciliation to get wrong.
- **Daemon model matches the agent-shell pattern.** MCP kept state implicitly in a long-lived server process the agent talked to over stdio; the CLI keeps a daemon the agent talks to over shell. The persistence property is preserved; what changes is that snapshots go to disk instead of into context — that is the entire token win.
- **Host scoping is the one real footgun.** storageState cookies are `domain`-scoped and `localhost` ≠ `127.0.0.1` for cookies (ports don't scope, hosts do). Emit `domain:"localhost"` for `npm run dev`; if `wrangler dev` (`127.0.0.1:8787`) is also driven, emit a second file or parameterize the domain. This mirrors the existing skill gotcha (`SKILL.md:95`, host-scoped not port-scoped) and the archived spike's cookie findings.

## Historical Context (from prior changes)

- `context/archive/2026-07-07-agent-e2e-playwright-mcp/change.md` — the spike that stood up the MCP flow. Confirmed empirically (2026-07-08): cookie injection works end-to-end; the local cookie is a single unchunked `sb-127-auth-token`, not httpOnly, host-scoped (shared `:4321`↔`:8787`). The "internal error; reference = …" sign-in failure was root-caused as **stale/wedged dev-server processes**, not an auth bug — this gotcha and the "verify the startup-banner port" rule must survive into the rewritten CLI skill verbatim.
- `context/archive/2026-07-07-agent-e2e-playwright-mcp/plan.md` / `research.md` — original 4-phase structure (MCP promotion → bootstrap script → spike → skill+docs). The CLI migration can reuse the same phase shape (config → emitter → smoke → skill/docs rewrite).
- `context/foundation/test-plan.md:97,299` (§4 e2e row, §7 dropped-R2) — e2e-as-a-gate is deliberately out of scope for MVP. This migration is verification tooling only; do **not** let the article's `playwright.config.ts` Test-Runner block tempt a committed test project.

## Related Research

- `context/archive/2026-07-07-agent-e2e-playwright-mcp/research.md` — prior feasibility research for the MCP-based flow (auth mechanics, dev-server hazards); the direct predecessor to this document.

## Open Questions

1. **Windows daemon behavior** — does the `playwright-cli` background daemon start/stop cleanly under PowerShell on Win11, and does it collide with the existing "stale server on ports 4321–4324/8787" hazard? Needs a hands-on smoke test before the skill is trusted. (Add a daemon `kill-all` step to teardown.)
2. **State-file schema fidelity** — confirm `state-save` output is a `{cookies, origins}` shape the emitter in `e2e-session.ts` can also produce/consume, or whether we should only ever `state-load` a CLI-produced file (and have `e2e-session.ts` produce a compatible one). Verify at implementation time.
3. **Version pinning** — pin which `@playwright/cli` version the skill targets (0.1.x is pre-1.0); decide global install vs. `npx playwright-cli` (repo convention is `npx` for `@playwright/mcp`, arguing for `npx @playwright/cli@<pinned>`).
4. **State freshness / expiry** — the Supabase access token expires; decide whether the skill regenerates the state file each run (`e2e:session --state-out`) or documents a re-auth trigger when `/dashboard` bounces to `/auth/signin`.
5. **Keep the `document.cookie` fallback?** — retain it in `e2e-session.ts` during transition, or delete once `state-load` is proven on Windows?
