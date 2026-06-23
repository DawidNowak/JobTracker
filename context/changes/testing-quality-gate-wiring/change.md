---
change_id: testing-quality-gate-wiring
title: Quality gate wiring — enforce the existing test suite as a required CI gate
status: implementing
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Quality gate wiring".
Risks covered: gating regression for #1-#5 (parser correctness #1, RLS cross-user #2, lastActionAt trigger #3, parser SSRF/allowlist #4, IDOR #5).
Test types planned: CI YAML edits, GitHub Actions secrets, optional scheduled parser-HTML-drift canary.
Risk response intent: Phase 4 adds no new test logic - it locks the floor by enforcing the existing unit + integration suite (Risks #1-#5) as a REQUIRED CI gate on push/PR, running against an ephemeral or local Supabase, with NO coverage threshold (per test-plan.md S7). Optionally add a scheduled parser-HTML-drift canary for the slow-burn portal-HTML-change class of Risk #1. Respect S7 exclusions: no coverage gates/thresholds, no workerd-divergence gate.
After creating the folder, follow the downstream continuation rule.
