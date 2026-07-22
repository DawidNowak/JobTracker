# Landing Page — Plan Brief

> Full plan: `context/changes/landing-page/plan.md`

## What & Why

Replace the generic "10x Astro Starter" boilerplate at `/` with a real **JobTracker** landing page — the first thing an unauthenticated visitor sees. It should look like the product (light theme), speak Polish, and get visitors to sign in or sign up without reinventing any UI.

## Starting Point

`src/pages/index.astro` renders `Welcome.astro`, a cosmic dark, English starter hero with three generic feature cards (auth / stack / DX) and a cosmic `Topbar`. It shows to everyone, logged in or not. The actual app (`AppNav`, `dashboard`) is light-themed (`bg-neutral-50`, white cards) and Polish ("Tablica", "Wyloguj").

## Desired End State

Logged-out visitors at `/` see a light Polish landing: a header with the "JobTracker" wordmark + Zaloguj/Zarejestruj links, a hero with headline, subhead, and sign-up/sign-in CTAs, and three feature cards. Logged-in visitors are redirected straight to `/dashboard`. No cosmic styling or English copy remains on the landing.

## Key Decisions Made

| Decision           | Choice                                                   | Why (1 sentence)                                                        | Source |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| Copy language      | Polish                                                   | Matches AGENTS.md mandate and the Polish in-app UI.                     | Plan   |
| Visual theme       | App light theme (`bg-neutral-50`, white cards)           | Visual continuity into the dashboard the user lands on after login.     | Plan   |
| Content scope      | Hero + 3 feature cards                                   | Reuses Welcome's existing structure; "don't reinvent the wheel."        | Plan   |
| Logged-in behavior | Redirect `/` → `/dashboard`                              | Landing is only for logged-out visitors; existing users skip marketing. | Plan   |
| Feature cards      | Kanban lifecycle · capture & organize · notes/follow-ups | Highlights shipped, user-facing capabilities.                           | Plan   |
| Auth pages         | Left as-is (cosmic/English)                              | Out of scope; keeps this change focused on the landing.                 | Plan   |
| `Topbar.astro`     | Deleted                                                  | Its only importer was the rewritten `Welcome`; now dead code.           | Plan   |

## Scope

**In scope:** rewrite `Welcome.astro` (light, Polish, hero + 3 cards + light header); auth redirect in `index.astro`; delete unused `Topbar.astro`.

**Out of scope:** auth-page restyle/translation; how-it-works section; product screenshot; LinkedIn/JustJoin.it messaging; middleware changes; new deps/routes/data model.

## Architecture / Approach

Single static Astro page. `Welcome.astro` becomes self-contained (own light header + hero + card grid, no `Topbar`), mirroring the spacing/surfaces of `AppNav`/`AppShell` and merging classes via `cn()`. `index.astro` gains a one-line `Astro.locals.user` → `/dashboard` redirect. No React — static content stays in `.astro` per the island rule. Icons stay inline `<svg>` following the file's existing pattern.

## Phases at a Glance

| Phase                       | What it delivers                                           | Key risk                                             |
| --------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- |
| 1. Rebuild the landing page | Light Polish landing, logged-in redirect, `Topbar` retired | Matching the app's light look cleanly without new UI |

**Prerequisites:** none — auth routes and light-theme reference patterns already exist.
**Estimated effort:** ~1 session, single phase.

## Open Risks & Assumptions

- Assumes no test asserts on landing copy — verified (grep found zero references in `tests/`).
- Assumes `Topbar.astro` has exactly one importer — verified (only `Welcome.astro`).
- Feature-card copy should describe only shipped behavior; avoid promising scraping UX that isn't a user-facing entry point yet.

## Success Criteria (Summary)

- Logged-out `/` shows a light Polish JobTracker landing with working Zaloguj/Zarejestruj CTAs.
- Logged-in `/` redirects to `/dashboard`.
- `npm run typecheck && npm run lint && npm test` all green; no cosmic/starter remnants and no dangling `Topbar` reference.
