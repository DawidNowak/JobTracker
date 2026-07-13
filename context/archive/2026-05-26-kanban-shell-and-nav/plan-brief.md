# Kanban Shell and Nav — Plan Brief

> Full plan: `context/changes/kanban-shell-and-nav/plan.md`

## What & Why

Stand up the authenticated landing page for JobTracker: a three-column kanban board (Interesujące / Zaaplikowano / Rozmowa) at `/dashboard`, a placeholder `/archive` route, and a shared authenticated-app shell with a persistent top nav (Tablica / Archiwum + signout). This is the thin shell every interactive slice (S-02 add form, S-05 transitions, S-06 notes, S-11 archive list) composes into — landing it now unblocks the whole MVP graph without bundling form work.

## Starting Point

`src/pages/dashboard.astro` is the starter's placeholder hero card; `src/middleware.ts` already protects `/dashboard`; auth flows (signin/signup/signout) are wired against Supabase; F-01 has shipped the `applications` schema with RLS but this slice does not query it. The `Topbar.astro` component exists but is the public-site nav (Sign in/Sign up); the authenticated app has no nav today.

## Desired End State

An authenticated user lands on `/dashboard` and sees a clean three-column board with empty-state placeholders. A persistent top nav offers `Tablica`, `Archiwum`, the user's email, and a `Wyloguj` button — active link visually marked. `/archive` renders a "Wkrótce" stub so the nav link is never broken. Public/auth pages are visually unchanged.

## Key Decisions Made

| Decision                                | Choice                                          | Why (1 sentence)                                                                                                                                        | Source |
| --------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Route names                             | `/dashboard` (board) + `/archive`               | Avoid churn — middleware redirects and signin success already point to `/dashboard`; English routes alongside Polish UI is an acceptable mild mismatch. | Plan   |
| Archive link target                     | Stub page renders "Wkrótce" with same nav       | PRD wants the nav placement permanent and obvious; a broken/disabled link contradicts that, and a stub is one extra file.                               | Plan   |
| Visual theme for authenticated surfaces | Drop `bg-cosmic`; use plain neutral surface     | Cosmic backdrop will be unreadable on a dense kanban; keep cosmic on public/auth pages only.                                                            | Plan   |
| Shell rendering                         | Pure Astro components (no React island in S-01) | AGENTS.md hard rule: React only when browser events/state/hooks are required; nothing in this slice qualifies.                                          | Plan   |
| Auth ratification depth                 | Defer all DB-side auth verification to S-02     | User chose to skip the RLS smoke query in S-01; S-02 hits the DB for real and is the natural gate.                                                      | Plan   |

## Scope

**In scope:**

- New `src/layouts/AppShell.astro` (authenticated layout with nav)
- New `src/components/app/AppNav.astro` (top nav: brand, Tablica, Archiwum, email, Wyloguj)
- New `src/components/board/KanbanBoard.astro` (3-column container)
- New `src/components/board/KanbanColumn.astro` (single column with header + empty-state)
- Replace body of `src/pages/dashboard.astro` to use AppShell + KanbanBoard
- New `src/pages/archive.astro` stub
- Extend `PROTECTED_ROUTES` in `src/middleware.ts` to include `/archive`

**Out of scope:**

- Any data fetching, any call to `applications` or `application_notes`
- Add (`+`) buttons, card components, drag, status transitions (S-02 / S-05)
- Real archive list rendering (S-11)
- Changes to `Topbar.astro`, the public landing page, or the auth pages
- Tests (no framework configured; AGENTS.md forbids scaffolding)
- Mobile/responsive layout work

## Architecture / Approach

```
Layout.astro (existing — <head>, global CSS, config banners)
   └─ AppShell.astro (NEW — authenticated wrapper, neutral theme)
        ├─ AppNav.astro (NEW — brand + Tablica/Archiwum + email + Wyloguj)
        └─ <slot>
              ├─ dashboard.astro → KanbanBoard.astro → 3× KanbanColumn.astro
              └─ archive.astro → "Wkrótce" placeholder
```

Pure SSR Astro — no React, no client JS, no Supabase queries. Middleware adds `/archive` to the protected route list.

## Phases at a Glance

| Phase                      | What it delivers                                                                                | Key risk                                                                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Authenticated app shell | `AppShell.astro` + `AppNav.astro` (not yet wired to routes)                                     | Active-link styling inconsistent with Tailwind 4 conventions; mitigated by reusing `cn()`.                                                          |
| 2. Board + archive routes  | `dashboard.astro` swap, `archive.astro` stub, `KanbanBoard` + `KanbanColumn`, middleware update | Routes load auth user via middleware; if `Astro.locals.user` is `undefined`-typed, TS may complain — middleware guarantees it for protected routes. |

**Prerequisites:** F-01 merged (it is, per `context/changes/applications-schema-and-rls/`). No env/config changes needed.
**Estimated effort:** ~1 short session, 2 small commits.

## Open Risks & Assumptions

- Assumes Supabase Auth session cookies are wired and stable across the new routes (true today — `/dashboard` already works).
- Assumes the existing Tailwind 4 config supports `bg-neutral-50` and the utility classes the new components will use (true — Tailwind 4 ships these by default).
- Auth ratification against the RLS-protected schema is deferred to S-02 per the user's decision; S-01 ships without that exit gate.

## Success Criteria (Summary)

- An authenticated user can land on `/dashboard` and see three empty kanban columns with the correct Polish labels.
- The Tablica/Archiwum nav is visible on both authenticated pages; active state moves with the user.
- Clicking Archiwum lands on a stub page; clicking Wyloguj signs the user out cleanly.
- Public landing page and auth pages are unchanged.
