# Domain invariants — lastActionAt trigger + endpoint IDOR (test rollout Phase 3) — Plan Brief

> Full plan: `context/changes/testing-lastactionat-and-idor/plan.md`
> Research: `context/changes/testing-lastactionat-and-idor/research.md`

## What & Why

Rollout Phase 3 of the test plan: lock two load-bearing domain invariants with integration tests so a future migration or refactor can't silently break them. Risk #3 — the `lastActionAt` trigger that drives follow-up flags. Risk #5 — applications-endpoint IDOR, where the endpoint must enforce ownership independently of RLS (defence in depth).

## Starting Point

The behaviour already works: the status-bump trigger and note-bump trigger live in the schema migration (re-hardened in a later migration), and a cross-user PATCH already 404s via an explicit `.eq("user_id", …)` clause + `.maybeSingle()`. The test infrastructure from Phases 1–2 (local-Supabase integration, `astro dev` HTTP harness, provisioning/cookie helpers, node/workers pool split) is complete and reused unchanged. What's missing is regression coverage that reds if any of this is later broken.

## Desired End State

`npm test` (with a local stack up) runs a new `tests/integration/lastactionat-trigger.test.ts` asserting all four trigger invariants at the row level, and an extended `tests/http/patch-applications.test.ts` asserting the cross-user PATCH ownership matrix (exactly 404, no mutation). A shared `seedApplication` helper backs both. The test plan's §6.3 is corrected to match the live endpoint surface.

## Key Decisions Made

| Decision             | Choice                                                        | Why (1 sentence)                                                                                       | Source   |
| -------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------- |
| IDOR HTTP scope      | PATCH only; SELECT/UPDATE/DELETE at RLS layer                 | No GET/PUT/DELETE handler exists — only POST + PATCH                                                   | Research |
| Non-status invariant | Assert via row-level `source` UPDATE                          | No API path edits non-status fields; the `WHEN` guard makes "unchanged" genuine                        | Research |
| Trigger-bypass case  | Document, don't test                                          | A direct `last_action_at` write isn't trigger-corrected, but no API path reaches it                    | Research |
| Assertion oracle     | PostgREST admin-client column reads                           | `created_at`/`last_action_at` are selectable; raw `pg` would be net-new infra for zero signal          | Research |
| Test file layout     | Two files by risk                                             | Mirrors per-concern file convention; trigger → new integration file, IDOR → extend existing PATCH file | Plan     |
| Seeder shape         | `seedApplication(client, userId, overrides?)` returns the row | Works for both admin and user clients; returns the timestamps the invariants need                      | Plan     |
| npm script           | Keep single `vitest run`                                      | No `test:integration` split exists; Phase 4 CI wires the whole suite                                   | Plan     |
| §6.3 amendment       | Correct verb list + note the split                            | Fix the over-statement without rewriting the cookbook                                                  | Plan     |

## Scope

**In scope:** `tests/helpers/seed.ts`; `tests/integration/lastactionat-trigger.test.ts` (4 invariants); extend `tests/http/patch-applications.test.ts` (IDOR matrix); test-plan §6.3 + §6.6 + §3 status edits.

**Out of scope:** any `src/` change; raw `pg` client; HTTP tests for non-existent verbs; a trigger-bypass negative test; a new npm script; CI wiring (Phase 4).

## Architecture / Approach

Bottom-up: land the `seedApplication` helper, then the trigger invariants (row-level integration, admin-client reads), then the IDOR matrix (HTTP, two-user). Trigger assertions exploit `now()` transaction-stability — invariant #1 is exact equality, #2/#4 strict `>` against a captured pre-state — so no sleeps. The IDOR matrix asserts `toBe(404)` exactly (404-collapse is the existence-leak guard) and re-reads the row to prove no mutation on a denied request.

## Phases at a Glance

| Phase                          | What it delivers                                 | Key risk                                                                               |
| ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1. Helper + trigger invariants | `seed.ts` + 4 row-level invariant tests          | Oracle tautology — mitigated by reverting the trigger locally to confirm reds          |
| 2. IDOR PATCH matrix           | Explicit two-user 404 matrix + no-mutation check | Pinning RLS instead of the app clause — mitigated by dropping `.eq("user_id")` locally |
| 3. Docs correction             | §6.3 verb-list fix, §6.6 note, rollout status    | Low — mechanical doc edits                                                             |

**Prerequisites:** local Supabase stack (`npx supabase start`), `.env.test` populated from `npx supabase status`. All test infra from Phases 1–2 already present.
**Estimated effort:** ~1 session across 3 phases (small surface, strong precedent files).

## Open Risks & Assumptions

- Assumes the local stack is fully migrated — the regression value depends on the invariants holding _after_ every migration, including trigger-hardening.
- Assumes the mutation surface stays POST + PATCH-status only; if a GET/PUT/DELETE handler is later added, the IDOR matrix and §6.3 must be revisited.

## Success Criteria (Summary)

- All four `lastActionAt` invariants pass against the migrated DB; reverting the trigger locally reds at least one.
- Cross-user PATCH returns exactly 404 with no row mutation; dropping the ownership clause reds the test.
- `npm test`, `npm run typecheck`, `npm run lint` all green; test-plan §6.3 matches the live surface.
