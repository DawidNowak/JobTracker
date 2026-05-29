# Manual Add Application (S-02) — Implementation Plan

## Overview

Land the first write-path slice for JobTracker. A `+` button in the headers of the Interesujące and Zaaplikowano columns opens a shadcn-Dialog modal hosting the add-application form (source required, all other fields optional). On submit, the form POSTs JSON to a new `/api/applications` endpoint, the server validates with the existing `applicationCreateSchema`, inserts under RLS, and returns the new row; the modal closes and the page reloads so the card appears in the column whose `+` was clicked, stamped with its creation timestamp. The card surface, the JSON error envelope, and the dialog primitives shipped here are all reused by S-03 (edit), S-04 (parser-driven add), and S-07 (decision prompt).

## Current State Analysis

What exists today (verified in repo):

- **F-01 foundation is live.** `supabase/migrations/20260526123145_applications_schema.sql` defines `applications` and `application_notes` with RLS scoped to `auth.uid()` on all four CRUD policies, a `BEFORE UPDATE` trigger that bumps `last_action_at` only on status change, and column defaults `created_at = now()` + `last_action_at = now()`. New rows therefore arrive correctly stamped without any client-side timestamp work.
- **Zod write-shape is ready to import.** `src/lib/validation/applications.ts:12-21` exports `applicationCreateSchema` with the exact field set this slice needs: `source` required (`min(1)`), `position`/`company`/`description`/`salary`/`recruiter_contact` nullable optional, `work_mode` enum nullable optional, `status` enum defaulting to `'Interesujące'`. `applicationStatusValues` and `workModeValues` are exported as `as const` tuples — the dialog's status select and work-mode select pull labels directly from them.
- **The board today is purely static Astro.** `src/components/board/KanbanBoard.astro:6-8` maps `applicationStatusValues` to three `KanbanColumn.astro` instances. Each column renders a hard-coded "Brak aplikacji" placeholder (`KanbanColumn.astro:13-15`) — there is no `<slot />`, no card list, no data fetching. The prior slice's plan explicitly deferred the slot+guard to S-02 to avoid a footgun.
- **No domain endpoints, no JSON envelopes anywhere in the repo.** `src/pages/api/` contains only the three auth routes (`signin.ts`, `signup.ts`, `signout.ts`), all form-POST + redirect. This slice introduces the first JSON API surface and the first JSON error envelope shape.
- **shadcn is configured but only `button.tsx` is installed.** `components.json` is present at the repo root with `style: "new-york"`, `iconLibrary: "lucide"`, and aliases pointing at `@/components/ui`. `npx shadcn@latest add dialog input textarea select label` is the supported install path.
- **Auth + middleware are already wired.** `src/middleware.ts:18-22` protects `/dashboard` and `/archive`; `Astro.locals.user` is populated on every request. The per-request Supabase client at `src/lib/supabase.ts:5-23` carries the user's JWT and inherits RLS automatically — domain endpoints just call `createClient(request.headers, cookies)` themselves (the F-01 plan documents this pattern at the Current State Analysis).
- **Existing auth form components are cosmic-theme only.** `src/components/auth/FormField.tsx:6` hard-codes `bg-white/10 border-white/20 text-white` — it cannot be reused on the neutral app surface. The dialog's form gets fresh primitives via shadcn.

### Key Discoveries

- **AGENTS.md rules that directly shape this slice:**
  - "API routes **must** export `const prerender = false`" — applies to the new `/api/applications` route.
  - "React components are only permitted when browser events, state, or hooks are required" — the dialog and its trigger are React (state + click + submit + fetch); the card and the board stay Astro.
  - "Validate all API route inputs with zod; export uppercase handler names (`GET`, `POST`, etc.)" — the new endpoint follows.
  - "Every new Supabase table must have RLS enabled…" — no new tables in this slice; the existing RLS policies handle the insert.
  - "No test framework is configured — do not scaffold tests" — verification is lint/typecheck/build + manual runbook.
  - "Use `cn()` from `@/lib/utils` for all class name merging" — including inside `.astro` templates.
- **`KanbanColumn.astro` needs both a card slot and a header-action slot in this slice.** The card slot was already pre-announced by S-01's plan as S-02's responsibility; the header-action slot is new and exists to render the `+` trigger only on Interesujące and Zaaplikowano (Rozmowa stays without one per FR-007).
- **The status the new row gets is determined by which `+` was clicked, not by the Zod default.** The dialog must accept a `status` prop and submit it explicitly. The Zod default (`'Interesujące'`) remains as the schema-level safety net but should never trigger for a UI-driven add — it would mean we forgot to wire the status through.
- **"Link do oferty" on the card face was parked for S-04 by the roadmap, but the user explicitly bundled it into S-02's card spec during planning.** The implementation is trivial (URL constructor + conditional anchor with `target="_blank"`), so the scope expansion is real but small. Note in the slice update on the roadmap that FR-018 ships here, not in S-04. S-04 then only owns the parser button.
- **This is the auth + RLS end-to-end smoke test.** F-01 verified RLS in isolation; S-01 verified the empty board renders behind auth. S-02 is the first time a real authenticated user creates a real row via a real endpoint — so the manual runbook for Phase 2 includes an explicit two-user RLS cross-check (user A creates, user B sees nothing).
- **No `Astro.locals.supabase` helper exists.** Each endpoint creates its own client. F-01 chose this pattern deliberately; this slice follows it rather than introducing a middleware-level helper.

