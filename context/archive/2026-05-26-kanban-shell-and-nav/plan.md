# Kanban Shell and Nav Implementation Plan

## Overview

Stand up the authenticated landing page for JobTracker: a three-column kanban board (Interesujące / Zaaplikowano / Rozmowa) at `/dashboard`, a placeholder `/archive` route, and a shared authenticated-app shell with a persistent top nav (Tablica / Archiwum + signout). No data fetching, no interactivity — the empty shell that unblocks every interactive slice (S-02 onward) without bundling form work.

## Current State Analysis

What exists today (verified in repo):

- `src/pages/dashboard.astro` is a placeholder hero card from the 10x Astro Starter ("Welcome, <email>"), wrapped in `Layout.astro` and styled with the `bg-cosmic` theme. Renders the user's email and a signout form.
- `src/middleware.ts` lists `PROTECTED_ROUTES = ["/dashboard"]` and redirects unauthenticated users to `/auth/signin`.
- `src/layouts/Layout.astro` is the only layout; it renders `<Banner>` config warnings, `<slot />`, and global styles. It does **not** include any nav — the public landing page (`index.astro`) wires `<Topbar />` itself.
- `src/components/Topbar.astro` is a public-site nav (used in `Welcome.astro`): shows user email + Dashboard/Signout when authenticated, Sign in/Sign up links when not. It is reused across pages by including it manually — there is no nav inside `Layout.astro`.
- Auth (`signin.astro`, `signup.astro`, `signout.ts`) is wired and works against Supabase Auth via `src/lib/supabase.ts`. `src/pages/api/auth/signin.ts:19` currently redirects to `/` on success (the public Welcome page — awkward for authenticated users); `signout.ts:9` redirects to `/`. `signup.ts:19` redirects to `/auth/confirm-email` (email-confirmation flow); signup is not affected by this slice.
- F-01 has landed: `supabase/migrations/20260526123145_applications_schema.sql` defines `applications` and `application_notes` with RLS on `auth.uid()`. **This slice does not query either table** — auth ratification against the RLS-protected schema is deferred to S-02 per the user's decision.
- Only one shadcn component exists (`button.tsx`); no layout primitives, no card components.
- `tsconfig.json` aliases `@/*` to `src/*`.

### Key Discoveries

- AGENTS.md hard rule: "React components are only permitted when browser events, state, or hooks are required." The empty shell has zero interactivity, so the entire slice is `.astro` files.
- AGENTS.md: "Use `cn()` from `@/lib/utils` for all class name merging." Verified at `src/lib/utils.ts`.
- The current cosmic backdrop is heavy (`bg-cosmic` + three blurred orbs + radial star field). It is appropriate for marketing/auth pages; it will make a card-dense kanban hard to scan. **Decision:** drop it on authenticated app surfaces; keep it on the public `index.astro` and the auth pages.
- The existing `Topbar.astro` is a _public-site_ nav (shows Sign in / Sign up to anonymous users). It is the wrong shape for an authenticated app nav (which should show Tablica / Archiwum). Build a new `AppNav` rather than overloading `Topbar`.
- Roadmap S-01 outcome specifies "log in and see an empty 3-column board." Today's signin redirect (`/`) lands authenticated users on the public marketing page — a one-line change to `signin.ts` is the smallest fix that delivers the outcome, and it belongs in this slice since the slice owns the post-login landing surface.

## Desired End State

When this plan is complete:

- Visiting `/dashboard` while authenticated shows a three-column kanban board (Interesujące / Zaaplikowano / Rozmowa). Each column displays its title and a muted empty-state message ("Brak aplikacji"). No add button, no cards.
- A top nav appears on `/dashboard` and `/archive` containing: `Tablica` link → `/dashboard`, `Archiwum` link → `/archive`, the user's email, and a `Wyloguj` button. The currently active link is visually distinguished.
- Visiting `/archive` while authenticated shows the same top nav and a placeholder body ("Archiwum — wkrótce. Pełna lista archiwalnych aplikacji pojawi się tutaj po wdrożeniu slice'u S-11.").
- Visiting `/dashboard` or `/archive` while unauthenticated redirects to `/auth/signin`.
- The public landing page (`index.astro`) and the auth pages (`signin.astro`, `signup.astro`, `confirm-email.astro`) are visually unchanged.

### Verification:

- `npm run lint` passes
- `npm run typecheck` passes
- `npm run build` succeeds
- Manual: sign in → land on board with three columns; click Archiwum → land on stub page; signout → redirect to `/`.

