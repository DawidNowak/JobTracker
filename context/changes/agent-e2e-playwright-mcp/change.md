---
change_id: agent-e2e-playwright-mcp
title: Agent-driven e2e verification via Playwright MCP
status: implementing
created: 2026-07-07
updated: 2026-07-08
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Origin: `/10x-research` query about letting the agent run browser e2e checks on the local app via Playwright MCP.
- Framing constraint: `context/foundation/test-plan.md` explicitly dropped e2e for MVP (R2). This change targets **agent-assisted manual verification**, not an automated e2e gate.