## Desired End State

- Visiting `/dashboard` while signed in shows three columns. Interesujące and Zaaplikowano headers each have a right-aligned `+` icon button; Rozmowa's header has none.
- Clicking either `+` opens a shadcn modal titled "Nowa aplikacja" with form fields: `Źródło` (required textarea-or-input), `Stanowisko`, `Firma`, `Opis i wymagane umiejętności` (textarea with helper text "Wklej opis oferty wraz z listą wymaganych umiejętności."), `Widełki wynagrodzenia`, `Tryb pracy` (Zdalna / Hybrydowa / Stacjonarna / nie wybrano), `Kontakt do rekrutera` (free text). Buttons: `Anuluj` and `Dodaj`. The target column is identified in the dialog header — e.g., "Nowa aplikacja w kolumnie Interesujące".
- Submitting with empty `Źródło` shows an inline error under the field ("Źródło jest wymagane.") and the dialog stays open. No request is sent (client-side mirror of the Zod required check) or the request is sent and the server response renders the same error — either path is acceptable; the contract is "user sees a field-level message under Źródło".
- Submitting with valid input sends `POST /api/applications` as `Content-Type: application/json`. On `201`, the dialog closes, the page reloads, and the new card appears at the top of the column whose `+` was clicked. The card shows: company in bold, position underneath, a "Link do oferty" anchor (only if `source` is a valid URL — opens in a new tab), a small badge with the work mode (only if set), and a Polish relative-date timestamp ("dodano 2 godziny temu" / "dodano przed chwilą").
- Submitting with a server error (5xx, network failure) keeps the modal open, preserves all field values, and shows a banner at the top of the form: "Nie udało się zapisać aplikacji. Spróbuj ponownie." The user can fix and resubmit without retyping.
- Two-user RLS check holds: user A creates a row, user B logs in and sees an empty board.

### Verification

- `npm run lint` passes.
- `npm run typecheck` passes.
- `npm run build` passes.
- Manual: the runbook below (per-phase Success Criteria) succeeds end-to-end against the hosted Supabase project.

## What We're NOT Doing

- No edit flow (S-03). Cards are display-only in S-02; clicking a card does nothing yet.
- No status transitions or drag-and-drop (S-05). Cards stay in the column they were created in.
- No card detail view, no notes UI, no note history (S-06). The dialog and the card face are the only new surfaces.
- No "Pobierz dane oferty" parser button (S-04). The `Źródło` field is plain free text; no URL detection on the form, no auto-fill.
- No decision prompts, no follow-up flags (S-07/S-08/S-09). `last_action_at` is set by the F-01 default; nothing reads it yet.
- No archive write (S-10), no archive view (S-11).
- No tests scaffolded (AGENTS.md hard rule).
- No middleware-level `Astro.locals.supabase` helper. The endpoint creates its own client (existing pattern).
- No `application_notes` writes. The notes table exists from F-01 but stays untouched here.
- No optimistic UI / in-place card insertion. `window.location.reload()` after success is the MVP path; refactoring to a client-side card store would over-build given the read query is a single `select`.
- No toast component. The post-success feedback is "the card you just added is on the board"; no separate confirmation toast.
- No relative-time library. The Polish relative-date helper is a tiny inline function (`Intl.RelativeTimeFormat('pl')` is built-in to Node and the browser).

## Implementation Approach

Three phases ordered to keep each one independently verifiable:

1. **Read path first.** Add the server-side query in `dashboard.astro`, build `KanbanCard.astro`, refactor `KanbanColumn.astro` to accept slotted cards plus an optional header-action slot, gated by an empty-state guard. After this phase, manually inserting a row via Supabase Studio renders that row on the board with the correct shape. No write path needed yet.
2. **Write API.** Add `POST /api/applications` with Zod validation and the JSON envelope. Verifiable via curl with a session cookie. No UI yet.
3. **Modal + trigger.** Install shadcn primitives. Build `AddApplicationDialog.tsx` and the trigger button. Wire it into both Interesujące and Zaaplikowano column headers. The full flow becomes end-to-end usable.

Each phase has a usable verification surface that doesn't depend on the next one landing. The order also de-risks the trickiest part (the server insert + RLS round-trip) before any client-side state code exists.

## Critical Implementation Details