## What We're NOT Doing

- No data fetching. No call to `supabase.from('applications')` anywhere in this slice. The board is statically empty.
- No add button, no `+` UI in any column (S-02).
- No card components, no draggable elements, no status transitions (S-05).
- No archive list rendering, no archived-card view (S-11).
- No auth-ratification smoke test against the new RLS schema (deferred to S-02 per user decision).
- No changes to the public landing page (`index.astro`, `Welcome.astro`), the auth UI pages (`signin.astro`, `signup.astro`, `confirm-email.astro`), or `signup.ts` / `signout.ts`. The single exception is the one-line `signin.ts` success-redirect change documented in Phase 2.
- No changes to `Topbar.astro` — leave it as the public-site nav.
- No new shadcn components installed; the existing `button.tsx` is sufficient.
- No mobile-specific responsive layout work (PRD NFR: desktop Chrome/Firefox/Edge only).
- No tests scaffolded (AGENTS.md: "do not scaffold tests").

## Implementation Approach

Two phases, both pure Astro:

1. **Phase 1 — Authenticated app shell.** Build `AppShell.astro` (a layout wrapping `Layout.astro` with a top nav) and `AppNav.astro` (the nav component). The shell is the surface every authenticated page in this slice and beyond will compose into.
2. **Phase 2 — Board and archive routes.** Replace the body of `dashboard.astro` with a `KanbanBoard.astro` + `KanbanColumn.astro` composition. Create `archive.astro` as a stub page. Add `/archive` to `PROTECTED_ROUTES`.

The split keeps the layout primitive separable from the route bodies — useful because every future slice (S-02, S-05, S-06, S-11) will reuse the same shell.

## Phase 1: Authenticated app shell

### Overview

Introduce a new layout (`AppShell.astro`) and a new nav component (`AppNav.astro`). These will wrap every authenticated route in this slice and onwards. No route changes yet — Phase 2 composes these into the actual pages.

### Changes Required:

#### 1. New layout — authenticated app shell

**File**: `src/layouts/AppShell.astro`

**Intent**: A thin layout for authenticated app pages. Composes `Layout.astro` (which carries `<head>`, global CSS, and the config-status `<Banner>`s) and renders `<AppNav />` above `<slot />` inside a neutral-themed page container. This is the visual home for `/dashboard` and `/archive`.

**Contract**:

- Props: `title?: string`, `activeNav: "tablica" | "archiwum"`. Both forwarded — `title` to `Layout`, `activeNav` to `AppNav`.
- Renders structure: `<Layout title={title}><div class="min-h-screen bg-neutral-50"><AppNav activeNav={activeNav} /><main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8"><slot /></main></div></Layout>`.
- Uses plain neutral surface (`bg-neutral-50`) — no `bg-cosmic`, no blurred orbs. Cosmic theme stays on public/auth pages only.

#### 2. New component — authenticated top nav

**File**: `src/components/app/AppNav.astro`

**Intent**: The persistent top nav for authenticated pages. Renders the brand, the two primary links (Tablica → `/dashboard`, Archiwum → `/archive`), the signed-in user's email, and a signout form. Highlights the currently active link based on the `activeNav` prop.

**Contract**:

- Props: `activeNav: "tablica" | "archiwum"`.
- Reads `Astro.locals.user` (typed `User | null` in `src/env.d.ts:3`). The middleware guarantees a non-null user at runtime on protected routes, but TypeScript can't infer that. Use a conditional render to satisfy the compiler — `{user && <span>{user.email}</span>}` — not a non-null assertion. Matches the pattern already in `src/components/Topbar.astro:8-9`.
- Both nav links are real anchors to `/dashboard` and `/archive` (no `aria-disabled`, no `#`, no JS). Active link gets a distinct visual treatment (e.g., bolder text + a thin underline or accent border); the other gets a hover style. Uses `cn()` from `@/lib/utils` to merge class strings.
- Signout uses the existing `<form method="POST" action="/api/auth/signout">` pattern (already used in `dashboard.astro` and `Topbar.astro`); button label is `Wyloguj`.
- Brand text is `JobTracker` and links to `/dashboard`.
- Structurally: `<header><nav><div>brand + Tablica + Archiwum</div><div>email + Wyloguj</div></nav></header>`. Border-bottom to separate from page body. Responsive flex layout, no mobile-specific work.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- `AppShell.astro` and `AppNav.astro` exist at the documented paths and use `@/*` aliases for internal imports.
- `AppNav.astro` reads `Astro.locals.user` and renders the email when present.

