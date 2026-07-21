# Landing Page Implementation Plan

## Overview

Replace the generic "10x Astro Starter" boilerplate landing (`src/components/Welcome.astro`) with a real **JobTracker** landing page: the first thing an unauthenticated visitor sees at `/`. It uses the app's **light theme** (matching the dashboard), **Polish** copy, a simple hero with sign-in / sign-up CTAs, and three feature cards describing what JobTracker does. Authenticated visitors hitting `/` are redirected to their board (`/dashboard`).

## Current State Analysis

- `src/pages/index.astro` renders `<Welcome />` inside `Layout.astro`. It performs no auth check — every visitor, logged in or not, sees the marketing page.
- `src/components/Welcome.astro` is starter cruft: a **cosmic dark** hero ("10x Astro Starter", `bg-cosmic`, gradient text, glass cards) with three generic English feature cards (auth / stack / DX) unrelated to JobTracker. It imports `Topbar.astro`.
- `src/components/Topbar.astro` is a cosmic-styled auth-state bar used **only** by `Welcome.astro` (confirmed by grep — no other importer). Once the landing goes light-themed and logged-out-only, it is dead code.
- The **real product** is light-themed and Polish: `AppNav.astro` (brand "JobTracker", links "Tablica"/"Archiwum", "Wyloguj" button, `bg-white` + `border-neutral-200`), `dashboard.astro`/`AppShell.astro` (`bg-neutral-50`, `max-w-7xl` container). AGENTS.md mandates Polish UI copy.
- `middleware.ts` gates only `/dashboard` and `/archive`; `/` is public. `Astro.locals.user` is populated on every request, so a page-level redirect in `index.astro` is trivial.
- No test (`tests/http`, `tests/e2e`, `tests/integration`, `tests/unit`) references `Welcome`, `Topbar`, or the landing copy — grep found zero matches. Rewriting the landing breaks no existing suite.

### Key Discoveries:

- Landing → `Welcome.astro`: `src/pages/index.astro:2`, `:6-8`.
- Light-theme reference patterns to mirror: `src/components/app/AppNav.astro:16-35` (header: `bg-white`, `border-neutral-200`, brand + links) and `src/layouts/AppShell.astro:14-18` (`bg-neutral-50`, `mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8`).
- `cn()` from `@/lib/utils` is the only permitted class-merge helper (AGENTS.md); no `class:list`.
- Auth entry points already exist: `/auth/signin`, `/auth/signup` (`src/pages/auth/`).
- `Topbar.astro` importer count = 1 (`Welcome.astro`), so retiring it is safe.

## Desired End State

Visiting `/` while **logged out** renders a light-themed Polish JobTracker landing: a header with the "JobTracker" wordmark and Zaloguj / Zarejestruj links, a hero (headline + subhead + primary "Zarejestruj się" and secondary "Zaloguj się" buttons), and three feature cards. Visiting `/` while **logged in** redirects (302) to `/dashboard`. No cosmic styling and no English copy remain on the landing. `Topbar.astro` no longer exists (or is unreferenced). `npm run typecheck && npm run lint && npm test` all pass.

## What We're NOT Doing