- **JSON envelope shape (sets repo convention).** Success: `201 { application: <row> }`. Zod failure: `422 { errors: Record<string, string> }` — keys are field names from `applicationCreateSchema`, values are user-readable Polish messages. Server error: `500 { error: string }`. The dialog distinguishes `422` (render under fields) from non-`422` (render banner). S-03 and S-04 will reuse this shape — name it once, here.
- **`user_id` is server-set, not in the request body.** The Zod schema does not include `user_id`; the endpoint resolves it from `context.locals.user.id` (the middleware guarantees a non-null user on protected routes — but `/api/applications` is **not** in `PROTECTED_ROUTES`, so the endpoint must check `locals.user` itself and return `401` if missing). RLS would reject anyway, but a clean `401` is friendlier than a Postgres error.
- **Status determination, not Zod default.** The dialog must explicitly send `status: 'Interesujące'` or `status: 'Zaaplikowano'` based on the column whose `+` was clicked. The Zod default exists as a safety net for non-UI clients; relying on it from the UI would mean we forgot to pass the column through.
- **"Link do oferty" URL detection.** Use the `URL` constructor: `try { new URL(source); show link } catch { show nothing }`. Anchor opens in a new tab with `target="_blank" rel="noopener noreferrer"`. No protocol coercion (no "add `https://` if missing"); if the user pastes a bare domain, no link shows — that matches the FR-018 "valid URL" contract.
- **Empty-state vs cards in the same column.** `KanbanColumn.astro` renders the empty-state placeholder when no card slot content is provided and the cards when it is. Use `Astro.slots.has("default")` so the placeholder and the cards never render simultaneously. Cards render top-to-bottom in reverse-chronological order (newest first) — the query orders by `created_at desc`.
- **`work_mode` on submit when "nie wybrano".** When the user leaves the work-mode select unset, the dialog submits `work_mode: null` (or omits the key — both are valid under the Zod `.nullable().optional()`). Don't submit an empty string `""` — the Zod enum would reject it.
- **CSRF posture.** The new endpoint authenticates by Supabase session cookie and accepts JSON without a CSRF token. We rely on Supabase auth cookies' default `SameSite=Lax`, which blocks cross-origin POSTs from foreign sites in modern browsers. If cookie attributes ever change (e.g., a future SDK upgrade flips to `SameSite=None`), revisit and add a token or origin check. S-03/S-04 inherit this posture.

## Phase 1: Card rendering and column slot refactor

### Overview

Make the board read cards from the database. Add a server-side query to `dashboard.astro` that groups applications by status (filtered to `archived_at IS NULL`), build `KanbanCard.astro` to render the card face per the user's spec, and refactor `KanbanColumn.astro` to accept both a card slot and an optional header-action slot with an empty-state guard. After this phase, a row hand-inserted via Supabase Studio renders on the board.

### Changes Required

#### 1. Server query in dashboard.astro

**File**: `src/pages/dashboard.astro`

**Intent**: Fetch the signed-in user's active applications, group them by status, and pass the groups into `KanbanBoard`. RLS handles per-user isolation; the query just needs to filter out archived rows and order by `created_at desc`.

**Contract**:
- Import the per-request Supabase client; call it with `Astro.request.headers` and `Astro.cookies`. Middleware guarantees `Astro.locals.user` is set on `/dashboard`, but if `supabase` is `null` (env not configured) the page should render an empty board rather than crash — match the existing helper-null pattern used by the auth pages.
- Call `listActiveApplications(supabase)` from `src/lib/services/applications.ts` (defined in § 6). No direct `supabase.from(...)` call in the frontmatter — the service owns the query.
- Group the returned rows in the Astro frontmatter into a `Record<ApplicationStatus, ApplicationRow[]>` keyed by the three `applicationStatusValues`. Pass the map into `<KanbanBoard applications={...} />`.
- On service error (the helper throws or returns a typed error result — implementer picks the shape), log the error and render an empty board (no cards). Surfacing a banner is out of scope for S-02; the slot ships unfilled.
- Astro frontmatter is server-only — `SUPABASE_KEY` stays server-side per AGENTS.md.

#### 2. KanbanBoard accepts the applications map

**File**: `src/components/board/KanbanBoard.astro`

**Intent**: Forward each status's slice of the applications array into its `KanbanColumn`, plus the header-action slot for the addable columns.

**Contract**:
- Props: `applications: Record<ApplicationStatus, ApplicationRow[]>`. Import `ApplicationStatus` from `@/lib/validation/applications`; import the `Row` type from `@/lib/database.types` (`Database['public']['Tables']['applications']['Row']`) and re-export a local alias if convenient.
- For each status in `applicationStatusValues`, render `<KanbanColumn title={status} applications={applications[status]} />`. For Interesujące and Zaaplikowano, also render the `+` trigger inside the column's header-action slot (Phase 3 wires the actual React component; in Phase 1 the slot is unused — Interesujące and Zaaplikowano render no header action yet).
- Status order remains Interesujące → Zaaplikowano → Rozmowa.

#### 3. Refactor KanbanColumn — slots + empty-state guard

**File**: `src/components/board/KanbanColumn.astro`

**Intent**: Replace the hard-coded "Brak aplikacji" body with a slot-based body that shows cards when provided and the empty-state placeholder when not. Add a named slot in the header for the `+` trigger.