**Implementation Note**: Phase 1 produces no user-visible change on its own — both files are only consumed in Phase 2. After Phase 1 completes and automated verification passes, proceed to Phase 2 without waiting for separate manual confirmation; manual verification of the shell happens after Phase 2 lands the routes.

---

## Phase 2: Board and archive routes

### Overview

Compose `AppShell` + the new board components into `/dashboard`. Create `/archive` as a stub. Register `/archive` as a protected route.

### Changes Required:

#### 1. New component — kanban column

**File**: `src/components/board/KanbanColumn.astro`

**Intent**: A single column on the kanban board. Renders a Polish-language column title and an empty-state placeholder. Receives no children for now — slices S-02+ will render cards inside.

**Contract**:

- Props: `title: string` (the Polish status label, e.g., `"Interesujące"`).
- Renders a column container with a header (`title`) and a body containing a muted empty-state message (e.g., `"Brak aplikacji"`). The column has a visible boundary (border + rounded corners) and sufficient min-height to read as a column even when empty.
- No prop, no `<slot />`, no `+` button, no interactive controls in this slice. S-02 will introduce a `<slot />` together with an empty-state guard (e.g., `Astro.slots.has("default") ? <slot /> : <p>Brak aplikacji</p>`) so cards and the placeholder never render simultaneously. Keeping the slot out of S-01 avoids a footgun where S-02 forgets the guard.
- Polish text is stored verbatim (matches the DB CHECK constraint values for `status`).

#### 2. New component — kanban board

**File**: `src/components/board/KanbanBoard.astro`

**Intent**: The three-column layout. Renders one `KanbanColumn` per active status in the order Interesujące → Zaaplikowano → Rozmowa.

**Contract**:

