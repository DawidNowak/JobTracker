# S-07 Interesujące Decision Prompt — Plan Brief

> Full plan: `context/changes/interesujace-decision-prompt/plan.md`
> Research: `context/changes/interesujace-decision-prompt/research.md`

## What & Why

Interesujące cards that have sat untouched for **≥ 1 calendar day** should nudge the user to decide, rather than quietly aging. S-07 adds an on-card prompt — **"Zdecyduj — aplikujesz?"** — with **Aplikuj** (move to Zaaplikowano) and **Pomiń** (permanent delete). It's the first threshold slice, so it also establishes the reusable calendar-day computation that S-08 and S-09 will inherit.

## Starting Point

The board is a React `client:load` island. `last_action_at` is DB-owned (bumped on status change or note insert), already present on every card as an ISO string. Both actions' backends already exist and are used elsewhere: drag-drop already calls `PATCH { status }`, and `DeleteApplicationDialog` already hard-deletes with S-07's exact required copy. No date/threshold logic exists anywhere yet.

## Desired End State

A stale Interesujące card shows the prompt (replacing its timestamp) with two buttons. Aplikuj moves it to Zaaplikowano instantly (optimistic, rollback on error); Pomiń confirms then permanently removes it. Fresh cards show the normal timestamp and no prompt. A reusable `isStale(iso, days, now?)` helper — calendar-day correct — backs the gate.

## Key Decisions Made

| Decision             | Choice                                         | Why (1 sentence)                                                          | Source |
| -------------------- | ---------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| Aplikuj wiring       | Optimistic callback (board→column→card)        | UX-consistent with drag; reuses the existing snapshot→PATCH→rollback path | Plan   |
| Pomiń button label   | Reuse `DeleteApplicationDialog` as-is ("Usuń") | Description copy already matches verbatim; zero dialog changes for MVP    | Plan   |
| Threshold helper API | `isStale(iso, days, now?) → boolean`           | One calendar-day primitive S-08/S-09 drop into trivially                  | Plan   |
| Prompt placement     | Inline block, replaces the timestamp           | No layout growth; draws the eye where the date normally sits              | Plan   |
| Gating test approach | Playwright e2e spec                            | Repo has no RTL/jsdom; matches how board UI is already tested             | Plan   |

## Scope

**In scope:** `isStale` helper + unit tests; on-card prompt gated on Interesujące && stale; Aplikuj optimistic move; Pomiń via existing dialog; e2e spec.

**Out of scope:** any API/service/schema/migration change; date library; business-day logic (S-09); dialog copy/label change; RTL/jsdom harness; caching the stale flag.

## Architecture / Approach

Client-side, calendar-day flag computed live per render (never persisted). `isStale` lives in `src/lib/format.ts` alongside `formatRelative` (whose elapsed-24h bucket is deliberately NOT reused). The prompt renders in `KanbanCard`; Aplikuj mirrors the board's optimistic drag mutation via a new `onApply` callback threaded through `KanbanColumn`; Pomiń reuses `DeleteApplicationDialog` unchanged. Buttons stop pointer propagation to avoid triggering dnd-kit drag.

## Phases at a Glance

| Phase               | What it delivers                                 | Key risk                                       |
| ------------------- | ------------------------------------------------ | ---------------------------------------------- |
| 1. Threshold helper | `isStale` + boundary unit tests                  | Local-midnight calendar math (off-by-one / TZ) |
| 2. Prompt + wiring  | On-card prompt, Aplikuj optimistic, Pomiń dialog | Callback plumbing + drag isolation on buttons  |
| 3. E2E coverage     | Playwright spec driving both actions             | Seeding stale data + client:load timing        |

**Prerequisites:** S-05 (status transition) and S-03 (delete) — both done.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- Calendar-day boundary logic is the only genuinely tricky part; unit tests with injected `now` mitigate it.
- Accepted label mismatch: card action says "Pomiń", dialog confirm button says "Usuń".
- Adding a note bumps `last_action_at` and dismisses the prompt — treated as valid "action", consistent with business-logic notes.

## Success Criteria (Summary)

- Stale Interesujące cards prompt; fresh ones don't.
- Aplikuj moves the card (optimistic, rollback on failure); Pomiń permanently deletes it.
- `isStale` unit tests + the decision-prompt e2e spec pass; typecheck/lint/test green.
