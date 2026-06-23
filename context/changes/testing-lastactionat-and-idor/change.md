---
change_id: testing-lastactionat-and-idor
title: Domain invariants — lastActionAt trigger + endpoint IDOR (test rollout Phase 3)
status: implementing
created: 2026-06-23
updated: 2026-06-23
archived_at: null
---

## Notes

Open a change folder for rollout Phase 3 of context/foundation/test-plan.md: "Domain invariants — lastActionAt + IDOR".
Risks covered: #3 (lastActionAt drift corrupts follow-up flags), #5 (IDOR at applications endpoints — endpoint must enforce ownership independently of RLS).
Test types planned: integration against real Postgres (row-level trigger invariants + endpoint ownership matrix).
Risk response intent:
- #3: prove all four lastActionAt invariants hold at the SQL row level — INSERT sets lastActionAt=createdAt; status change resets to now; application_notes INSERT resets parent to now; non-status field edit leaves it unchanged — and that they survive the next migration. Assert at the row level, never through the service-layer abstraction.
- #5: prove that for each verb (GET/PUT/DELETE) and each owner/actor combination, a request as user B against user A's UUID returns exactly 404 (not 200, not 500, not 403 leaking existence) and never executes the mutation — defence in depth, independent of RLS.
After creating the folder, follow the downstream continuation rule (suggest /10x-research next).
