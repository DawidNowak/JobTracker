---
date: 2026-07-15T11:26:18+02:00
researcher: Dawid Nowak
git_commit: 9b840103eba9574fee5e5496773e5d69e1156851
branch: archive-view
repository: JobTracker
topic: "Archive view (S-11) — read-only archived-application list + full card view with note history"
tags: [research, codebase, archive, read-only, notes, rls, routing]
status: complete
last_updated: 2026-07-15
last_updated_by: Dawid Nowak
---

# Research: Archive view (S-11) — read-only list + full read-only card with note history

**Date**: 2026-07-15T11:26:18+02:00
**Researcher**: Dawid Nowak
**Git Commit**: 9b840103eba9574fee5e5496773e5d69e1156851 (`9b84010`)
**Branch**: archive-view
**Repository**: JobTracker

## Research Question

Implementation-ready research for roadmap slice **S-11 / `archive-view`**: a page listing archived job applications (rows where `archived_at IS NOT NULL`), where clicking an entry opens a **full read-only view** of that application including its **complete note history** — with **no editing possible anywhere** (PRD FR-010, FR-017). Focus areas requested: reuse targets, data & RLS path, read-only guardrails, and nav & routing.

## Summary

**The backend is already done.** S-10 (`reject-to-archive`, shipped in commit `9b84010` / PR #18) delivered the `archived_at` column, the partial archive index, the write path, and — critically — the SELECT RLS policies on `applications` and `application_notes` are pure ownership checks (`user_id = auth.uid()`) with **no `archived_at` clause**, so they already return archived rows. **No migration, index, or RLS change is required.**

What's missing is entirely in the app tier:

1. **Two service functions** — `listArchivedApplications(supabase)` (mirror of `listActiveApplications` with the filter inverted) and a full-row single fetch `getOwnedApplication(supabase, id, userId)` (the existing by-id fetch `getOwnedApplicationState` returns only `status, archived_at`, insufficient to render a card).
2. **The page(s)** — replace the `src/pages/archive.astro` "Wkrótce" placeholder with a real SSR list mirroring `dashboard.astro`; add a `src/pages/archive/[id].astro` detail page (recommended URL shape).
3. **Read-only rendering components** — the strong recommendation from the guardrails research is to **build a separate stripped-down read-only card**, NOT thread a `readOnly` prop through the mutation-coupled `KanbanCard`. The board card's edit/reject/delete/drag surface is large and scattered (≥6 conditional sites plus embedded note CRUD), so a flag risks leaking an affordance — exactly the FR-017 failure mode.

The nav link "Archiwum" → `/archive` already exists (`AppNav.astro:21`), `/archive` is already behind the middleware auth gate (and `startsWith` covers a future `/archive/[id]`), and reusable presentation helpers (`format.ts`, the `CardDetailDialog` field rows, the `listNotes` query) are all available.

## Detailed Findings

### A. Data & RLS path — no schema work needed

**Schema / index / RLS** — `supabase/migrations/20260526123145_applications_schema.sql`:

- `archived_at timestamptz` (nullable; NULL = active) — `:27`
- Partial archive index already present — `:36-38`:
  ```sql
  create index applications_archive_idx
    on public.applications (user_id, archived_at)
    where archived_at is not null;
  ```
- Applications SELECT RLS — pure ownership, **already covers archived rows** — `:42-45`:
  ```sql
  create policy applications_select_own
    on public.applications for select
    to authenticated
    using (user_id = auth.uid());
  ```
- `application_notes` SELECT RLS — also pure ownership — `:80-83`. The later hardening migration `20260526132205_harden_application_notes_rls.sql` strengthened only INSERT/UPDATE with an `EXISTS` parent check and **deliberately left SELECT as the simple `user_id = auth.uid()` equality** (`:9-13`), so archived note-history reads are fully covered.

**Service layer** — `src/lib/services/applications.ts`:

- `listActiveApplications` — `:7-18` — `select("*").is("archived_at", null).order("created_at", { ascending: false })`. Relies entirely on RLS for ownership (no `.eq("user_id", …)` in the list query).
- **No `listArchivedApplications` exists** (grep-confirmed). The mirror: `.not("archived_at", "is", null).order("archived_at", { ascending: false })` — index-ordered by the existing `applications_archive_idx`.
- **No full-row `getApplicationById`.** The only by-id fetch is `getOwnedApplicationState` — `:77-93` — which selects only `status, archived_at` (used by the archive API route to validate state). A new `getOwnedApplication(...): Promise<ApplicationRow | null>` doing `select("*").eq("id", id).eq("user_id", userId).maybeSingle()` is needed to render a full card. The `.eq("user_id", …)` belt-and-suspenders is the convention every by-id function here uses (`updateApplicationStatus:29-30`, `updateApplication:48-49`, `archiveApplication:64-66`, `deleteApplication:98-99`).

**Notes feed** — `src/lib/services/notes.ts`:

- `listNotes(supabase, applicationId, userId)` — `:6-22` — `select("*").eq("application_id", …).eq("user_id", …).order("created_at", { ascending: false })`. Works unchanged for archived applications; already used by `src/pages/api/applications/[id]/notes/index.ts:29`.

**Types** — `src/types.ts:1-4` re-exports generated Row types directly (no hand-written DTOs):

- `ApplicationRow` → `src/lib/database.types.ts:69-83` — fields: `archived_at`, `company`, `created_at`, `description`, `id`, `last_action_at`, `position`, `recruiter_contact`, `salary`, `source`, `status`, `user_id`, `work_mode`.
- `ApplicationNoteRow` → `database.types.ts:37-43` — `application_id`, `body`, `created_at`, `id`, `user_id`.

### B. Reuse targets

**Page + data pattern to mirror** — `src/pages/dashboard.astro`:

- `:10` `createClient(Astro.request.headers, Astro.cookies)` → `:20` `listActiveApplications(supabase)` → `:34-36` renders `<AppShell>` + island. Fetch inside `if (supabase) { … }`, swallowing RLS/transient errors to render an empty state (`:18-31`).
- Layout `src/layouts/AppShell.astro:1-21` takes `title` + `activeNav: "tablica" | "archiwum"` — reuse directly with `activeNav="archiwum"`.

**Field-rendering (read-only card body)** — `src/components/board/CardDetailDialog.tsx`:

- Props `:6-10` `{ application, open, onOpenChange }`. Fields via local `DetailRow` helper (`:78-85`): title `company — position` (`:26-29`); "Link do oferty" when `parseSourceHref(application.source)` non-null (`:35-46`); "Tryb pracy" `work_mode`; "Wynagrodzenie" `salary`; "Opis" `description` (pre-wrap); "Kontakt do rekrutera" `recruiter_contact` (`:47-66`); then `<CardNotes applicationId={…} />` (`:70`).
- Does **not** render `status`, `created_at`, `archived_at`, or `last_action_at` — the archive view likely wants to add `status` and an "archived on" timestamp.
- ⚠️ Forces `window.location.reload()` on close (`:16-17`) — board-specific; must not be carried into a read-only page. The field-layout block (`:34-67`) + `DetailRow` is the part worth reusing.

**Note history renderer** — `src/components/board/CardNotes.tsx`:

- React island, props `:18-20` `{ applicationId }`. Self-fetches `GET /api/applications/${id}/notes` (`:37-59`), renders composer (`:155-169`), list (`:176-232`), and per-note Edytuj/Usuń + delete `AlertDialog` (`:207-259`). Each row: `note.body` pre-wrap (`:204`) + `formatDateTime(note.created_at)` (`:206`).
- ⚠️ Full add/edit/delete baked in — **not read-only**. Reuse the display-only `<ul>` (`:176-232`) extracted into a shared read-only list, or add a `readOnly` prop that hides the composer + Edytuj/Usuń. The GET endpoint and `ApplicationNoteRow` shape are reusable as-is.

**Formatting helpers** — `src/lib/format.ts` (all drop-in):

- `parseSourceHref(source): string | null` (`:1-11`) — validates http(s) URL for the "Link do oferty".
- `formatDateTime(iso)` (`:15-17`) — `Intl.DateTimeFormat("pl", { dateStyle: "medium", timeStyle: "short" })` — ideal for `archived_at` / note timestamps.
- `formatRelative` (`:56-73`), `isStale`/`isStaleBusinessDays` (`:34-54`) — staleness helpers, **not relevant** to read-only archive.
- `cn()` — `src/lib/utils.ts`. Status/work-mode constants — `src/lib/validation/applications.ts:3-4`. **No salary formatter and no status-badge component exist** — `salary` is free-text rendered raw; a work-mode pill is inlined in `KanbanCard.tsx:208-212` (extract if a badge is wanted); `src/components/ui/LibBadge.astro` is a candidate.

### C. Read-only guardrails — recommend a separate read-only card

Mutation affordances on the board card, all in `src/components/board/KanbanCard.tsx`:

- **Drag-to-change-status**: `useDraggable` (`:70-74`), listeners spread (`:79-80`); the `PATCH …/{id}` status write lives in `KanbanBoard.tsx:80-84` (`onDragEnd` `:59-98`).
- **⋮ menu** (only when `showActions`, `:146`): Szczegóły `:162-168`, Edytuj `:169-175`, Odrzuć (status-gated to Zaaplikowano/Rozmowa) `:176-184`, Usuń `:185-192`.
- **Inline decision prompt** Aplikuj/Pomiń (`showPrompt`, stale Interesujące) `:231-261`; **inline follow-up** button (`followUp`, stale Zaap./Rozmowa) `:213-230`. ⚠️ These live **outside** the `showActions` guard, so not passing action props does NOT strip them.
- **Dialogs mounted** `:266-277`: `CardDetailDialog`, `EditApplicationDialog` (`PATCH …/{id}`), `DeleteApplicationDialog` (`DELETE …/{id}`), `RejectApplicationDialog` (`POST …/{id}/archive`). And `CardDetailDialog` embeds `CardNotes`, which carries full note CRUD (`POST/PATCH/DELETE …/notes`).
- **Existing gating**: only `showActions` (drag-context vs. overlay) and status-based visibility. There is **no `readOnly`/`archived` prop** anywhere.

**Recommendation (from guardrails agent): build a new `ArchiveCard` display-only component**, not a `readOnly` flag on `KanbanCard`. Reasons: (1) the mutation surface is large/scattered — a flag would need conditionals in ≥6 places plus a notes-free detail variant, high risk of a leak; (2) drag is structural (`useDraggable` baked into `KanbanCardDraggable`) — a read-only card should not call it and the archive page should not mount `DndContext` at all; (3) strong reuse is available at the presentational layer — replicate `KanbanCardBody`'s pure display markup (`:142-212, :263`) with zero interactivity. Reuse the `CardDetailDialog` field rows (`:34-67`) for the detail view but omit `CardNotes` or render notes read-only.

### D. Nav & routing

- **Placeholder** `src/pages/archive.astro:1-12` — `AppShell title="Archiwum" activeNav="archiwum"` wrapping a "Wkrótce" section. No data fetch, no `locals.user` read. Replace this.
- **Nav link** `src/components/app/AppNav.astro:19-21` — `<a href="/archive" … activeNav === "archiwum" …>Archiwum</a>` already present; active-state via `cn()` + `activeNav` prop threaded page → `AppShell` → `AppNav`. Prop type is the literal union `"tablica" | "archiwum"` (`AppNav.astro:4-5`, `AppShell.astro:6-7`) — a `/archive/[id]` page still passes `activeNav="archiwum"`, no type change.
- **Auth gate** `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/dashboard", "/archive"]`; gate at `:18-22` uses `startsWith`, so `/archive/[id]` is **already covered**. Pages don't self-guard — `dashboard.astro` relies on middleware and only fetches data (`:10-31`); API routes do their own `if (!user) 401`.
- **Routing shape** — there are **no dynamic Astro page routes** today (only `[id]` API routes using `context.params.id` + `z.uuid()`, e.g. `src/pages/api/applications/[id].ts:10,18-21`). Card detail is currently a **routeless client-side dialog** (`CardDetailDialog` opened from `KanbanBoard.tsx:151`, reloads on close). **Recommended URL shape: a dedicated `src/pages/archive/[id].astro`** — matches the `[id]` + UUID convention, auto-protected by the `/archive` prefix, gives archived entries real bookmarkable URLs and a genuine SSR full-page read-only view (better aligned with FR-017 than reusing the editable, hydration-heavy dialog).
- **Layout stack** — `src/layouts/Layout.astro` (root HTML, global CSS, config `Banner`s, `<slot />`) wrapped by `src/layouts/AppShell.astro:13-20` (injects `<AppNav activeNav={…} />` + `<main>`). New pages use `<AppShell title="…" activeNav="archiwum">`.

## Code References

- `supabase/migrations/20260526123145_applications_schema.sql:27,36-38,42-45,80-83` — `archived_at` col, partial archive index, applications + notes SELECT RLS (ownership-only)
- `supabase/migrations/20260526132205_harden_application_notes_rls.sql:9-13` — SELECT deliberately left simple
- `src/lib/services/applications.ts:7-18` — `listActiveApplications` (mirror for archive)
- `src/lib/services/applications.ts:77-93` — `getOwnedApplicationState` (only status+archived_at; needs a full-row sibling)
- `src/lib/services/notes.ts:6-22` — `listNotes` (reuse as-is)
- `src/types.ts:1-4`, `src/lib/database.types.ts:37-43,69-83` — `ApplicationRow`, `ApplicationNoteRow`
- `src/pages/dashboard.astro:10-36` — SSR fetch → AppShell → island pattern to mirror
- `src/pages/archive.astro:1-12` — placeholder to replace
- `src/components/board/CardDetailDialog.tsx:6-10,34-67,70` — reusable field rows; ⚠️ reload-on-close `:16-17`, embeds `CardNotes`
- `src/components/board/CardNotes.tsx:18-20,176-232` — note-history island; ⚠️ mutating, needs read-only extraction
- `src/components/board/KanbanCard.tsx:70-80,146,162-192,213-261,266-277` — full mutation-affordance map (why to avoid a `readOnly` flag)
- `src/components/board/KanbanBoard.tsx:53,59-98,151,177` — DndContext + status PATCH + detail-dialog trigger
- `src/lib/format.ts:1-11,15-17` — `parseSourceHref`, `formatDateTime` (reuse)
- `src/components/app/AppNav.astro:19-21` — Archiwum nav link (present)
- `src/layouts/AppShell.astro:6-20`, `src/layouts/Layout.astro:1-40` — layout stack
- `src/middleware.ts:4,18-22` — `PROTECTED_ROUTES` (archive covered via `startsWith`)
- `src/pages/api/applications/[id].ts:10,18-21` — `[id]` + `z.uuid()` route-param convention

## Architecture Insights

- **RLS is the ownership boundary; list queries don't re-filter `user_id`.** The archive list should follow suit — filter on `archived_at`, let RLS scope ownership. By-id fetches keep the `.eq("user_id", …)` belt-and-suspenders.
- **The `last_action_at` trigger fires only on `status` change** (`schema.sql:118-122`), so archiving (an `archived_at`-only update) preserves the last-action clock — a full read-only card can faithfully show pre-archive history.
- **Read-only is a component-architecture decision, not a prop.** The board card fuses presentation with dnd + a scattered mutation surface + embedded note CRUD. FR-017 durability is best guaranteed structurally: a separate `ArchiveCard`/`archive/[id].astro` that never imports the mutation machinery, over a flag that must be remembered at every affordance site.
- **Astro-page auth is centralized in middleware** via `startsWith` prefixes — a nested `/archive/[id]` route inherits protection for free; pages just fetch and render.
- **No status/salary formatting layer exists yet** — decide in planning whether the read-only card introduces a status badge (extract the `KanbanCard` pill or use `LibBadge.astro`) or renders raw enum/text like the rest of the app.

## Historical Context (from prior changes)

- `context/archive/2026-07-14-reject-to-archive/plan.md` — the S-10 slice that shipped everything the archive view reads: `:11` (schema/indexes done in F-01), `:12` (RLS `applications_update_own` already authorizes `archived_at`), `:13` (board filter `.is("archived_at", null)`), `:14` (the `last_action_at` trigger is a no-op on archiving — clock preserved "for the future archive view"), and `:34` (`/archive` explicitly left as the "Wkrótce" placeholder "that is S-11"). Progress section (`:225-262`) shows all three phases landed (`cccf496`, `daece52`, `82fa6f2`).
- `context/archive/2026-06-30-notes-and-card-detail/` — S-06, origin of `CardDetailDialog` + `CardNotes` (the note-history renderer the roadmap says to reuse, not reimplement).

## Related Research

- None prior for `archive-view` — this is the first research artifact for the slice. Roadmap slice definition: `context/foundation/roadmap.md:208-217` (S-11). PRD: `context/foundation/prd.md:128-131` (FR-010, FR-017), and the parked non-goal "no search/filter/sort in the archive" `:190` (`roadmap.md:250`).

## Open Questions

1. **Detail URL shape** — dedicated `src/pages/archive/[id].astro` (recommended: real URL, SSR, clean read-only) vs. an on-page dialog within `/archive` (closer to the board's current pattern but inherits editable-dialog baggage). Decide in `/10x-plan`.
2. **Fields to surface** — `CardDetailDialog` omits `status`, `archived_at`, `created_at`. The archive view should almost certainly show at least `status` and an "archived on" date (`formatDateTime(archived_at)`) — confirm the field set and any status badge treatment.
3. **Note-history reuse mechanism** — extract a display-only note list from `CardNotes` vs. add a `readOnly` prop to it. Extraction keeps `CardNotes` untouched and guarantees no composer leaks; a prop is less code but re-touches a mutating component. Lean extraction for the FR-017 guarantee.
4. **Empty state** — copy for "no archived applications yet" (Polish), mirroring the board's empty handling.
5. **List item → detail navigation** — plain `<a href="/archive/{id}">` (SSR, no island) is enough if the detail is its own page; confirm no island is needed for the list at all.
