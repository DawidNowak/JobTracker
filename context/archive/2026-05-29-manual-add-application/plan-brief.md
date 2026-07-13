# Manual Add Application (S-02) — Plan Brief

> Full plan: `context/changes/manual-add-application/plan.md`

## What & Why

Land the first write-path slice for JobTracker. A `+` button on the Interesujące and Zaaplikowano column headers opens a shadcn-Dialog modal hosting the add-application form; the form POSTs JSON to a new `/api/applications` endpoint, and the new card renders in the column whose `+` was clicked. This is the first slice where a real authenticated user creates a real row through a real endpoint — every downstream slice (S-03 edit, S-04 parser auto-fill, S-07 decision prompt) reuses the form, the card surface, and the JSON error envelope shipped here.

## Starting Point

F-01 has landed everything at the data layer: `applications`/`application_notes` tables with RLS on `auth.uid()`, a trigger that bumps `last_action_at` only on status change, and `applicationCreateSchema` exported from `src/lib/validation/applications.ts`. S-01 shipped the empty kanban shell at `/dashboard` and a placeholder `/archive`. No domain endpoints exist yet; the only API routes are the three auth ones (form-POST + redirect). The board today is purely static Astro with hard-coded "Brak aplikacji" placeholders and no `<slot />` on `KanbanColumn`.

## Desired End State

Signed-in users see a `+` button in Interesujące and Zaaplikowano column headers (Rozmowa has none). Clicking it opens a modal with the seven form fields (`Źródło` required, the rest optional). Submitting with valid input creates the row, closes the modal, reloads the page, and shows the new card on the right column with company bold, position below, a "Link do oferty" anchor when source is a URL, a work-mode badge when set, and a Polish relative-date timestamp. Server errors keep the modal open with all values preserved and a red banner; field-level validation errors render inline under the offending field. RLS holds end-to-end: user B never sees user A's cards.

## Key Decisions Made

| Decision                | Choice                                                                          | Why (1 sentence)                                                                                                                                   | Source |
| ----------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Submit mechanism        | JSON fetch → 201 + page reload                                                  | Field-level server errors render inline; same JSON contract S-04's parser flow will reuse.                                                         | Plan   |
| Form surface            | shadcn Dialog modal (install `dialog`, `input`, `textarea`, `select`, `label`)  | Keeps board context visible; primitives reused by S-03 (edit) and S-04 (parser); `components.json` already configured for new-york style.          | Plan   |
| Card face content       | Company (bold) / Position / "Link do oferty" if URL / work-mode badge / created | User-specified composition; expanded slightly beyond minimal to include FR-018 ("Link do oferty") here even though the roadmap parked it for S-04. | Plan   |
| FR-018 scope            | Bundled into S-02 (was S-04 in the roadmap)                                     | Implementation is trivial (`URL` constructor + conditional anchor); the user explicitly added it to the card-face spec during planning.            | Plan   |
| Validation error UX     | JSON 422 with `{ errors: Record<field, string> }`; inline messages under fields | Names the project's first error-envelope shape — S-03 and S-04 will reuse it; precise field signal beats a single generic banner.                  | Plan   |
| Description field shape | Single textarea "Opis i wymagane umiejętności" with helper text                 | Matches F-01's deliberate no-skills-column decision; zero-friction paste-from-portal; identical to what S-04's parser will pre-fill.               | Plan   |
| `+` trigger placement   | Icon button in column header, right-aligned                                     | Always visible without scrolling; doesn't compete with cards for vertical space; standard kanban convention.                                       | Plan   |
| Submit-failure UX       | Modal stays open, fields preserved, red banner at top                           | Honors PRD NFR ("no silent data loss" on save failure); user can fix-and-retry without retyping.                                                   | Plan   |

## Scope

**In scope:**

