# Auth Page Rework Implementation Plan

## Overview

The sign-in, sign-up, and confirm-email pages are the last surfaces still using the old
"cosmic" starter theme — a dark gradient background (`bg-cosmic`), glassmorphism card
(`bg-white/10 backdrop-blur-xl`), gradient-text headings, purple accents — and their copy
is in **English** ("Sign in", "Password", "Email is required"). Every other page (landing
`Welcome.astro`, dashboard `AppShell`/`AppNav`) uses a light neutral theme
(`bg-neutral-50`, white cards with `border-neutral-200`, `text-neutral-900`) and Polish
copy.

This change migrates the three auth pages and their six React components to the app's light
Polish theme via a shared `AuthLayout.astro`, and removes the now-dead `bg-cosmic` utility.
It is a visual + copy change only — no auth behavior, API, routing, data-model, or
dependency changes.

## Current State Analysis

**Pages** (`src/pages/auth/`):

- `signin.astro`, `signup.astro`, `confirm-email.astro` each wrap a centered glassmorphism
  card in a `bg-cosmic flex min-h-screen items-center justify-center p-4` container. Card:
  `w-full max-w-sm rounded-2xl border border-white/10 bg-white/10 p-8 text-white
backdrop-blur-xl`. Headings use `bg-gradient-to-r from-blue-200 to-purple-200
bg-clip-text text-transparent`. Links use `text-purple-300`. No header/nav.
- `signin.astro` and `signup.astro` read `?error=` from the URL and pass it to the form as
  `serverError`. `confirm-email.astro` branches on `import.meta.env.DEV` for its copy.

**Components** (`src/components/auth/`):

- `SignInForm.tsx` / `SignUpForm.tsx` — client-validated forms. English labels,
  placeholders, and validation messages ("Email is required", "Passwords do not match",
  "N more characters needed"). `SignUpForm` has a `passwordHint` styled `text-blue-100/50`.
- `FormField.tsx` — input styled `bg-white/10 border ... text-white placeholder-white/40`,
  label `text-blue-100/80`, focus ring `focus:ring-purple-400`, error border
  `border-red-400/60`. Leading lucide icon (`Mail`/`Lock`) in `text-white/40`.
- `SubmitButton.tsx` — `bg-purple-600 hover:bg-purple-500 text-white`, uses `useFormStatus`
  pending state. Wraps `@/components/ui/button`.
- `PasswordToggle.tsx` — eye toggle in `text-white/40 hover:text-white/70`.
- `ServerError.tsx` — `border-red-500/30 bg-red-900/30 text-red-300` alert.

**Reference design** (already established):

- Landing header (`Welcome.astro:6-21`): `border-b border-neutral-200 bg-white` header with
  `text-base font-bold text-neutral-900` "JobTracker" wordmark and Zaloguj/Zarejestruj links.
- Landing feature card (`Welcome.astro:51`): `rounded-xl border border-neutral-200 bg-white
p-6`. KanbanCard (`KanbanCard.tsx:142`): same recipe + `shadow-sm`.
- Landing primary CTA (`Welcome.astro:36`): `bg-neutral-900 ... text-white hover:bg-neutral-800`.
- Polish copy conventions in-app: "Zaloguj się", "Zarejestruj się", "Wyloguj".

**Constraints / findings:**

- `bg-cosmic` (`global.css:113`) is used **only** by the three auth pages — verified by grep.
  After this change it is dead code.
- No test asserts on auth page copy. `tests/http/archive-pages.test.ts` only checks the
  `/auth/signin` redirect **URL**, which is unaffected.
