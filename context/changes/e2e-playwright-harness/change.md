---
change_id: e2e-playwright-harness
title: Playwright E2E harness with board-load exemplar and delete-confirmation test
status: implementing
created: 2026-07-09
updated: 2026-07-13
archived_at: null
---

## Notes

Introduce a Playwright E2E test harness (config, dev-server wrapper reusing the `.dev.vars` swap, auth-without-UI + seed/isolation fixtures reusing existing test helpers), a board-load seed exemplar spec, and a delete-confirmation risk test. Local-only npm script, NOT a required CI gate (respects test-plan §5 "e2e not a gate" decision). Prepares the harness so the imminent flag slices (S-07/08/09) land with E2E coverage.