- Server-side query in `dashboard.astro` reading active applications grouped by status (RLS-scoped).
- `KanbanCard.astro` rendering the user-specified card face (company / position / "Link do oferty" / work-mode badge / Polish relative timestamp).
- `KanbanColumn.astro` refactor: card slot with empty-state guard + optional header-action slot.
- `POST /api/applications` endpoint with Zod validation, `user_id` from session, JSON envelope (201/400/401/422/500).
- shadcn primitives installed: `dialog`, `input`, `textarea`, `select`, `label`.
- `AddApplicationDialog.tsx` React island: trigger button + modal + form state + field-level errors + banner + reload-on-success.
- FR-018 "Link do oferty" anchor on the card face (bundled here per user direction).

**Out of scope:**

- Edit / delete flow (S-03), drag-and-drop, status transitions (S-05).
- Card detail view, notes UI, note history (S-06).
- "Pobierz dane oferty" parser button and URL auto-fill (S-04).
- Decision prompts and follow-up flags (S-07/S-08/S-09).
- Archive write/read (S-10/S-11).
- Tests (AGENTS.md hard rule), toast component, optimistic UI, `Astro.locals.supabase` helper.

## Architecture / Approach

Read-first phasing. Phase 1 lands the server query, the card component, and the column slot refactor — the board becomes data-driven and can be verified by hand-inserting rows via Supabase Studio. Phase 2 introduces the API endpoint and verifies it by curl. Phase 3 installs the shadcn primitives, builds the React island, and wires the trigger into the addable column headers. The full flow becomes user-driven only at the end of Phase 3, but each phase has a useful verification surface that doesn't depend on the next.

Server insert runs through the per-request Supabase client (`src/lib/supabase.ts`), inheriting the user's JWT and RLS. `user_id` is server-set from `context.locals.user.id` (never trusted from the request body). Status is dialog-passed based on which `+` was clicked, not relying on the Zod default. After a 201, the client does `window.location.reload()` — full SSR round-trip on a small page, well inside the 500ms NFR.

## Phases at a Glance

| Phase                                    | What it delivers                                                                                               | Key risk                                                                                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Card rendering + column slot refactor | `dashboard.astro` reads applications grouped by status; `KanbanCard.astro`; `KanbanColumn.astro` slot + guard. | Empty-state guard + slot must be correct so placeholder and cards never co-render. RLS isolation must hold from the very first read.        |
| 2. POST /api/applications endpoint       | First JSON API route in the repo + the project's JSON error envelope (201 / 400 / 401 / 422 / 500).            | Setting the envelope shape here — S-03/S-04 will reuse it. Cookie/session flushing on JSON responses needs to match the auth-route pattern. |
| 3. Add modal UI + `+` trigger            | shadcn primitives installed; `AddApplicationDialog.tsx`; `+` in Interesujące + Zaaplikowano headers.           | First Radix Portal under Astro hydration; first React island on the app surface; preserved-on-error form state across 422 vs 5xx paths.     |

**Prerequisites:** F-01 (live), S-01 (live). No new env vars, no new infra.
**Estimated effort:** ~2–3 after-hours sessions across the three phases; Phase 3 is the largest.

## Open Risks & Assumptions

- The JSON envelope agreed here (`201 { application }`, `422 { errors }`, `5xx { error }`) becomes the de facto repo convention. S-03 and S-04 should not re-litigate it.
- "Link do oferty" detection uses the `URL` constructor — bare-domain strings (`linkedin.com/...`) without a protocol show no link. This is per FR-018's "valid URL" wording.
- `window.location.reload()` is the simplest post-success UX; if it produces a perceptible flash on Cloudflare edge later, switch to a targeted client-side refetch — out of scope for this slice.
- Roadmap line for S-02 needs the PRD-refs note updated: FR-018 (Link do oferty) now ships here, not in S-04. S-04's slice description should be amended in the same pass that closes this change.

## Success Criteria (Summary)

- A signed-in user can add a job application from either the Interesujące or the Zaaplikowano column and the new card appears in the column whose `+` was clicked, with the correct face composition.
- Validation errors (missing required `Źródło`) and server errors (5xx, network) both keep the user's input intact and surface a clear message.
- Two-user RLS check holds end-to-end on writes: user B never sees user A's added cards.