- The `serverError` shown on the pages originates in the auth API
  (`src/pages/api/auth/{signin,signup}.ts`): either the hardcoded English
  `"Supabase is not configured"` or Supabase's upstream `error.message` (English). These are
  **out of scope** (see What We're NOT Doing).
- No shadcn `Card` or `Input` component exists; every app surface is hand-composed from
  `border border-neutral-200 bg-white`.

## Desired End State

Unauthenticated visitors at `/auth/signin`, `/auth/signup`, and `/auth/confirm-email` see a
**light Polish** page: a `bg-white` header with the "JobTracker" wordmark (linking to `/`)
over a `bg-neutral-50` body, with a centered white card (`rounded-xl border
border-neutral-200 bg-white p-8 shadow-sm`) holding the form. Inputs are light
(`bg-white`, `border-neutral-300`, `text-neutral-900`) with their leading Mail/Lock icons
retained in neutral, the primary button is `bg-neutral-900`, and all labels, placeholders,
buttons, and client-side validation messages read in Polish. No cosmic styling, gradient
text, purple accent, or English copy remains on any auth surface, and the `bg-cosmic`
utility is gone from `global.css`.

Verify by loading each page (light theme, Polish copy), triggering client validation (Polish
messages), and grepping the repo for zero `cosmic`, `bg-white/10`, `text-purple`, or
`backdrop-blur` occurrences under `src/pages/auth` and `src/components/auth`.

### Key Discoveries:

- `bg-cosmic` is used only in the three auth pages (`global.css:113` is otherwise dead).
- Landing header + feature-card + neutral-900 CTA are the exact reusable reference patterns.
- Server-error copy is English but lives in the API, not the pages — deliberately out of scope.
- No tests assert on auth page copy; only the signin redirect URL is asserted (unaffected).

## What We're NOT Doing

- **No auth behavior changes** — no logged-in→dashboard redirect on `/auth/*`, no middleware
  edits, no changes to `src/pages/api/auth/*`.
- **No server-error translation** — Supabase's upstream English `error.message` and the
  hardcoded `"Supabase is not configured"` string stay as-is (they live in the API and
  mapping provider error codes to Polish is a separate concern). Flagged as a residual.
- **No new pages** — no forgot-password / reset-password (they don't exist today).
- **No new dependencies, routes, data-model, or RLS changes.**
- **No `src/components/ui/` changes** — `SubmitButton` keeps wrapping `ui/button`; we only
  change the classes passed to it.
- **No OAuth / Google sign-in work** (tracked separately).

## Implementation Approach

Extract a single `AuthLayout.astro` that owns the light frame (header + `bg-neutral-50` body

- centered white card slot), so the three pages become thin content wrappers and the visual
  frame has one source of truth. Then restyle the six React components in place — swapping the
  dark/glass classes for the light equivalents already used elsewhere and translating every
  user-facing string to Polish. Finally delete the dead `bg-cosmic` utility. Static frame stays
  in `.astro` (island rule); the interactive forms stay React. All class merging via `cn()`.

## Phase 1: Shared light shell

### Overview

Introduce `AuthLayout.astro` with the light header + centered card, migrate all three auth
pages onto it with Polish page-level copy, and remove the dead `bg-cosmic` utility.

### Changes Required:

#### 1. New shared auth layout

**File**: `src/layouts/AuthLayout.astro`

**Intent**: Own the auth frame in one place — a light header (matching `Welcome.astro`'s)
with the "JobTracker" wordmark linking to `/`, a `bg-neutral-50 min-h-screen` body, and a
centered white card that renders the page's form via `<slot />`. Accepts `title` (page
`<title>`) and `heading` (the visible `<h1>`) props.

**Contract**: Wraps `@/layouts/Layout.astro` (for `<title>` + config banner). Card recipe:
`w-full max-w-sm rounded-xl border border-neutral-200 bg-white p-8 shadow-sm` centered in a
`flex min-h-screen items-center justify-center p-4` container (header sits above, outside the
centering wrapper — mirror `Welcome.astro`'s header markup). Heading: `mb-6 text-center
text-2xl font-bold text-neutral-900` (no gradient). Merge classes via `cn()`.

#### 2. Sign-in page onto the layout

**File**: `src/pages/auth/signin.astro`

**Intent**: Replace the inline cosmic markup with `AuthLayout`, keeping the `?error=` →
`serverError` wiring and the sign-up cross-link, translated to Polish.

**Contract**: `<AuthLayout title="Zaloguj się" heading="Zaloguj się">` containing
`<SignInForm serverError={error} client:load />` and a Polish footer link: "Nie masz konta?
Zarejestruj się" → `/auth/signup`, styled `text-neutral-600` with a `text-neutral-900`
underlined link (match landing link styling, not purple).

#### 3. Sign-up page onto the layout

**File**: `src/pages/auth/signup.astro`

**Intent**: Same migration as signin, for the sign-up form.

**Contract**: `<AuthLayout title="Zarejestruj się" heading="Zarejestruj się">` with
`<SignUpForm serverError={error} client:load />` and Polish footer link: "Masz już konto?
Zaloguj się" → `/auth/signin`.

#### 4. Confirm-email page onto the layout

**File**: `src/pages/auth/confirm-email.astro`

**Intent**: Migrate the post-signup confirmation page to the light frame and translate its
`isAutoConfirmed` branch copy to Polish.

**Contract**: `<AuthLayout>` with the emoji + description + back-to-signin link as slot
content. Polish copy — DEV branch: heading "Rejestracja zakończona sukcesem", description
"Twoje konto zostało utworzone. Możesz się teraz zalogować.", link "Przejdź do logowania";
non-DEV branch: heading "Sprawdź swoją skrzynkę", description "Wysłaliśmy link
potwierdzający na Twój adres e-mail. Kliknij go, aby aktywować konto.", link "Wróć do
logowania". Body/link text neutral (`text-neutral-600` / `text-neutral-900`), no gradient.

#### 5. Remove dead cosmic utility

**File**: `src/styles/global.css`

**Intent**: Delete the `@utility bg-cosmic { ... }` block (lines ~113-115) now that no page
references it.

**Contract**: Remove the three-line `@utility bg-cosmic` declaration. No other CSS changes.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Tests pass: `npm test`
- Zero cosmic remnants in pages: `grep -rn "cosmic\|bg-white/10\|backdrop-blur\|from-blue-200\|text-purple" src/pages/auth` returns nothing
- `bg-cosmic` fully gone: `grep -rn "cosmic" src/` returns nothing

#### Manual Verification:

- `/auth/signin`, `/auth/signup`, `/auth/confirm-email` render on the light theme with the
  JobTracker header, a centered white card, and Polish headings/links
- The JobTracker wordmark links back to `/`
- Confirm-email shows the correct Polish copy for the current env (DEV auto-confirm vs email)

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding to Phase 2. (The forms inside the card are
still cosmic-styled until Phase 2 — expected mid-migration.)

---

## Phase 2: Restyle + translate form components

### Overview

Convert the six auth React components to light styling and Polish copy so the forms match the
new shell.

### Changes Required:

#### 1. Light input field

**File**: `src/components/auth/FormField.tsx`

**Intent**: Restyle the input, label, leading icon, and error/hint text from dark/glass to
light. Keep the leading-icon slot and behavior.

**Contract**: `inputBase` → light: `w-full rounded-lg border bg-white px-3 py-2 pl-10
text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 transition-colors`.
Label → `text-neutral-700`. Leading icon → `text-neutral-400`. Error state border/ring →
neutral-friendly destructive (`border-red-500 focus:ring-red-500`); default border/ring →
`border-neutral-300 focus:ring-neutral-400`. Error text → `text-red-600`. Merge via `cn()`.

#### 2. Neutral submit button

**File**: `src/components/auth/SubmitButton.tsx`

**Intent**: Swap the purple button classes for the landing's neutral-900 primary CTA.

**Contract**: `className` → `w-full rounded-lg bg-neutral-900 px-4 py-2 font-medium
text-white transition-colors hover:bg-neutral-800`. Spinner border stays light-on-dark
(`border-white/30 border-t-white`) since the button is dark. No change to `useFormStatus`
logic or the `ui/button` wrapper.

#### 3. Neutral password toggle

**File**: `src/components/auth/PasswordToggle.tsx`

**Intent**: Restyle the eye toggle for a light input and translate its `aria-label`.

**Contract**: Classes → `text-neutral-400 hover:text-neutral-600`. `aria-label` → Polish:
"Ukryj hasło" / "Pokaż hasło".

#### 4. Light server-error alert

**File**: `src/components/auth/ServerError.tsx`

**Intent**: Restyle the error banner for the light theme (the message text itself is
API-provided and unchanged).

**Contract**: Classes → `border-red-200 bg-red-50 text-red-700` (keep `rounded-lg`, icon,
layout).

#### 5. Sign-in form copy

**File**: `src/components/auth/SignInForm.tsx`

**Intent**: Translate all user-facing strings to Polish; restyle nothing beyond what the
shared components already handle.

**Contract**: Labels "Email"/"Password" → "Email"/"Hasło"; placeholders → "ty@example.com" /
"Twoje hasło"; validation messages → "Podaj adres email", "Podaj poprawny adres email",
"Podaj hasło"; SubmitButton `pendingText` "Logowanie..." and children "Zaloguj się".

#### 6. Sign-up form copy + hint

**File**: `src/components/auth/SignUpForm.tsx`

**Intent**: Translate all strings and the password-length hint to Polish; recolor the hint
for the light theme.

**Contract**: Labels → "Email" / "Hasło" / "Powtórz hasło"; placeholders → "ty@example.com",
"Min. 6 znaków", "Powtórz hasło"; validation → "Podaj adres email", "Podaj poprawny adres
email", "Podaj hasło", "Hasło musi mieć co najmniej 6 znaków", "Potwierdź hasło", "Hasła nie
są takie same"; `passwordHint` text → Polish (e.g. "Brakuje jeszcze N znaków", handling the
plural form) and recolored to `text-neutral-500`; SubmitButton `pendingText` "Tworzenie
konta..." and children "Utwórz konto".

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Tests pass: `npm test`
- Zero dark/purple remnants in components: `grep -rn "text-white\|bg-white/10\|text-blue-100\|purple\|border-white" src/components/auth` returns nothing (spinner `border-white/30 border-t-white` on the dark button is the only allowed `white` — confirm any hit is that)
- No English UI strings remain: manual grep of `src/components/auth` for the old English labels/messages returns nothing

#### Manual Verification:

- Sign-in and sign-up forms render as light inputs with neutral icons, neutral-900 button,
  and Polish labels/placeholders/buttons
- Submitting an empty form shows Polish validation messages; the sign-up length hint shows
  Polish text with correct pluralization
- A server error (e.g. wrong credentials) renders in the light red alert (message text may
  still be English — expected, out of scope)
- Password visibility toggle works and reads Polish via screen reader/aria

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- No new unit tests. The auth components are presentational/validation-only and have no
  existing unit coverage; behavior (validation gating, pending state) is unchanged.

### Integration Tests:

- None. No API, RLS, or PostgREST surface changes.

### Manual Testing Steps:

1. Load `/auth/signin` — light theme, JobTracker header, centered white card, Polish "Zaloguj
   się" heading and "Nie masz konta? Zarejestruj się" link.
2. Submit empty — Polish validation ("Podaj adres email", "Podaj hasło").
3. Load `/auth/signup` — Polish "Zarejestruj się"; type a 3-char password and confirm the
   Polish length hint with correct plural; mismatch confirm → "Hasła nie są takie same".
4. Complete a real signup → land on `/auth/confirm-email` rendered light with Polish copy for
   the current env.
5. Attempt sign-in with bad credentials → light red server-error alert renders.
6. Click the JobTracker wordmark → navigates to `/`.
7. Grep repo: no `cosmic` anywhere; no cosmic/English remnants under `src/pages/auth` or
   `src/components/auth`.

## Migration Notes

None — no data or persisted state involved. Pure presentation + copy change.

## References

- Change identity: `context/changes/auth-page-rework/change.md`
- Reference (light theme + Polish landing): `context/archive/2026-07-21-landing-page/plan.md`,
  `src/components/Welcome.astro`
- Card/CTA patterns: `src/components/Welcome.astro:36,51`, `src/components/board/KanbanCard.tsx:142`
- Header pattern: `src/components/app/AppNav.astro`, `src/components/Welcome.astro:6-21`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared light shell

#### Automated

- [x] 1.1 Typecheck passes: `npm run typecheck` — 9457fcb
- [x] 1.2 Lint passes: `npm run lint` — 9457fcb
- [x] 1.3 Tests pass: `npm test` — 9457fcb
- [x] 1.4 Zero cosmic remnants in `src/pages/auth` — 9457fcb
- [x] 1.5 `bg-cosmic` fully gone from `src/` — 9457fcb

#### Manual

- [x] 1.6 Three auth pages render light with header, white card, Polish copy — 9457fcb
- [x] 1.7 JobTracker wordmark links back to `/` — 9457fcb
- [x] 1.8 Confirm-email shows correct Polish copy for the current env — 9457fcb

### Phase 2: Restyle + translate form components

#### Automated

- [x] 2.1 Typecheck passes: `npm run typecheck` — 48d4004
- [x] 2.2 Lint passes: `npm run lint` — 48d4004
- [x] 2.3 Tests pass: `npm test` — 48d4004
- [x] 2.4 Zero dark/purple remnants in `src/components/auth` (except the dark-button spinner) — 48d4004
- [x] 2.5 No English UI strings remain in `src/components/auth` — 48d4004

#### Manual

- [x] 2.6 Forms render light with neutral icons, neutral-900 button, Polish copy — 48d4004
- [x] 2.7 Empty-submit shows Polish validation; sign-up length hint pluralizes in Polish — 48d4004
- [x] 2.8 Server error renders in the light red alert — 48d4004
- [x] 2.9 Password visibility toggle works with Polish aria-label — 48d4004
