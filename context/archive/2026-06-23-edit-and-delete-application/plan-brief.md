# Edit and Delete Application — Plan Brief

> Full plan: `context/changes/edit-and-delete-application/plan.md`

## What & Why

Users can add applications but cannot fix mistakes or remove dead entries. This change adds **edit** (correct any field after creation — essential for parser corrections, FR-005) and **delete** (permanently remove an application, FR-006/FR-016) from each kanban card. Without these, a mistyped or stale application is stuck on the board forever.

## Starting Point

The backend is already most of the way there: `applicationUpdateSchema` exists, and the `applications` table already has UPDATE + DELETE RLS policies plus a trigger that only bumps `last_action_at` on status change. The route `[id].ts` handles a status-only PATCH; cards are read-only with no edit/delete UI. `AddApplicationDialog` is a complete form template to mirror.

## Desired End State

Every kanban card shows a kebab (⋮) menu with **Edytuj** and **Usuń**. Edit opens a pre-filled dialog (no status, no parse) that updates fields without disturbing the follow-up clock. Delete opens a confirmation whose wording depends on the column (FR-016 vs FR-006) and permanently removes the card. RLS guarantees no cross-user edit/delete.

## Key Decisions Made

| Decision            | Choice                                           | Why (1 sentence)                                                              | Source      |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- | ----------- |
| Card action trigger | 3-dot dropdown menu                              | Clean, extensible, isolates click from drag listeners                         | Plan        |
| Edit form           | Extract shared `ApplicationForm`                 | Single source of truth for fields across add + edit                           | Plan        |
| Update API shape    | Unify PATCH onto `applicationUpdateSchema`       | One handler serves drag-drop `{status}` and full edits; schema already exists | Plan        |
| Delete confirmation | Column-aware text, one dialog                    | Matches FR-006/FR-016 wording exactly                                         | Frame (PRD) |
| Edit scope          | All create fields, no status, no-op save allowed | Excluding status keeps `last_action_at` intact via existing trigger           | Plan        |
| Test coverage       | Service + API integration incl. RLS isolation    | Protects the PRD data-isolation guardrail                                     | Frame (PRD) |

## Scope

**In scope:** full-field edit, hard delete, kebab card menu, column-aware delete confirm, service + route + RLS tests.

**Out of scope:** archive/soft-delete & archive view, status editing in the form, follow-up decision-prompt UI, re-parse in edit, optimistic UI, card detail view.

## Architecture / Approach

Bottom-up: (1) add `updateApplication`/`deleteApplication` services and extend `[id].ts` with a unified PATCH + DELETE; (2) extract field markup from `AddApplicationDialog` into a shared `ApplicationForm`; (3) build `EditApplicationDialog` + `DeleteApplicationDialog` and a kebab menu on `KanbanCard`. Success uses the existing `window.location.reload()` pattern rather than optimistic state.

## Phases at a Glance

| Phase             | What it delivers                                  | Key risk                                                       |
| ----------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| 1. Backend        | Update/delete services, route handlers, RLS tests | Unifying PATCH must not break drag-drop status path            |
| 2. Shared form    | `ApplicationForm` extracted, Add refactored       | Regression to working create flow                              |
| 3. Edit/delete UI | Kebab menu, edit + delete dialogs                 | Menu trigger vs dnd-kit drag listeners; overlay must hide menu |

**Prerequisites:** none (no migration). Phase 3 needs `npx shadcn add dropdown-menu alert-dialog`.
**Estimated effort:** ~2-3 sessions across 3 phases.

## Open Risks & Assumptions

- Menu trigger inside the draggable card needs pointer-event isolation so opening it doesn't start a drag.
- `KanbanCardBody` is reused as the drag overlay — the menu must be gated to the live card only.
- Assumes field edits should not reset `last_action_at` (enforced by the existing trigger; no app-level guard).

## Success Criteria (Summary)

- A user can correct any field of an application and the card stays put with an unchanged follow-up timestamp.
- A user can permanently delete an application, with the correct per-column warning.
- No user can edit or delete another user's application (RLS, test-proven).