- **Not** translating or restyling the auth pages (`signin.astro`, `signup.astro`) — they stay cosmic/English for now (separate change).
- **Not** adding a "how it works" section, product screenshot/mockup, or board preview — hero + 3 cards only.
- **Not** highlighting LinkedIn / JustJoin.it scraping on the landing (deselected; parser UX isn't a user-facing entry point yet).
- **Not** changing `middleware.ts` — the redirect lives in the page.
- **Not** adding new dependencies, routes, API endpoints, or data model changes.
- **Not** adding automated E2E/browser assertions or a logged-in-redirect HTTP test for the landing (the redirect stays manual — see 1.9). **One** exception: a single `tests/http` smoke assertion that logged-out `/` serves the landing with 200 (not a redirect), since that suite already drives `astro dev` via `fetch` and the check is cheap.

## Implementation Approach

Rewrite `Welcome.astro` in place as a self-contained light-themed landing (its own light header + hero + cards — no dependency on `Topbar`). Add a one-line auth redirect to `index.astro`. Remove the now-unused `Topbar.astro`. Copy is Polish; layout and spacing mirror `AppNav`/`AppShell` so the page feels continuous with the product. Icons follow the existing inline-SVG pattern already used in `Welcome.astro` (lucide glyphs as inline `<svg>`), keeping React out of a static page per the island rule.

## Phase 1: Rebuild the landing page

### Overview

Swap the boilerplate cosmic landing for a light Polish JobTracker landing, redirect authenticated users to the board, and retire the unused cosmic `Topbar`.

### Changes Required:

#### 1. Landing page component

**File**: `src/components/Welcome.astro`

**Intent**: Replace the entire cosmic starter markup with a light-themed Polish landing. Remove the `Topbar` import and the `bg-cosmic` / orb / star-field / gradient-text markup. Build: (a) a light header — `bg-white` with `border-neutral-200`, "JobTracker" wordmark on the left, "Zaloguj się" / "Zarejestruj się" links on the right, mirroring `AppNav.astro`'s structure; (b) a hero — Polish headline + one-line subhead describing JobTracker (capture postings, organize on a Kanban board, move through the application lifecycle), plus a primary CTA button linking `/auth/signup` and a secondary linking `/auth/signin`; (c) a three-card feature grid. Use `cn()` for any conditional/merged classes; keep icons as inline `<svg>` following the existing file's pattern.

**Contract**: Static `.astro` component, no props, no React. The whole page is an outer `min-h-screen bg-neutral-50` wrapper (mirroring `AppShell.astro:14` — the page background lives on the full-height wrapper, not the content container, since `Layout.astro` renders no background of its own); the header and content sit inside it, with content constrained to `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8`. Three feature cards, Polish copy:

- **Tablica Kanban** — organizuj oferty na tablicy i przesuwaj je przez kolejne etapy rekrutacji (Interesujące → Zaaplikowano → Rozmowa).
- **Zapisuj i porządkuj oferty** — trzymaj wszystkie interesujące ogłoszenia w jednym miejscu.
- **Notatki i przypomnienia** — dodawaj notatki i śledź follow-upy przy każdej aplikacji.

Card styling follows the app's light surface: `rounded-xl border border-neutral-200 bg-white p-6`. Primary CTA uses a solid neutral/dark button, secondary an outline — match the button treatments already in `AppNav.astro` (`border border-neutral-300 bg-white`) and `SubmitButton`/dashboard conventions rather than inventing new colors.

#### 2. Authenticated redirect

**File**: `src/pages/index.astro`

**Intent**: Before rendering, if `Astro.locals.user` is set, redirect to `/dashboard` so existing users skip the marketing page. Otherwise render the landing as today.

**Contract**: In the frontmatter, `if (Astro.locals.user) return Astro.redirect("/dashboard");`. Optionally pass a Polish `title` (e.g. "JobTracker — śledź swoje aplikacje") to `Layout`. `Layout` + `<Welcome />` render path otherwise unchanged.

#### 3. Retire the cosmic Topbar

**File**: `src/components/Topbar.astro` (delete)

**Intent**: Remove the now-unused cosmic auth-state bar. Its only importer was `Welcome.astro`, which no longer references it.

**Contract**: File deleted. Grep confirms zero remaining importers of `Topbar` after Phase 1 step 1. If any reference is discovered during implementation, stop and reassess rather than leaving a dangling import.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Tests pass: `npm test`
- No dangling references to the deleted component: grep for `Topbar` across `src/` returns no matches.
- No leftover starter/cosmic artifacts on the landing: grep for `bg-cosmic` and `10x Astro Starter` in `src/components/Welcome.astro` returns no matches.
- Logged-out `/` serves the landing over HTTP: `tests/http/landing.test.ts` asserts an unauthenticated `GET /` returns 200 (not a redirect) and the body contains the Polish landing.

#### Manual Verification:

- Visiting `/` logged out shows the light Polish landing (header, hero, three feature cards) with no cosmic styling and no English copy.
- "Zarejestruj się" navigates to `/auth/signup`; "Zaloguj się" navigates to `/auth/signin`.
- Visiting `/` while logged in redirects to `/dashboard`.
- Layout is responsive (single-column cards on mobile, three-up on `sm+`); no horizontal scroll.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation from the human that manual testing was successful before considering the change done.

---

## Testing Strategy

### Unit Tests:

- None required — the landing is a static `.astro` component with no logic beyond a redirect. Existing suites must stay green.

### HTTP Tests:

- Add one smoke assertion to `tests/http/` (new `landing.test.ts`, mirroring `archive-pages.test.ts`'s SSR-via-`fetch` pattern with `TEST_BASE_URL`): an **unauthenticated** `GET /` returns **200** (not a 3xx redirect) and the body contains the Polish landing (e.g. the "JobTracker" wordmark / a hero string). No cookie/session helpers needed for this case. The logged-in `/` → `/dashboard` redirect stays **manual** (1.9).

### Integration Tests:

- None. No new API, data model, or RLS surface.

### Manual Testing Steps:

1. Run `npm run dev`; open `/` in a logged-out browser session — verify hero, CTAs, and three Polish feature cards on the light theme.
2. Click each CTA — confirm `/auth/signup` and `/auth/signin` load.
3. Sign in, then navigate to `/` — confirm the redirect to `/dashboard`.
4. Resize to mobile width — confirm cards stack and there is no horizontal overflow.
5. (Optional) Use the `e2e-browser` skill for an authenticated + unauthenticated pass.

## Migration Notes

None — no data or schema involved. Deleting `Topbar.astro` is safe once its sole importer is rewritten.

## References

- Landing entry: `src/pages/index.astro:2`
- Component to rewrite: `src/components/Welcome.astro`
- Light-theme header pattern: `src/components/app/AppNav.astro:16-35`
- Light-theme page container: `src/layouts/AppShell.astro:14-18`
- Auth routes: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`
- Middleware / auth resolution: `src/middleware.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rebuild the landing page

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`
- [x] 1.3 Tests pass: `npm test`
- [x] 1.4 No dangling `Topbar` references in `src/`
- [x] 1.5 No `bg-cosmic` / `10x Astro Starter` remnants in `Welcome.astro`
- [x] 1.6 Logged-out `/` serves the landing over HTTP: `tests/http/landing.test.ts` asserts unauthenticated `GET /` returns 200 (not a redirect) and the body contains the Polish landing

#### Manual

- [x] 1.7 Logged-out `/` shows the light Polish landing (header, hero, 3 cards); no cosmic styling / English copy
- [x] 1.8 CTAs navigate to `/auth/signup` and `/auth/signin`
- [x] 1.9 Logged-in `/` redirects to `/dashboard`
- [x] 1.10 Responsive: cards stack on mobile, three-up on `sm+`, no horizontal scroll
