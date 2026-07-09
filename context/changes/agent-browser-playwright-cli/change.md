---
change_id: agent-browser-playwright-cli
title: Migrate agent-driven browser verification from Playwright MCP to Playwright CLI
status: planned
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
