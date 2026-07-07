# Agent-driven e2e verification via Playwright MCP — Plan Brief

> Full plan: `context/changes/agent-e2e-playwright-mcp/plan.md`
> Research: `context/changes/agent-e2e-playwright-mcp/research.md`

## What & Why

Agent sessions can already drive a browser via Playwright MCP, but every session re-derives the same fragile flow — and the single most important fact (UI sign-in is a dead end under `astro dev`) lives only in one assistant's private memory. This change turns that into durable repo infrastructure: a bootstrap script, a verified session flow, and a project skill any agent can invoke. Explicitly framed as **agent-assisted manual verification** — the automation of the already-sanctioned manual smoke check — not the CI e2e gate the test plan dropped (R2).

## Starting Point

Playwright MCP is connected but user-scoped under a typo'd name (`palywright`); ephemeral-user provisioning and middleware-compatible cookie capture already exist as test helpers; the sign-in bug and its workaround are undocumented in the repo; `test-plan.md`'s stack snapshot still says "no Playwright MCP" (stale since 2026-06-16).

## Desired End State

A fresh agent session invokes the `e2e-browser` skill and, without consulting research docs or private memory, reaches an authenticated `/dashboard` in a real browser with seeded board state, verifies UI behavior, and tears down cleanly. The Playwright MCP capability is repo-durable (`.mcp.json`), and the sign-in quirk has a documented root cause.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Framing | Agent-assisted manual verification, not an e2e gate | Test plan dropped R2 deliberately; this automates the sanctioned manual check instead | Research |
| Test user | Ephemeral via existing `provisionUser`; no seed user | Established convention; cascade cleanup; no state drift | Research |
| Auth mechanism | Cookie injection (primary unless spike fixes sign-in) | UI sign-in fails under `astro dev`; helper output is byte-compatible with middleware | Research |
| Empirical unknowns | Spike phase in this change (injection trial + `wrangler dev` check) | Playbook ships battle-tested, not hypothetical | Plan |
| Sign-in bug | **In scope**: diagnose to root cause during spike; fix only if contained | If fixed cheaply, the playbook collapses to real form sign-in — higher fidelity forever | Plan |
| MCP config | Promote to `.mcp.json` as `playwright` (fix typo); remove user-scoped duplicate | Repo-durable capability; existing `mcp__playwright` wildcard permission already covers the renamed server | Plan |
| Script shape | Standalone `scripts/e2e-session.ts` via `tsx` (new devDep) | Talks only to Supabase — no `.dev.vars` swap, no test-harness startup | Plan |
| Runtime target | `astro dev` primary; `wrangler dev` documented variant | Fast everyday loop plus the production-faithful path the smoke checklist needs | Plan |
| Skill scope | Full session playbook (prereqs → bootstrap → seeding → verify → teardown + gotchas) | The whole point is "stop re-deriving the flow each session" | Plan |

## Scope

**In scope:** `.mcp.json` promotion + permission cleanup; `scripts/e2e-session.ts` (+`tsx`, `--seed`, `--cleanup`, local-URL safety guard); three spike experiments with recorded findings; `.claude/skills/e2e-browser/SKILL.md`; `tests/README.md` pointer section; `test-plan.md` §4/§8 freshness refresh; private-memory promotion into repo docs.

**Out of scope:** CI e2e gate or Playwright test-runner suite; seeded permanent users; invasive sign-in fix (becomes a follow-up change); test-plan strategy edits; CI wiring for the script.

## Architecture / Approach

Sequenced so each phase feeds the next: promote the MCP server first (later work uses final `mcp__playwright__*` tool names) → build the bootstrap script (the spike needs it) → run the spike (its outcomes decide the skill's primary flow) → write the skill and docs from verified facts. The auth pattern rests on one insight: `signInAndCaptureCookies` uses the same `@supabase/ssr` path as production middleware, so anything presenting those cookies — including a browser jar filled via `document.cookie` — is authenticated.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. MCP server promotion | Repo-durable `playwright` server, clean permissions | Mid-session tool-prefix change requires a restart |
| 2. Session bootstrap script | One command → user + cookies (+ seeded board state) | Path-alias/env resolution outside the test harness |
| 3. Spike | Verified answers to injection / sign-in bug / `wrangler dev` | Sign-in diagnosis is open-ended; fix only if contained |
| 4. Playbook + docs | `e2e-browser` skill, README section, test-plan refresh | Skill encodes a flow that drifts as routes/helpers evolve |

**Prerequisites:** local Supabase stack (`npx supabase start`), populated `.env.test`, session restart after Phase 1.
**Estimated effort:** ~2 sessions — Phases 1–2 in one, the spike + docs in another (spike needs live stack + browser).

## Open Risks & Assumptions

- Cookie injection is assumed viable (`@supabase/ssr` defaults are not `httpOnly`) but unverified — Experiment A is load-bearing; if it fails, fallback is fixing the sign-in bug first or a dev-only session-handoff route (new decision point).
- The sign-in bug diagnosis (Experiment B) may not yield a contained fix — the plan accepts a documented root cause + follow-up change as a valid outcome.
- Renaming the MCP server assumes nothing else on this machine depends on the `palywright` prefix.

## Success Criteria (Summary)

- A fresh agent session completes a full verification cycle (bootstrap → authenticated board → interaction → teardown) from the skill alone.
- The sign-in quirk and its root cause live in the repo (skill + `tests/README.md`), not in private memory.
- `npm test`, `npm run typecheck`, `npm run lint` stay green throughout.
