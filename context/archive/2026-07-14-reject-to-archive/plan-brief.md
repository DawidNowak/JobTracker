# Reject to Archive — Plan Brief

> Full plan: `context/changes/reject-to-archive/plan.md`

## What & Why

Let a user reject an application that is in **Zaaplikowano** or **Rozmowa** — the card moves off the main kanban into an archived state (`archived_at = now()`). This is roadmap slice **S-10** (PRD FR-009): rejected offers leave the active board without being destroyed, so their history survives for the future archive view.

## Starting Point

Almost all the plumbing shipped in F-01: `applications.archived_at` exists with archive indexes, the `applications_update_own` RLS policy already authorizes the write, and `listActiveApplications` already filters `archived_at IS NULL` — so a card vanishes from the board the moment it's stamped. What's missing is the write path, the domain guard, and the UI affordance.

## Desired End State

An "Odrzuć" item appears in the ⋮ menu of Zaaplikowano/Rozmowa cards (absent on Interesujące). Clicking it → confirm dialog → `POST /api/applications/[id]/archive` → the card leaves the board, its row preserved with `archived_at` set. Archiving an Interesujące card is impossible from the UI and rejected server-side (422).

## Key Decisions Made

| Decision              | Choice                                   | Why (1 sentence)                                                                       | Source  |
| --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- | ------- |
| Scope (which columns) | Zaaplikowano + Rozmowa only              | Interesujące offers were never applied to — they're deleted or promoted, not archived. | Roadmap |
| API surface           | Dedicated `POST .../[id]/archive`        | Keeps `archived_at` out of the general PATCH; blocks client timestamps / un-archiving. | Plan    |
| UI trigger            | "Odrzuć" dropdown menu item              | Mirrors the existing edit/delete menu; keeps the card face clean.                      | Plan    |
| Confirmation          | Confirm dialog before archiving          | No un-archive in MVP; matches the delete confirm pattern.                              | Plan    |
| Interesujące guard    | UI hides it **and** endpoint returns 422 | Enforces the domain rule even against crafted requests.                                | Plan    |
| Archive view          | Out of scope (stays "Wkrótce")           | That's the separate S-11 slice.                                                        | Roadmap |

## Scope

**In scope:** archive service + dedicated endpoint, server-side status guard, "Odrzuć" menu item, confirm dialog, RLS + HTTP + E2E tests.

**Out of scope:** archive view/page, un-archive/restore, archiving from Interesujące, any schema/migration change, changes to the delete flow.

## Architecture / Approach

Dedicated action endpoint owns the write and the rule: a conditional UPDATE matches only an owned, active, Zaaplikowano/Rozmowa row and sets `archived_at`; the endpoint classifies a no-match into 404 (not visible) vs 422 (owner's row is Interesujące/already archived). The board filter and RLS are unchanged. The frontend clones the delete affordance — status-guarded menu item + confirm dialog + reload on success.

## Phases at a Glance

| Phase               | What it delivers                                 | Key risk                                                     |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| 1. Backend + tests  | Service, `POST .../archive`, RLS + HTTP coverage | Correct 404-vs-422 classification without leaking existence. |
| 2. Frontend UI      | "Odrzuć" menu item + `RejectApplicationDialog`   | Guarding the affordance to the right two columns.            |
| 3. E2E (local-only) | Playwright reject spec                           | Not a CI gate; local stack + dev server setup.               |

**Prerequisites:** F-01 schema/RLS (already shipped); local Supabase stack for tests.
**Estimated effort:** ~1–2 sessions across 3 phases.

## Open Risks & Assumptions

- 404-vs-422 classification adds a second read on the no-match path — acceptable, but must keep the non-owner case at exactly 404 per the existence-leak convention.
- After this slice a rejected card is invisible everywhere until S-11 (archive view) ships — expected per the roadmap slice boundary.

## Success Criteria (Summary)

- Rejecting a Zaaplikowano/Rozmowa card removes it from the board; the DB row survives with `archived_at` set (not deleted).
- Interesujące cards expose no reject affordance and the endpoint rejects them (422).
- `npm run typecheck && npm run lint && npm test` green; E2E reject spec passes locally.