- No props.
- Renders a horizontal flex/grid layout (3 columns on desktop, equal width). Uses Tailwind utility classes.
- Imports the canonical status order constant if it makes the source readable; otherwise enumerates the three Polish labels inline (the values are stable per FR-007 and pinned in `src/lib/validation/applications.ts`'s `applicationStatusValues`). Either approach is acceptable; prefer reusing `applicationStatusValues` to avoid duplicate string literals.

#### 3. Replace dashboard body with the board

**File**: `src/pages/dashboard.astro`

**Intent**: Swap the starter's placeholder hero card for the authenticated app shell + kanban board.

**Contract**:

- Replaces the existing body entirely. Renders `<AppShell title="Tablica" activeNav="tablica"><KanbanBoard /></AppShell>`.
- Removes the previous `Layout.astro`-based markup, the `bg-cosmic` wrapper, the welcome card, and the inline signout form (signout now lives in `AppNav`).
- `const { user } = Astro.locals;` line and the email reference are removed — `AppNav` reads it directly.
- Keeps `export const prerender` default behavior (SSR — `output: "server"` per `astro.config.mjs`). No need to set `prerender = false` here (that rule is for API routes per AGENTS.md).

#### 4. New page — archive stub

**File**: `src/pages/archive.astro`

**Intent**: Placeholder page so the `Archiwum` nav link is never broken. Same shell, "Wkrótce" body.

**Contract**:

- Renders `<AppShell title="Archiwum" activeNav="archiwum"><section>...placeholder...</section></AppShell>`.
- Body content: a centered heading and a one-line note in Polish, e.g., heading `"Archiwum"` and copy `"Wkrótce. Pełna lista archiwalnych aplikacji pojawi się tutaj po wdrożeniu funkcji archiwizacji."` Use muted text styling.
- No data fetching, no `<slot />`, no nav inside this page (the shell owns the nav).

#### 5. Protect the archive route

**File**: `src/middleware.ts`

**Intent**: Extend `PROTECTED_ROUTES` so unauthenticated visits to `/archive` redirect to `/auth/signin`, same as `/dashboard`.

**Contract**:

- Edit one line: `const PROTECTED_ROUTES = ["/dashboard", "/archive"];`. Nothing else in the middleware changes.

#### 6. Redirect signin success to the board

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Land authenticated users on the board after signin, fulfilling roadmap S-01's "log in and see the board" outcome.

**Contract**:

- Change the final success redirect on line 19 from `context.redirect("/")` to `context.redirect("/dashboard")`. Nothing else in the file changes. Error redirects (lines 11, 16) stay pointing at `/auth/signin?error=…`. `signup.ts` and `signout.ts` are not modified — signup goes to `/auth/confirm-email`, signout to `/` (both correct).

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run typecheck`
- Build succeeds: `npm run build`

#### Manual Verification:

- Signing in with valid credentials lands the user directly on `/dashboard` (not `/`). Authenticated visit to `/dashboard` renders three columns labeled `Interesujące`, `Zaaplikowano`, `Rozmowa`, in that left-to-right order, each with a "Brak aplikacji" placeholder.
- Top nav shows `JobTracker`, `Tablica`, `Archiwum`, the user's email, and a `Wyloguj` button. The `Tablica` link is visually marked as active.
- Clicking `Archiwum` navigates to `/archive`; the nav now highlights `Archiwum`; the body shows the "Wkrótce" placeholder.
- Clicking `Wyloguj` from either page signs the user out and lands on `/` (the public landing page).
- Visiting `/dashboard` or `/archive` while unauthenticated redirects to `/auth/signin`.
- The public landing page (`/`) and auth pages (`/auth/signin`, `/auth/signup`) still render with the original cosmic theme — no visual regressions.

**Implementation Note**: After Phase 2 completes and automated verification passes, pause for manual confirmation that the above human checks pass before closing the change.

---

## Testing Strategy

No test framework is configured (AGENTS.md hard rule). Verification is via lint, typecheck, build, and manual browser checks as listed in the per-phase Success Criteria.

### Manual Testing Steps:

1. `npm run dev` and open `http://localhost:4321`.
2. Confirm the public landing page (`/`) still renders the cosmic-themed Welcome content.
3. Sign in with an existing account. Verify the post-signin redirect lands on `/dashboard` directly (not on `/`). Verify three columns + new nav.
4. Click `Archiwum`. Verify the stub page renders with the same nav (active state moved).
5. Click `Tablica`. Return to the board. Active state moves back.
6. Click `Wyloguj`. Verify redirect to `/` and unauthenticated state.
7. Visit `/dashboard` directly while signed out. Verify redirect to `/auth/signin`.
8. Visit `/archive` directly while signed out. Verify same redirect.

## Performance Considerations

This slice ships zero client-side JavaScript on `/dashboard` and `/archive` (pure Astro components). Cloudflare edge SSR renders both pages in static-template territory. NFR (<500ms perceived) is trivially satisfied.

## Migration Notes

Not applicable — no schema or data changes in this slice.

## References

- Roadmap entry: `context/foundation/roadmap.md` § S-01 (kanban-shell-and-nav)
- PRD: `context/foundation/prd.md` — FR-007 (3 active columns), FR-010 (Archiwum nav link, page deferred to S-11), FR-001/FR-002 (auth satisfied by baseline)
- Project guidelines: `AGENTS.md` (island architecture, RLS, `cn()`, no tests)
- Existing components reused as patterns:
  - `src/layouts/Layout.astro` — wrapped by the new `AppShell`
  - `src/components/Topbar.astro` — reference for the signout form pattern (do not modify)
  - `src/lib/validation/applications.ts:3` — canonical `applicationStatusValues` array

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Authenticated app shell

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — e217c67
- [x] 1.2 Type checking passes: `npm run typecheck` — e217c67
- [x] 1.3 Build succeeds: `npm run build` — e217c67

#### Manual

- [x] 1.4 `AppShell.astro` and `AppNav.astro` exist at the documented paths and use `@/*` aliases for internal imports — 95563e6
- [x] 1.5 `AppNav.astro` reads `Astro.locals.user` and renders the email when present — 95563e6

### Phase 2: Board and archive routes

#### Automated

- [x] 2.1 Linting passes: `npm run lint` — 95563e6
- [x] 2.2 Type checking passes: `npm run typecheck` — 95563e6
- [x] 2.3 Build succeeds: `npm run build` — 95563e6

#### Manual

- [x] 2.4 Signing in lands the user on /dashboard (not /) — 95563e6
- [x] 2.5 Authenticated /dashboard renders three columns labeled Interesujące, Zaaplikowano, Rozmowa with "Brak aplikacji" placeholders — 95563e6
- [x] 2.6 Top nav shows JobTracker, Tablica, Archiwum, user email, and Wyloguj; Tablica is marked active on /dashboard — 95563e6
- [x] 2.7 Clicking Archiwum navigates to /archive; active state moves; body shows "Wkrótce" placeholder — 95563e6
- [x] 2.8 Clicking Wyloguj signs out and lands on `/` — 95563e6
- [x] 2.9 Unauthenticated visits to /dashboard and /archive both redirect to /auth/signin — 95563e6
- [x] 2.10 Public landing page and auth pages still render with the original cosmic theme — 95563e6
