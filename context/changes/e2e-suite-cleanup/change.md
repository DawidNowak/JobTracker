---
change_id: e2e-suite-cleanup
title: Clean up drift in the E2E suite found during a /10x-e2e skill audit
status: planned
created: 2026-07-20
updated: 2026-07-20
archived_at: null
---

## Notes

fix drift found while verifying tests/e2e against the /10x-e2e skill's principles: one-test-per-file violations (decision-prompt.spec.ts, reject-application.spec.ts), duplicated column()/date helpers across 4 spec files, missing HTTP-level 404/ownership coverage for the archive-view read pages, and undocumented cascade-cleanup behavior in fixtures.ts