**Contract**:
- Props: `title: string`, `applications: ApplicationRow[]`. The `applications` prop drives both the empty-state guard and the card rendering — `applications.length === 0` → show the muted "Brak aplikacji" placeholder; otherwise iterate and render `<KanbanCard application={app} />` for each row.
- Header structure: title on the left, `<slot name="header-action" />` on the right. The slot is optional — when no content is passed, no element renders (avoid empty wrapper divs that would leave hover affordances on Rozmowa).
- Card list uses `flex flex-col gap-2` inside the column body, padding `p-3`. Empty-state styling stays as today (muted, centered).
- Use `cn()` from `@/lib/utils` for any conditional class merging.

#### 4. New component — KanbanCard

**File**: `src/components/board/KanbanCard.astro`

**Intent**: Server-rendered card surface for a single application. No interactivity (S-03 introduces it).

**Contract**:
- Props: `application: ApplicationRow`.
- Layout — vertical stack:
  1. Company in bold (e.g., `text-sm font-semibold text-neutral-900`). When `company` is null, fall back to `"—"` (a single em-dash placeholder) so layout doesn't collapse.
  2. Position underneath (e.g., `text-sm text-neutral-700`). When null, render nothing (no placeholder — position is the most-likely-filled field after company).
  3. "Link do oferty" anchor — only when `source` parses as a URL (`try { new URL(application.source); }`). Anchor: `<a href={application.source} target="_blank" rel="noopener noreferrer" class="text-xs text-blue-600 hover:underline">Link do oferty</a>`. Lucide `ExternalLink` icon optional.
  4. Work-mode badge — only when `application.work_mode` is non-null. Small pill: `inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700`. Text is the Polish enum value verbatim.
  5. Relative timestamp — Polish. Helper `formatRelative(application.created_at)` in `src/lib/utils.ts` (or a sibling `src/lib/format.ts` — implementer's call) using `Intl.RelativeTimeFormat('pl', { numeric: 'auto' })`. For < 60s old, return "przed chwilą"; otherwise return the relative-time string prefixed with "dodano " (e.g., "dodano 2 godziny temu"). Render as `text-xs text-neutral-500`.
- Card container: `rounded-md border border-neutral-200 bg-white p-3 shadow-sm`. No hover state in S-02 (S-03 adds click-to-edit).

#### 5. ApplicationRow type alias (optional convenience)

**File**: `src/types.ts` (anticipated by AGENTS.md project structure; not yet created in the repo)

**Intent**: Export `ApplicationRow` as the row type so other files (`KanbanBoard`, `KanbanCard`, `dashboard.astro`) import a stable alias rather than typing the long `Database['public']['Tables']['applications']['Row']` path repeatedly.

**Contract**: `export type ApplicationRow = Database['public']['Tables']['applications']['Row'];`. Import `Database` from `@/lib/database.types`. Create `src/types.ts` if absent, or skip the alias entirely and use inline `import type` at each call site — the type is a convenience, not load-bearing. (The service module in § 6 also needs the alias; if § 5 is skipped, define it inline there.)

#### 6. New service module — applications

**File**: `src/lib/services/applications.ts` (new — directory may need to be created)

**Intent**: Single home for `applications`-table queries, per AGENTS.md (`src/lib/services/ — functions that query Supabase or orchestrate domain operations`). Owns both the read used by `dashboard.astro` (Phase 1 § 1) and the write used by `POST /api/applications` (Phase 2 § 1). S-03/S-04/S-05/S-10/S-11 will extend this module; this slice seeds it with two functions.

**Contract**:
- Imports: a `SupabaseClient` type alias (`type SupabaseClient = NonNullable<ReturnType<typeof createClient>>` — keeps `createClient`'s null branch where it belongs at the call sites). Import `Database['public']['Tables']['applications']['Row']` as `ApplicationRow` (matches § 5) and `ApplicationCreate` from `@/lib/validation/applications`.
- `export async function listActiveApplications(supabase: SupabaseClient): Promise<ApplicationRow[]>` — runs `supabase.from('applications').select('*').is('archived_at', null).order('created_at', { ascending: false })`. RLS adds the `user_id` predicate. Throw or return `[]` on error — implementer's call, but stay consistent with how `dashboard.astro` consumes it.
- `export async function createApplication(supabase: SupabaseClient, input: ApplicationCreate, userId: string): Promise<ApplicationRow>` — runs `supabase.from('applications').insert({ ...input, user_id: userId }).select('*').single()`. Throw on DB error; let the API route turn it into the JSON envelope.
- No other domain logic here (no Zod parsing — that stays in the route; no envelope shaping — that stays in the route). The service is a thin Supabase wrapper that keeps the query shape in one place.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification

- With zero rows in `applications` for the signed-in user, `/dashboard` still renders three columns each with "Brak aplikacji". No regression from S-01.
- Insert one row via Supabase Studio (or `psql`) under user A's id, status `'Interesujące'`. Reload `/dashboard` as user A — the card appears in the Interesujące column with company bold, position below, no "Link do oferty" (since the inserted `source` is plain text), no work-mode badge (since `work_mode` is null), and "dodano przed chwilą" timestamp.
- Update the row to set `source = 'https://www.linkedin.com/jobs/view/12345'` and `work_mode = 'Zdalna'`. Reload — the card now shows "Link do oferty" as an anchor (clicking opens LinkedIn in a new tab) and a `Zdalna` badge.
- Insert a second row with status `'Zaaplikowano'`. Reload — Interesujące shows one card, Zaaplikowano shows one card, Rozmowa stays empty with "Brak aplikacji".
- Sign in as user B (different account). `/dashboard` renders three empty columns — none of user A's cards leak in.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the runbook above succeeded against the hosted Supabase project before starting Phase 2.

---

## Phase 2: POST /api/applications endpoint

### Overview

Introduce the first domain API route. Validates input with `applicationCreateSchema`, attaches `user_id` from the session, inserts via the per-request Supabase client (RLS enforces ownership), and returns the JSON envelope agreed in Critical Implementation Details.

### Changes Required

#### 1. New API route

**File**: `src/pages/api/applications/index.ts`

**Intent**: Accept JSON `POST` payloads, validate against `applicationCreateSchema`, persist with `user_id` from the session, return the new row on success or a field-keyed error map on validation failure.

**Contract**:
- `export const prerender = false;` (AGENTS.md hard rule for API routes).
- `export const POST: APIRoute = async (context) => { ... }` — uppercase handler name (AGENTS.md).
- Read body as JSON: `const body = await context.request.json();`. On parse failure (malformed JSON), return `400 { error: 'Invalid JSON body.' }`.
- Validate: `const parsed = applicationCreateSchema.safeParse(body);`. On failure, transform `parsed.error.issues` into a `Record<string, string>` keyed by the first path segment, with Polish-readable messages (a tiny helper — e.g., switch on the issue's `code` to map `'too_small'` on `source` to `"Źródło jest wymagane."`, fall back to `issue.message` otherwise). Return `422 { errors: <record> }`.
- Resolve the user: `const user = context.locals.user;`. If null, return `401 { error: 'Unauthorized.' }`.
- Resolve the Supabase client: `const supabase = createClient(context.request.headers, context.cookies);`. If null (env missing), return `500 { error: 'Supabase is not configured.' }`.
- Insert via the service: `try { const row = await createApplication(supabase, parsed.data, user.id); } catch (err) { console.error(err); return Response with 500 { error: 'Nie udało się zapisać aplikacji.' }; }`. On success, return `201 { application: row }` with `Content-Type: application/json`. The route owns Zod parsing and envelope shaping; the service owns the Supabase call (Phase 1 § 6).
- Cookie-write handling: the SSR client may issue `Set-Cookie` headers during the request (auth refresh). Return responses via `new Response(JSON.stringify(...), { status, headers: { 'Content-Type': 'application/json' } })` and rely on Astro's middleware/adapter to flush cookies. Match whatever pattern the existing auth endpoints use (they use `context.redirect` which handles it; for JSON the explicit Response is fine — Astro forwards cookies set via `context.cookies.set` regardless).

#### 2. Zod-issue → Polish message helper (inline or shared)

**File**: `src/lib/validation/applications.ts` (extend) or `src/pages/api/applications/index.ts` (inline)

**Intent**: Translate Zod's English issue codes into user-readable Polish field messages so the dialog can render them directly without a client-side lookup table.

**Contract**: A function `formatApplicationErrors(error: z.ZodError): Record<string, string>` that walks `error.issues` and for each one, picks the first path segment as the key and a Polish message as the value. Minimum coverage: `source` empty → "Źródło jest wymagane."; everything else → `issue.message` (English Zod default is acceptable as a fallback — the only required field is `source`, so other errors are unlikely under normal use). Place in `src/lib/validation/applications.ts` if it grows beyond 10 lines; inline in the route otherwise.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification

- With `npm run dev` running and signed in as user A, `curl -X POST http://localhost:4321/api/applications -H 'Content-Type: application/json' -H 'Cookie: <session cookie copied from browser>' -d '{"source":"https://linkedin.com/jobs/view/1","position":"Senior Engineer","company":"ACME"}'` returns `201` with `{ "application": { "id": "<uuid>", "user_id": "<user A's id>", "source": "https://linkedin.com/jobs/view/1", ..., "status": "Interesujące", "last_action_at": "<ISO>", "created_at": "<ISO>", "archived_at": null } }`.
- Same curl with `'{"position":"X"}'` (missing `source`) returns `422 { "errors": { "source": "Źródło jest wymagane." } }`.
- Same curl with no `Cookie` header returns `401 { "error": "Unauthorized." }`.
- Same curl with malformed JSON (`-d 'not json'`) returns `400 { "error": "Invalid JSON body." }`.
- Same curl as user B targeting user A's cookie/session fails the standard way (i.e., the cookie is user B's, so the insert is owned by user B — RLS doesn't block a self-insert; this is correct behavior). Cross-user write protection is enforced at the next layer: user B inserting a note pointing at user A's `application_id` is blocked by the F-01 hardening migration, but that's the notes path. For S-02, the relevant cross-user check is the read isolation: user B then GETs `/dashboard` and sees only their own row, not user A's.

**Implementation Note**: After Phase 2 completes and the curl runbook above passes, pause before starting Phase 3.

---

## Phase 3: Add modal UI and `+` trigger

### Overview

Install the shadcn primitives needed for the form. Build the React island that owns dialog open/close state, form state, fetch submission, and field-level error rendering. Wire a `+` trigger into the column headers of Interesujące and Zaaplikowano only.

### Changes Required

#### 1. Install shadcn primitives

**Files**: `src/components/ui/dialog.tsx`, `src/components/ui/input.tsx`, `src/components/ui/textarea.tsx`, `src/components/ui/select.tsx`, `src/components/ui/label.tsx`

**Intent**: Pull in the standard new-york shadcn versions via the CLI. `components.json` is already configured.

**Contract**: Run `npx shadcn@latest add dialog input textarea select label`. This generates the five files above plus any peer Radix dependencies in `package.json` (`@radix-ui/react-dialog`, `@radix-ui/react-select`, `@radix-ui/react-label`). Don't edit the generated files — keep them as shipped so future upstream changes can be diff-merged. Commit `package.json` + `package-lock.json` + the five new component files together.

#### 2. Add-application dialog component

**File**: `src/components/board/AddApplicationDialog.tsx`

**Intent**: Owns the open/close state of the modal, the form state for all eight fields, the submit handler that POSTs JSON, the field-level error map, and the banner state for non-422 errors. Renders the trigger button alongside the dialog so a parent only needs to drop one component per column.

**Contract**:
- Props: `targetStatus: 'Interesujące' | 'Zaaplikowano'` (typed via `import type { ApplicationStatus } from '@/lib/validation/applications'` with a narrowing). Optional `triggerLabel` defaulting to a `+` icon (`Plus` from lucide-react).
- Local state via `useState`:
  - `open: boolean` — modal visibility.
  - `form: { source: string; position: string; company: string; description: string; salary: string; work_mode: '' | WorkMode; recruiter_contact: string }` — empty strings for all fields initially; `work_mode` uses `''` to represent "nie wybrano" and is mapped to `null` at submit time.
  - `errors: Record<string, string>` — field-keyed messages; cleared on field change.
  - `bannerError: string | null` — for non-422 errors.
  - `submitting: boolean` — disables the submit button while in flight.
- Renders the shadcn `<Dialog open={open} onOpenChange={setOpen}>` with `<DialogTrigger asChild><Button variant="ghost" size="icon" aria-label={targetStatus === 'Interesujące' ? 'Dodaj do Interesujące' : 'Dodaj do Zaaplikowano'}><Plus /></Button></DialogTrigger>` and `<DialogContent>` containing the form.
- Dialog title: `"Nowa aplikacja w kolumnie {targetStatus}"`.
- Field order in the form: `Źródło` (`Input`), `Stanowisko` (`Input`), `Firma` (`Input`), `Opis i wymagane umiejętności` (`Textarea`, ~5 rows, helper text under label), `Widełki wynagrodzenia` (`Input`), `Tryb pracy` (`Select` with four options: `Nie wybrano` (value `''`), `Zdalna`, `Hybrydowa`, `Stacjonarna`), `Kontakt do rekrutera` (`Input`). Each field renders `errors[fieldName]` underneath when present, in `text-xs text-red-600`. `Źródło` has `aria-required="true"`.
- Footer: `<Button variant="outline" onClick={() => setOpen(false)}>Anuluj</Button>` and `<Button type="submit" disabled={submitting}>{submitting ? 'Zapisywanie…' : 'Dodaj'}</Button>`.
- Submit handler:
  1. Build the request body: spread `form`, map `work_mode: form.work_mode === '' ? null : form.work_mode`, map any empty-string optional fields to `null` (or omit), set `status: targetStatus`.
  2. `fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })`.
  3. On `201`: close the dialog (`setOpen(false)`), then `window.location.reload()`. The reload re-renders the SSR page; the new card appears via Phase 1's query.
  4. On `422`: read `{ errors }` from the response, `setErrors(errors)`, leave the dialog open.
  5. On any other response or thrown error: `setBannerError('Nie udało się zapisać aplikacji. Spróbuj ponownie.')`, leave the dialog open with field values intact.
  6. Always set `submitting` back to `false` in a `finally`.
- Banner: when `bannerError` is non-null, render a red banner at the top of the form (`rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700`) above the first field.
- Reset all four state slices (`errors`, `bannerError`, `submitting`, `form`) inside the `onOpenChange` callback when `open` transitions from `true` to `false`. This is the single chokepoint that covers all three close paths (Cancel, Escape, outside-click); the Cancel button just calls `setOpen(false)`. Do **not** wire reset to Cancel's `onClick` — that would leak stale state on Escape/outside-click and silently fail the "reopening starts fresh" criterion (3.11).
- File runs as a React island; no `"use client"` directive (AGENTS.md hard rule — no Next.js directives).
- Uses `cn()` from `@/lib/utils` for any conditional classes.

#### 3. Wire the trigger into Interesujące and Zaaplikowano columns

**File**: `src/components/board/KanbanBoard.astro`

**Intent**: Mount the dialog component once per addable column, passing the correct `targetStatus`. The component renders both the trigger button and the modal; the trigger sits inside `KanbanColumn`'s `header-action` slot.

**Contract**:
- Inside the `applicationStatusValues.map(...)`, render the column. For Interesujące and Zaaplikowano, also render `<AddApplicationDialog client:load targetStatus={status} slot="header-action" />` as a child of `<KanbanColumn>`. For Rozmowa, skip the dialog entirely.
- Use `client:load` (not `client:idle` or `client:visible`) so the dialog is interactive immediately after the page paints. The component is small; load cost is negligible.
- The `slot="header-action"` attribute hooks into the named slot defined in Phase 1's `KanbanColumn.astro` change.

#### 4. Status type narrowing helper (optional)

**File**: `src/components/board/AddApplicationDialog.tsx` (inline) or `src/lib/validation/applications.ts` (extend)

**Intent**: Constrain `targetStatus` to the two addable statuses without re-typing the literal union everywhere.

**Contract**: Either inline `type AddableStatus = Exclude<ApplicationStatus, 'Rozmowa'>` at the top of the dialog file, or export it from the validation module. Either works; prefer inline unless S-04 needs the same narrowing (it does, since the parser-driven add reuses the dialog) — in that case promote to the validation module.

### Success Criteria

#### Automated Verification

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification

- On `/dashboard` (signed in), the Interesujące and Zaaplikowano column headers each show a `+` icon button (right-aligned). Rozmowa's header shows none.
- Clicking the Interesujące `+` opens a modal titled "Nowa aplikacja w kolumnie Interesujące" with all seven fields visible. The Cancel and Save buttons appear in the footer.
- Pressing Save with an empty `Źródło` shows "Źródło jest wymagane." under that field (modal stays open). All other field values are preserved.
- Filling only `Źródło` with `"https://www.linkedin.com/jobs/view/12345"` and submitting closes the modal, reloads the page, and shows a new card in Interesujące with company `"—"`, no position, the "Link do oferty" anchor (clickable, opens LinkedIn in a new tab), no work-mode badge, and "dodano przed chwilą" timestamp.
- Clicking the Zaaplikowano `+`, filling all seven fields (set `Tryb pracy` to `Hybrydowa`), and submitting puts the card in Zaaplikowano (not Interesujące) with all fields populated including the work-mode badge `Hybrydowa`.
- Stopping the dev server, reopening the dialog, pressing Save: the dialog stays open, all field values are preserved, and a red banner appears at the top reading "Nie udało się zapisać aplikacji. Spróbuj ponownie." Restart the dev server, press Save again — save succeeds.
- Two-user RLS smoke: sign in as user A, add a card; sign out; sign in as user B; visit `/dashboard` — see only user B's cards (or an empty board), never user A's.
- Pressing Escape closes the dialog; clicking outside the dialog closes it; the form state resets between opens.
- `console` shows no React warnings (no hydration mismatches, no missing keys).

**Implementation Note**: After Phase 3 completes and the runbook above succeeds, pause for manual confirmation before considering the slice complete and bumping `change.md` status to `implemented`.

---

## Testing Strategy

No test framework is configured (AGENTS.md hard rule). Verification is via lint, typecheck, build, and the per-phase manual runbooks above. The most security-relevant assertion — two-user RLS isolation on writes — is exercised in Phase 2's curl runbook and Phase 3's UI runbook.

### Manual Testing Steps (end-to-end after all three phases land)

1. `npm run dev` and sign in as a known user.
2. Confirm three columns render with `+` on Interesujące and Zaaplikowano only.
3. Click Interesujące `+`. Submit empty → see field error under `Źródło`. Cancel.
4. Reopen, fill `Źródło` with plain text (e.g., `"job fair 2026-05-29"`) and `Firma = ACME`. Submit → new card in Interesujące with `ACME` bold, no "Link do oferty", "dodano przed chwilą".
5. Reopen, fill `Źródło` with a LinkedIn URL plus `Stanowisko = Senior Engineer`, `Firma = Globex`, `Tryb pracy = Zdalna`. Submit → card in Interesujące with `Globex` bold, `Senior Engineer` below, "Link do oferty" (opens in new tab), `Zdalna` badge.
6. Click Zaaplikowano `+`, submit a complete card. Confirm it lands in Zaaplikowano, not Interesujące.
7. Stop the dev server, reopen a dialog, submit → banner appears, fields preserved. Restart dev server, submit → success.
8. Sign out, sign in as a second account → see an empty board.

## Performance Considerations

- The board read is one indexed query (`applications(user_id, status) where archived_at is null` from F-01). RLS adds a `user_id = auth.uid()` predicate folded into the existing index — query cost is negligible at MVP scale.
- The dialog component is hydrated `client:load`. Bundle adds Radix Dialog + Radix Select primitives — well under the NFR's 500ms perceived-latency budget on a desktop browser. Two instances (one per addable column) are mounted; the React tree is small and the dialogs are unrendered until opened.
- `window.location.reload()` after a successful submit is a full SSR round-trip. At MVP user volume and with the indexed query, this is a sub-200ms operation locally; on Cloudflare edge it stays well within the NFR.

## Migration Notes

No schema changes. F-01 already provides every column this slice writes to.

## References

- Roadmap entry: `context/foundation/roadmap.md` § S-02 (manual-add-application) — status now `ready`, marked ready-for-`/10x-plan` in Backlog Handoff.
- PRD: `context/foundation/prd.md` — FR-003 (form fields + add-button column rules), FR-019 (recruiter contact), FR-018 (Link do oferty on card face — bundled into S-02 per user direction in planning).
- Project guidelines: `AGENTS.md` (API routes `prerender = false`, uppercase handlers, Zod validation, RLS, `cn()`, no tests, no `"use client"`).
- F-01 contracts:
  - Tables and RLS: `supabase/migrations/20260526123145_applications_schema.sql`
  - Zod write-shape: `src/lib/validation/applications.ts:12-21` (`applicationCreateSchema`), `:3-4` (`applicationStatusValues`, `workModeValues`)
  - Generated types: `src/lib/database.types.ts`
- S-01 surfaces extended in this slice:
  - `src/pages/dashboard.astro` (read query added)
  - `src/components/board/KanbanBoard.astro` (slot + dialog wiring)
  - `src/components/board/KanbanColumn.astro` (slots + empty-state guard)
- Existing patterns to reuse:
  - Per-request Supabase client: `src/lib/supabase.ts:5-23`
  - Auth endpoint shape (uppercase handler, env-null guard): `src/pages/api/auth/signin.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Card rendering and column slot refactor

#### Automated

- [ ] 1.1 Linting passes: `npm run lint`
- [ ] 1.2 Type checking passes: `npm run typecheck`
- [ ] 1.3 Build succeeds: `npm run build`

#### Manual

- [ ] 1.4 Zero rows: `/dashboard` renders three columns with "Brak aplikacji" (no regression)
- [ ] 1.5 Hand-inserted plain-text row appears in Interesujące with company bold, position below, no "Link do oferty", no work-mode badge, "dodano przed chwilą"
- [ ] 1.6 Updating the row to a LinkedIn URL + Zdalna shows "Link do oferty" anchor (new tab) and Zdalna badge
- [ ] 1.7 Second row at status Zaaplikowano puts that card in Zaaplikowano; Rozmowa stays empty
- [ ] 1.8 User B sees empty columns — none of user A's cards leak

### Phase 2: POST /api/applications endpoint

#### Automated

- [ ] 2.1 Linting passes: `npm run lint`
- [ ] 2.2 Type checking passes: `npm run typecheck`
- [ ] 2.3 Build succeeds: `npm run build`

#### Manual

- [ ] 2.4 Valid curl returns 201 with the new row
- [ ] 2.5 Missing `source` returns 422 with `{ errors: { source: 'Źródło jest wymagane.' } }`
- [ ] 2.6 No-cookie curl returns 401 `{ error: 'Unauthorized.' }`
- [ ] 2.7 Malformed JSON returns 400 `{ error: 'Invalid JSON body.' }`
- [ ] 2.8 Cross-user read isolation: user B GETs `/dashboard` and sees only own rows, never user A's

### Phase 3: Add modal UI and `+` trigger

#### Automated

- [ ] 3.1 Linting passes: `npm run lint`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Build succeeds: `npm run build`

#### Manual

- [ ] 3.4 `+` button appears on Interesujące and Zaaplikowano headers; Rozmowa has none
- [ ] 3.5 Clicking `+` opens modal titled "Nowa aplikacja w kolumnie {status}" with all 7 fields visible and Anuluj + Dodaj buttons in the footer
- [ ] 3.6 Empty-`Źródło` submit shows field error and keeps modal open with values intact
- [ ] 3.7 LinkedIn-URL-only submit creates a card in Interesujące with the link anchor, "przed chwilą" timestamp
- [ ] 3.8 Submitting from Zaaplikowano `+` puts the card in Zaaplikowano (not Interesujące)
- [ ] 3.9 Dev-server-down submit shows the red banner; fields preserved; restarting and resubmitting succeeds
- [ ] 3.10 Two-user RLS check: user B never sees user A's added cards
- [ ] 3.11 Escape and outside-click close the dialog; reopening starts with fresh form state
- [ ] 3.12 No React warnings in browser console (no hydration mismatches, no missing keys)
