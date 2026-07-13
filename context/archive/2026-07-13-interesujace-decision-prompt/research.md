---
date: 2026-07-13T12:14:01+0200
researcher: Dawid Nowak
git_commit: bca510b04f0a06e7342672a9f65a1c8828a8255d
branch: master
repository: DawidNowak/JobTracker
topic: "S-07 Interesujące decision prompt — threshold computation, reuse seams, board-face rendering"
tags: [research, codebase, kanban, last_action_at, decision-prompt, S-07]
status: complete
last_updated: 2026-07-13
last_updated_by: Dawid Nowak
---

# Research: S-07 Interesujące decision prompt

**Date**: 2026-07-13T12:14:01+0200
**Researcher**: Dawid Nowak
**Git Commit**: bca510b04f0a06e7342672a9f65a1c8828a8255d
**Branch**: master
**Repository**: DawidNowak/JobTracker

## Research Question

Prepare a plan-ready deep dive for roadmap slice **S-07** (`interesujace-decision-prompt`):
cards in the **Interesujące** column that have had no action for **≥ 1 calendar day** must
display **"Zdecyduj — aplikujesz?"** on the board face, with two actions —
**"Aplikuj"** (single click → move to Zaaplikowano, reusing S-05's transition) and
**"Pomiń"** (confirmation dialog → permanent delete, reusing S-03's path, no archive entry).
Focus areas: (1) threshold computation, (2) reuse seams (S-05/S-03), (3) board-face rendering,
(4) prior-slice history/constraints. PRD refs US-03, FR-015. Prereqs S-05 + S-03 — both **done**.

## Summary

**S-07 requires no new API, service, or schema code.** Every backend seam it needs already exists
and is verified in the live tree:

- **"Aplikuj"** → `PATCH /api/applications/[id]` with `{ status: "Zaaplikowano" }` (the same endpoint
  drag-drop already calls).
- **"Pomiń"** → `DeleteApplicationDialog` (Radix AlertDialog), which already issues the hard
  `DELETE /api/applications/[id]` **and already renders S-07's exact required copy** for `Interesujące`
  cards — _"Usunąć tę aplikację? Tej akcji nie można cofnąć."_ — verbatim. No copy change needed
  (only the confirm-button label is cosmetically `"Usuń"` vs a possible `"Pomiń"`).

The **only genuinely new work is the threshold computation and the on-card prompt UI**:

- There is **no calendar-day / start-of-day / business-day logic anywhere** in the codebase and
  **no date library** (only native `Intl`). S-07 is the first threshold slice, as the roadmap flags.
- The existing `formatRelative` helper (`src/lib/format.ts:30`) uses an **elapsed-24h** `day` bucket
  (`86400s`) — **this must NOT be reused for the "calendar day" threshold**. "≥ 1 calendar day" means
  comparing **local-midnight boundaries**, not 24 elapsed hours.
- Recommended home for the new reusable helper: **client-side, in `src/lib/format.ts`**, mirroring
  `formatRelative`'s injectable `(iso, now = new Date())` signature so S-08 (7-day) and S-09
  (4-business-day) reuse the same pattern and it stays correct under optimistic drag updates.

The prompt renders on the **React `KanbanCard`** body (`src/components/board/KanbanCard.tsx`), gated on
`application.status === "Interesujące"` — a status-conditional rendering pattern already used in the
board (e.g. the add-button only on Interesujące/Zaaplikowano).

## Detailed Findings

### 1. Threshold computation (`last_action_at`)

**Schema / DB ownership** — `supabase/migrations/20260526123145_applications_schema.sql:26`

```sql
last_action_at     timestamptz not null default now(),
```

- Type `timestamptz not null default now()`; **DB name is snake_case `last_action_at`** and the
  generated TS type keeps snake_case (`src/lib/database.types.ts:75` → `last_action_at: string;`).
  There is no camelCase `lastActionAt` at runtime — the roadmap's prose "lastActionAt" == the field
  `application.last_action_at`.
- **DB-owned, never API-set.** Two triggers advance it (and only these two events count as "action"):
  - `BEFORE UPDATE` bumps `last_action_at = now()` only `when (old.status is distinct from new.status)`
    (`...applications_schema.sql:108-122`; function hardened in
    `20260528153903_lock_trigger_function_search_path.sql:16-25`). Non-status field edits leave it untouched.
  - `AFTER INSERT` on `application_notes` bumps the parent via `SECURITY DEFINER`
    `bump_application_last_action_at()` (`...applications_schema.sql:124-157`).
- So S-07's "no action ≥ 1 day" = no status change **and** no note added since `last_action_at`.

**Read path (board)** — arrives on the client as an **ISO string**, not a `Date`:

1. `src/pages/dashboard.astro:20` (SSR) calls `listActiveApplications(supabase)`, groups rows by
   `status` into `Record<ApplicationStatus, ApplicationRow[]>` (`:12-31`), passes to
   `<KanbanBoard client:load applications={grouped} />` (`:35`).
2. `src/lib/services/applications.ts:7-18` — `listActiveApplications` does
   `.select("*").is("archived_at", null).order("created_at", { ascending: false })` — passthrough, no mapping.
3. Consumed today only at `src/components/board/KanbanCard.tsx:94`
   (`const relative = formatRelative(application.last_action_at)`, rendered at `:159`).

**No existing calendar/threshold logic** — `package.json` has no date lib (`date-fns`/`dayjs`/`luxon`/`moment`);
grep for `setHours|startOfDay|calendar|businessDay|86400|toDateString` returns zero hits in `src/`.
The one time helper is `src/lib/format.ts`:

- `formatRelative(iso, now = new Date())` (`:30-47`) — elapsed diff bucketed via `Intl.RelativeTimeFormat("pl")`.
  Its `day` unit is `60*60*24 = 86400s` **elapsed** (`:25`), i.e. **24h, not a calendar day**.
- Injectable `now` param is the established testability convention to copy.

**Recommendation — compute client-side, new helper in `src/lib/format.ts`:**

- The board is fully hydrated (`client:load`); `last_action_at` is already on every card; the call
  site (`KanbanCard.tsx:94`) already imports from `@/lib/format`. Adding a sibling like
  `isStale(iso, thresholdDays, now?)` / `shouldPromptDecision(iso, now?)` is zero-plumbing.
- **Optimistic drag re-writes `last_action_at` client-side** (`KanbanBoard.tsx:66-70` sets
  `last_action_at: new Date().toISOString()`), so a server-computed boolean would go stale on move.
  A client computation over the live field stays correct.
- **Timezone/"calendar day" caveat (must be explicit in the plan):** floor both `last_action_at` and
  `now` to local midnight and compare the day delta (an action at 23:00 yesterday is ≥1 calendar day
  old at 00:30 today). Client-side `Date` methods use the user's local TZ — which is what "calendar
  day" means to the user; a UTC server computation would get boundaries wrong. This is the decisive
  reason the reusable S-07/S-08/S-09 pattern belongs client-side.

### 2. Reuse seams (S-05 transition, S-03 delete)

**ACTION A "Aplikuj" — status transition (S-05):**

- Endpoint `PATCH /api/applications/[id]` — `src/pages/api/applications/[id].ts:12`. Auth-gated
  (`context.locals.user`, 401 if absent), validates UUID, parses body with `applicationUpdateSchema`.
  Body `{ status: "Zaaplikowano" }`; `status ∈ "Interesujące" | "Zaaplikowano" | "Rozmowa"`
  (`src/lib/validation/applications.ts:23-36`). Response `200 { application: row }`.
- Service `updateApplication(supabase, id, input, userId)` — `src/lib/services/applications.ts:40`
  (a narrower `updateApplicationStatus` exists at `:20` but the route uses the general one).
- Invoked today via dnd-kit drag, **not buttons**: `onDragEnd` in
  `src/components/board/KanbanBoard.tsx:54` fires the PATCH at `:74-91`. Board owns the
  `applications` state (`useState`, `:43`), seeded from server props.
- **Seam for Aplikuj:** replicate the optimistic move + PATCH `{ status: "Zaaplikowano" }`. Cleanest
  is an `onApply` callback threaded from `KanbanBoard` down to the card (like `onDragEnd`), OR a
  card-local fetch + `window.location.reload()` (matching delete/edit). See §4 for the trade-off.

**ACTION B "Pomiń" — permanent delete (S-03):**

- Endpoint `DELETE /api/applications/[id]` — `src/pages/api/applications/[id].ts:53`. No body.
  Response `200 { ok: true }` / `404`.
- Service `deleteApplication(...)` — `src/lib/services/applications.ts:60-67` issues
  `.delete().eq("id", id).eq("user_id", userId)` — a **real SQL row delete (HARD delete)**, does
  **not** touch `archived_at`. Matches S-07 "permanent delete, no archive entry."
- **Confirmation dialog** `src/components/board/DeleteApplicationDialog.tsx` (Radix `AlertDialog` via
  `src/components/ui/alert-dialog.tsx`). Props `{ application, open, onOpenChange }`. Already handles
  DELETE + reload (`:44-47`) and resets banner on close (`:32-38`).
  - **Copy already correct:** `deleteMessage()` (`:21-26`) returns _"Usunąć tę aplikację? Tej akcji
    nie można cofnąć."_ for `status === "Interesujące"` — S-07's exact required "Pomiń" wording,
    verbatim. Since a "Pomiń" card is by definition in Interesujące, invoking this dialog needs **no
    copy change**. Only cosmetic gap: confirm button is hardcoded `"Usuń"`/`"Usuwanie…"` (`:80`) —
    relabel to "Pomiń" would need a prop/variant.
  - Wiring today: card kebab "Usuń" item sets `deleteOpen` (`KanbanCard.tsx:131-138`), dialog rendered
    at `KanbanCard.tsx:167-169`. S-07's "Pomiń" button reuses the same open-state mechanism.

### 3. Board-face rendering

- **Board page:** `src/pages/dashboard.astro:35` → `<KanbanBoard client:load ... />`.
- **Columns:** `src/components/board/KanbanBoard.tsx:120-132` maps `applicationStatusValues`
  (`src/lib/validation/applications.ts:3`) → three `<KanbanColumn title={status} .../>`; column is a
  `useDroppable({ id: title })` keyed by the status string.
- **Card:** `src/components/board/KanbanCard.tsx`. Current props (`:18-22`):
  ```ts
  interface Props {
    application: ApplicationRow;
    isOverlay?: boolean;
    isMutating?: boolean;
  }
  ```
  Body (`KanbanCardBody`, `:81-172`) shows company (`:100`), kebab menu Szczegóły/Edytuj/Usuń
  (`:101-141`), position (`:143`), "Link do oferty" (`:144-152`), work-mode badge (`:154-157`),
  relative timestamp (`:159`), then dialogs (`:167-169`).
- **Status-conditional rendering already exists** — e.g. add-button only for
  `status === "Interesujące" || status === "Zaaplikowano"` (`KanbanBoard.tsx:127-130`), and
  `deleteMessage` branches on status. So gating "only Interesujące shows the prompt" follows an
  established pattern.
- **Injection point:** inside `KanbanCardBody`, gated on `application.status === "Interesujące"` &&
  the new `isStale(...)` helper, rendering the prompt text + `<Button>Aplikuj</Button>` +
  `<Button variant="outline">Pomiń</Button>` (place after `:159`, before the dialogs).
- **Interactivity + drag isolation:** the card is inside the `client:load` React island. Any on-card
  button **must `stopPropagation` / `onPointerDown` stop** so it doesn't start a dnd-kit drag (the
  kebab trigger already does this — S-03 pattern). Buttons come from `@/components/ui/button`
  (variants incl. `default`/`outline`/`ghost`, sizes incl. `xs`/`sm`/`icon`).
- **Styling conventions to match:** card container `rounded-md border border-neutral-200 bg-white p-3
shadow-sm`; badges `inline-flex w-fit items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs
text-neutral-700`; muted text `text-neutral-500 text-xs`; error banner `rounded-md border
border-red-200 bg-red-50 p-3 text-sm text-red-700`.

### 4. State-management / refresh pattern (which to follow per action)

Two patterns coexist:

- **Status transitions (drag):** optimistic in-memory update with **snapshot rollback on error** +
  error banner, no reload — `KanbanBoard.tsx:65-92`. Gated by an **`isMutating` single-flight** flag.
- **Delete / Edit dialogs:** no optimism; **`window.location.reload()` on success** —
  `DeleteApplicationDialog.tsx:47`, `EditApplicationDialog.tsx:90`.

**Recommendation:**

- **"Aplikuj"** most naturally mirrors the drag optimistic pattern (PATCH `{ status: "Zaaplikowano" }`,
  optimistically move card + set client `last_action_at`, rollback on error, honor `isMutating`).
- **"Pomiń"** reuses `DeleteApplicationDialog` as-is (DELETE + reload). Wiring is just a "Pomiń"
  button that opens the same delete-state, exactly like the existing "Usuń" menu item.
- Extend the existing `anyOpen`/drag-suppression guard (S-06) so dragging is disabled while a prompt
  interaction is in flight.

## Code References

- `supabase/migrations/20260526123145_applications_schema.sql:26` — `last_action_at timestamptz not null default now()`
- `supabase/migrations/20260526123145_applications_schema.sql:108-157` — status-change + note-insert bump triggers
- `supabase/migrations/20260528153903_lock_trigger_function_search_path.sql:16-25` — hardened trigger fn
- `src/lib/database.types.ts:75` — `last_action_at: string` (Row type)
- `src/lib/format.ts:30-47` — `formatRelative` (elapsed-24h `day` bucket; DO NOT reuse for calendar-day threshold); add new helper here
- `src/pages/dashboard.astro:20,35` — SSR board load + grouped props into `<KanbanBoard client:load>`
- `src/lib/services/applications.ts:7-18` — `listActiveApplications` (`select("*")`, active filter)
- `src/lib/services/applications.ts:40` — `updateApplication` (Aplikuj path)
- `src/lib/services/applications.ts:60-67` — `deleteApplication` (hard delete, no `archived_at`)
- `src/pages/api/applications/[id].ts:12` — `PATCH` (status transition)
- `src/pages/api/applications/[id].ts:53` — `DELETE` (permanent delete)
- `src/lib/validation/applications.ts:3,23-36` — `applicationStatusValues`, `applicationUpdateSchema`
- `src/components/board/KanbanBoard.tsx:43,54,65-92,127-130` — board state, `onDragEnd`, optimistic/rollback, status-conditional add button
- `src/components/board/KanbanCard.tsx:18-22,81-172,94,159,131-138,167-169` — props, body, timestamp call site, kebab→delete wiring, dialog render
- `src/components/board/DeleteApplicationDialog.tsx:21-26,44-47` — status-branched copy (Interesujące wording == S-07 "Pomiń" copy), DELETE + reload
- `src/components/ui/alert-dialog.tsx` — Radix AlertDialog wrapper primitives
- `src/components/ui/button.tsx` — Button variants/sizes for the Aplikuj/Pomiń buttons

## Architecture Insights

- **DB owns `last_action_at`; the app never sets it.** S-07 is a pure _consumer_ of the timestamp —
  it computes a derived, non-persisted flag (roadmap/business-logic: `requiresFollowUp` is computed
  on-the-fly, never cached, to avoid drift).
- **Status is stored as Polish string literals** with a CHECK constraint; UI is a passthrough. Always
  validate/compare against `applicationStatusValues` (S-05 impl-review fixed an unguarded
  `over.id as ApplicationStatus` cast — apply the same bounds check for any status cast in S-07).
- **RLS scopes every row to `auth.uid()`** via denormalized `user_id`; reused endpoints already
  enforce auth (`context.locals.user`, 401), so S-07 adds no auth logic.
- **Two refresh idioms** — optimistic+rollback for status moves, reload-on-success for dialog
  mutations. Match the action to the idiom (Aplikuj→optimistic, Pomiń→dialog reload).
- **New reusable pattern = the calendar-day threshold helper.** Design it once (injectable `now`,
  takes days) so S-08 (7 calendar days) drops in trivially and S-09 (4 _business_ days) extends it.

## Historical Context (from prior changes)

- `context/archive/2026-05-26-applications-schema-and-rls/plan.md:18,23,54` — `last_action_at`
  DB-trigger ownership; status-change-only bump; note-insert bump; `archived_at` is the archive
  mechanism (DELETE does not set it → Interesujące "Pomiń" is a true hard delete).
- `context/archive/2026-05-29-kanban-status-transitions/plan.md:14,19,54,60,220-256` +
  `reviews/impl-review.md:40,60` — React `client:load` board; `isMutating` single-flight;
  snapshot→mutate→PATCH→revert ordering; optimistic client `movedAt`; guarded status casts;
  `formatZodErrors`/`formatApplicationErrors` in `src/lib/http.ts`.
- `context/archive/2026-06-23-edit-and-delete-application/plan.md:32,50,177-181` +
  `reviews/impl-review.md` — drag listeners on wrapper `div` with `onPointerDown` propagation-stop for
  menu/button triggers (S-07 buttons must do the same); `DeleteApplicationDialog` (shadcn AlertDialog,
  status-aware wording); dialog resets banner on close.
- `context/archive/2026-06-30-notes-and-card-detail/plan.md:61,160,174` +
  `reviews/impl-review.md` — `anyOpen` drag-suppression guard threaded through columns/cards;
  reload-on-close pattern (plan-sanctioned for MVP); fetch error handling must check `res.ok` before
  parsing.
- `context/archive/2026-05-29-manual-add-application/plan.md:77-81` — JSON envelope convention
  (`200/201 { application }`, `422 { errors }`, `500 { error }`, `401/404 { error }`); `user_id`
  server-set from `locals.user.id`; `parseSourceHref` "Link do oferty" detection; locale-aware Polish
  relative time.
- `context/foundation/business-logic-notes.md:11-21` — `last_action_at` resets on status-change OR
  note-insert only; thresholds 1 day (Interesujące) / 7 days (Zaaplikowano) / 4 business days
  (Rozmowa); `requiresFollowUp` computed on-the-fly, not persisted.
- `context/foundation/roadmap.md:160-170` — S-07 outcome, prereqs (S-05, S-03 — done), and the
  "first flag slice establishes the threshold-computation pattern" risk note.

## Related Research

- `context/foundation/roadmap.md` — slice S-07 definition and Stream D (notes & proactive prompts).
- Downstream reuse targets: **S-08** (`zaaplikowano-followup-flag`, 7-day) and **S-09**
  (`rozmowa-followup-flag`, 4-business-day) will consume the threshold helper this slice introduces.
  No `context/changes/**/research.md` exists yet for those.

## Open Questions

1. **Aplikuj wiring shape** — callback threaded from `KanbanBoard` (optimistic move, matches drag) vs
   card-local fetch + reload (matches delete/edit). Recommendation: optimistic callback for UX
   consistency with drag, but reload is simpler and plan-sanctioned. _Decide at `/10x-plan`._
2. **Confirm-button label for "Pomiń"** — keep the dialog's hardcoded `"Usuń"`, or add a prop/variant
   so it reads `"Pomiń"`. Copy (description) already matches; only the button label is at stake.
3. **Calendar-day semantics test coverage** — the local-midnight boundary logic needs unit tests with
   injected `now` (e.g. 23:00→00:30 crosses the boundary at ~1.5h elapsed). Confirm the helper's
   contract (days threshold, inclusive `>=`) before S-08/S-09 depend on it.
4. **"Silent" definition edge** — a note added to an Interesujące card bumps `last_action_at` (clears
   the prompt) per the DB trigger; confirm the plan treats note-add as a valid "action" that dismisses
   the decision prompt (consistent with business-logic notes).
