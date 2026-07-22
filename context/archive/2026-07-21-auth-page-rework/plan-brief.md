# Auth Page Rework — Plan Brief

> Full plan: `context/changes/auth-page-rework/plan.md`

## What & Why

The sign-in, sign-up, and confirm-email pages are the last surfaces still on the old
"cosmic" dark starter theme and still in English — inconsistent with the light Polish landing
page and dashboard. This change migrates them to the app's light theme and Polish copy, and
removes the now-dead `bg-cosmic` utility. Visual + copy only; no behavior changes.

## Starting Point

The three `src/pages/auth/*.astro` pages wrap a glassmorphism card (`bg-white/10
backdrop-blur-xl`, gradient-text headings, purple accents) on a `bg-cosmic` dark background,
with no header. Their six React components (`SignInForm`, `SignUpForm`, `FormField`,
`SubmitButton`, `PasswordToggle`, `ServerError`) are dark-styled with English labels and
validation ("Email is required", "Passwords do not match"). The rest of the app
(`Welcome.astro`, `AppShell`/`AppNav`) is `bg-neutral-50`, white cards, `text-neutral-900`,
Polish. The landing-page rework explicitly left auth "as-is" — this picks that up.

## Desired End State

Each auth page shows a light Polish screen: a `bg-white` header with the "JobTracker"
wordmark (linking to `/`) over a `bg-neutral-50` body, a centered white card (`rounded-xl
border border-neutral-200 bg-white p-8 shadow-sm`) holding light inputs with neutral
Mail/Lock icons, a `bg-neutral-900` primary button, and Polish labels/placeholders/validation.
No cosmic styling, gradient text, purple accent, or English copy remains anywhere in auth,
and `bg-cosmic` is deleted from `global.css`.

## Key Decisions Made

| Decision           | Choice                                                        | Why (1 sentence)                                                     | Source |
| ------------------ | ------------------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| Page frame         | Light header (wordmark → `/`) + centered card                 | Maximum continuity with landing + dashboard; brand always reachable. | Plan   |
| Card surface       | `rounded-xl border border-neutral-200 bg-white p-8 shadow-sm` | Reuses the landing feature-card recipe + KanbanCard's elevation.     | Plan   |
| Shared shell       | Extract `AuthLayout.astro`                                    | One source of truth for the frame across all three pages.            | Plan   |
| Button accent      | `bg-neutral-900` (landing CTA)                                | Matches the primary action users clicked to get here; drops purple.  | Plan   |
| Inputs             | Light inputs, keep Mail/Lock icons + eye toggle               | Preserves affordances; lucide is already the app icon set.           | Plan   |
| Copy               | Full Polish (labels, placeholders, our validation)            | AGENTS.md Polish mandate; matches in-app wording.                    | Plan   |
| Scope add-ons      | confirm-email restyled + `bg-cosmic` deleted                  | Leaves zero cosmic remnants — the cleanup requested.                 | Plan   |
| Server-error copy  | Left English (out of scope)                                   | Lives in the auth API and is Supabase-provided; separate concern.    | Plan   |
| Logged-in redirect | Not added (out of scope)                                      | Keeps this a visual/copy change, not a behavior change.              | Plan   |

## Scope

**In scope:** new `AuthLayout.astro`; restyle + Polish copy for `signin`/`signup`/`confirm-email`
pages and all six auth components; delete `@utility bg-cosmic` from `global.css`.

**Out of scope:** auth behavior (no logged-in→dashboard redirect, no middleware/API edits);
Supabase server-error translation; forgot/reset-password pages; new deps/routes/data model;
`src/components/ui/` changes; OAuth.

## Architecture / Approach

Single static `AuthLayout.astro` owns the light frame (header + `bg-neutral-50` body +
centered white-card slot); the three pages become thin content wrappers passing `title`,
`heading`, and slotted form/link markup. The six React components are restyled in place —
dark/glass classes swapped for the light equivalents used elsewhere — and every string
translated to Polish. Static frame stays `.astro` (island rule); interactive forms stay
React; all class merging via `cn()`.

## Phases at a Glance

| Phase                        | What it delivers                                                             | Key risk                                                         |
| ---------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1. Shared light shell        | `AuthLayout.astro`, 3 pages migrated + Polish page copy, `bg-cosmic` deleted | Header/card spacing matching the app cleanly                     |
| 2. Restyle + translate forms | 6 components light-themed + Polish labels/validation                         | Missing an English string or a dark class; Polish plural in hint |

**Prerequisites:** none — light-theme reference patterns and auth routes already exist.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Assumes no test asserts on auth page copy — verified (only the `/auth/signin` redirect URL
  is asserted, unaffected).
- Assumes `bg-cosmic` has no other consumer — verified (grep: only the three auth pages).
- Residual: server-error messages (`?error=`) stay English because they originate in the auth
  API / Supabase, not the pages — a light red alert will occasionally show English text.
- The sign-up length hint needs correct Polish pluralization ("znak/znaki/znaków").

## Success Criteria (Summary)

- All three auth pages render light + Polish with the JobTracker header and a centered white card.
- Forms use light inputs, a neutral-900 button, and Polish labels/validation; toggle + pending
  states still work.
- `npm run typecheck && npm run lint && npm test` all green; zero `cosmic`/purple/English
  remnants under `src/pages/auth` and `src/components/auth`, and no `bg-cosmic` in `global.css`.
