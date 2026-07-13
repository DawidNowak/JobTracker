# Parser-driven add — Implementation Plan

## Overview

Ship the S-04 north-star slice: when a user pastes a LinkedIn or JustJoinIT job URL into the existing add-application form's source field, a "Pobierz dane oferty" button becomes available; clicking it calls a new server endpoint that fetches and deterministically extracts position, company, description (with skills prefixed), salary, and work_mode from the upstream HTML, then pre-fills the form. The user can edit any field before saving. Parser failure or an unsupported portal leaves the activated button + clear inline message; the manual path stays fully usable.

## Current State Analysis

S-02 (`b3ff36b`) shipped the manual add path on master. The form (`src/components/board/AddApplicationDialog.tsx`), validation schema (`src/lib/validation/applications.ts`), create endpoint (`src/pages/api/applications/index.ts`), and kanban card URL contract (`src/components/board/KanbanCard.astro:12-34`) are all in place and intentionally shaped to be the parser's hook points.

- No HTTP fetch helper, no rate-limit utility, no HTML parser dependency exists in the codebase.
- `HTMLRewriter` is a workerd-native global available inside `@astrojs/cloudflare` server endpoints (no import, no dependency).
- The `applications` schema (`supabase/migrations/20260526123145_applications_schema.sql:13-28`) does not include a `skills` column. Per planning decision Q1, skills will be appended into the description prefix rather than added as a column — no migration in this slice.
- No test framework is configured (AGENTS.md) — do not scaffold tests.

## Desired End State

- Source field on the add dialog continues to accept any free text per FR-003 (S-02 behavior unchanged).
- A "Pobierz dane oferty" button sits adjacent to the source field; it is enabled only when the trimmed source value matches a supported portal (any `*.linkedin.com` host with an extractable jobId, or `justjoin.it` with a `/job-offer/{slug}` path).
- Clicking the button POSTs `{ source }` to `/api/applications/parse`; the endpoint authenticates via cookie session (mirroring `/api/applications`), validates the payload with Zod, routes to the matching portal parser, and returns `{ result: { position?, company?, description?, salary?, work_mode? }, status: "ok" | "partial" | "empty" | "unsupported" | "fetch_failed", message?: string }`.
- The form merges returned fields into its state (overwriting whatever the user had — the button is an explicit user action) and renders an inline non-blocking message above the form fields describing what happened (`status: "partial"` and `status: "empty" | "fetch_failed"`).
- A JJIT URL test case (`https://justjoin.it/job-offer/skywise-senior-net-backend-developer-gdansk-net`) pre-fills at least position, company, description, salary, and work_mode under normal network conditions.
- A LinkedIn URL test case pre-fills at least position, company, and description when the Worker's outbound request succeeds; on HTTP 999 / authwall / empty fragment, the form shows the soft-failure message and the user fills manually.

### Key Discoveries:

- `HTMLRewriter` is the right primitive: zero dependency, fits the 3 MiB Free-plan Worker limit. Pair it with regex on the JJIT RSC payload (research §Cloudflare Workers HTML parsing).
- JJIT's legacy REST API was shut down November 2023; the only deterministic surface is the HTML page's `self.__next_f.push([1,"..."])` Flight chunks (research §JustJoinIT).
- LinkedIn's canonical `/jobs/view/{id}` is an authwall — only `/jobs-guest/jobs/api/jobPosting/{id}` returns usable HTML, and even that is blocked 30–60% of the time from Cloudflare Worker egress IPs (research §LinkedIn).
- Card URL contract already shipped — `KanbanCard.astro:12-34` uses `new URL(...)` + `http:`/`https:` protocol gate; the parser's URL recognizer mirrors this contract.

## What We're NOT Doing

- No `skills` column migration (Q1 decision — skills join the description prefix instead).
- No KV-backed cache of parse results (Q7 decision — revisit if rate-limits bite).
- No per-user rate limit, no response body cap, no abuse circuit-breaker (Q8 decision — timeout only).
- No third-party scraping service, no vendor API, no headless browser.
- No paid proxy or anti-bot bypass for LinkedIn — we live with the documented 30–60% failure rate via soft fallback.
- No new portal beyond LinkedIn and JustJoinIT — Pracuj.pl, Indeed, NoFluffJobs are out of scope.
- No retry/backoff logic — a single fetch attempt per click; the user can simply click again.
- No tests scaffolded (AGENTS.md hard rule).

## Implementation Approach

A new directory `src/lib/parsers/` houses the parser surface:

- `recognize.ts` — pure function `recognize(source: string): { kind: "linkedin"; jobId: string } | { kind: "jjit"; slug: string } | null`. Pure, isomorphic, importable by both the React form and the API route — single source of truth for "is this URL a supported portal?".
- `types.ts` — `ParseResult` and `ParseStatus` types.
- `linkedin.ts` — `parseLinkedIn(jobId): Promise<ParseResult>` (fetch + HTMLRewriter).
- `justjoinit.ts` — `parseJustJoinIT(slug): Promise<ParseResult>` (fetch + HTMLRewriter for script bodies + regex for Flight chunks).

A new API route `src/pages/api/applications/parse.ts` validates `{ source }`, runs `recognize()`, delegates to the matching parser module, and returns the uniform `{ result, status, message? }` envelope. All upstream-fetch failure modes collapse to `status: "fetch_failed"` with an empty `result` — the endpoint always returns HTTP 200 so the client treats it as a soft outcome, not a transport error.

The form gains a single new affordance: a button between the source `<Input>` and the "Stanowisko" field, with `parsing` / `parseStatus` / `parseMessage` state. Activation is gated by `recognize(form.source.trim()) !== null`. The button's onClick posts to the parse endpoint and merges the returned partial into `form` via the existing `update()` setter chain.

## Critical Implementation Details

- **Skills into description**: when a portal returns a non-empty skills array, the parser prepends `"Wymagane umiejętności: <comma-joined list>\n\n"` to the description string before returning. This is the only place "skills" is materialized in the slice.
- **Salary normalization (JJIT)**: `employment_types[]` rows with non-null `from` are formatted per row, then joined with `"; "`. Per-row format depends on `to`:
  - `to` is non-null: `"{from} – {to} {currency}/{unit} ({contract-label})"`
  - `to` is null (single-point / "from only" salary): `"{from}+ {currency}/{unit} ({contract-label})"`
    Contract labels map: `b2b → B2B`, `permanent → UoP`, `mandate_contract → UZ`, `internship_contract → staż`. If no entry has a non-null `from`, omit the field (do not set to empty string).
- **LinkedIn outbound headers**: include `User-Agent: Mozilla/5.0 ... Chrome/...` and `Accept-Language: en-US,en;q=0.9,pl;q=0.8`. Without a realistic UA, LinkedIn returns HTTP 999 even when the IP would otherwise pass.
- **AbortSignal timeout**: `fetch(url, { signal: AbortSignal.timeout(8000) })` — workerd supports this. Caught timeout collapses to `status: "fetch_failed"`.
- **Endpoint never throws to the client**: every catch-all returns `status: "fetch_failed"` with an empty result. The client treats non-200 from this endpoint as a hard error only (network glitch); 200 + empty result is the soft-failure path.
- **Dev-runtime preflight (one-time, before Phase 1 implementation starts)**: `HTMLRewriter` is a workerd global, guaranteed in production. `astro dev` with `@astrojs/cloudflare` v13.5 _should_ expose it, but this has not been verified in this repo. Add a temporary route (e.g. `src/pages/api/_probe.ts` returning `new Response(typeof HTMLRewriter)`) and hit it via `curl http://localhost:4321/api/_probe`. Expected: `"function"`. If it reports `"undefined"`, switch all Phase 2/3 manual verification to `npm run preview` (which serves the built worker output) or `wrangler dev`, and document the substitution at the top of Phases 2/3. Delete the probe route before merging.

---

## Phase 1: Shared URL recognition + parse endpoint scaffold

### Overview

Land the isomorphic `recognize()` utility, the `applicationParseSchema`, the `/api/applications/parse` endpoint with auth + Zod validation + 8s-timeout discipline, and stub portal parsers returning empty results. This unblocks Phase 4's form work in parallel with Phases 2 and 3, and it locks the soft-failure envelope shape before either portal is implemented.

### Changes Required:

#### 1. URL recognition utility

**File**: `src/lib/parsers/recognize.ts`

**Intent**: Provide a single pure function used by both client (button activation) and server (endpoint routing) that maps a raw source string to a portal key, or returns `null` when the source is plain text or an unsupported host. This is the canonical "is this URL parseable?" check.

**Contract**: `export function recognize(source: string): { kind: "linkedin"; jobId: string } | { kind: "jjit"; slug: string } | null`. Trims input; rejects empty; constructs `new URL()` (returns null on throw); rejects non-http/https. LinkedIn match: hostname `=== "linkedin.com"` or `endsWith(".linkedin.com")`; jobId extraction is two-step (`searchParams.get("currentJobId")` first, then `pathname.match(/(\d{8,})(?:[/?#]|$)/)` as fallback). JJIT match: hostname `=== "justjoin.it"`, pathname `=== "/job-offer/{slug}"` where slug matches `/^[a-z0-9-]+$/`.

#### 2. Parser result types

**File**: `src/lib/parsers/types.ts`

**Intent**: Declare the envelope returned by both portal parsers and by the API route so the client has one stable shape to consume.

**Contract**: `ParseResult` = `{ position?: string; company?: string; description?: string; salary?: string; work_mode?: "Zdalna" | "Hybrydowa" | "Stacjonarna" }`. `ParseStatus` = `"ok" | "partial" | "empty" | "unsupported" | "fetch_failed"`. `ParseEndpointResponse` = `{ result: ParseResult; status: ParseStatus; message?: string }`. The `WorkMode` value union mirrors `workModeValues` from `src/lib/validation/applications.ts` — import the type rather than redeclaring.

#### 3. Portal parser stubs

**File**: `src/lib/parsers/linkedin.ts`

**Intent**: Reserve the module shape so the endpoint can import and call it from day one. Returns an empty `ParseResult` until Phase 3 lands.

**Contract**: `export async function parseLinkedIn(jobId: string): Promise<ParseResult>`. Stub returns `{}`. No fetch yet.

**File**: `src/lib/parsers/justjoinit.ts`

**Intent**: Same as above for JJIT, filled in Phase 2.

**Contract**: `export async function parseJustJoinIT(slug: string): Promise<ParseResult>`. Stub returns `{}`. No fetch yet.

#### 4. Zod schema for the parse endpoint

**File**: `src/lib/validation/applications.ts`

**Intent**: Add the minimal request schema the new endpoint validates against. Co-located with the existing application schemas for discoverability.

**Contract**: `export const applicationParseSchema = z.object({ source: z.string().min(1) });` plus `export type ApplicationParse = z.infer<typeof applicationParseSchema>;`. No transform; the route handler trims explicitly so the contract matches the manual-add path's handling of `source`.

#### 5. Parse API endpoint

**File**: `src/pages/api/applications/parse.ts`

**Intent**: Authenticated, Zod-validated POST endpoint that runs `recognize()` against the trimmed source, dispatches to the matching portal parser, and returns the uniform `ParseEndpointResponse`. Mirrors `src/pages/api/applications/index.ts` for auth and JSON conventions. All upstream-fetch failures and unsupported sources resolve to HTTP 200 with the appropriate `status`; only auth, Zod, and totally-unexpected errors return non-200.

**Contract**: `export const prerender = false; export const POST: APIRoute`. Behavior:

- 401 if `context.locals.user` is null.
- 400 if request body is not JSON.
- 422 if Zod validation fails (matches the manual-add endpoint's error shape).
- Otherwise: trim source → `recognize()` → if null, return 200 with `{ result: {}, status: "unsupported", message: "Nieobsługiwany portal. Wypełnij dane ręcznie." }`.
- On match, call the relevant portal parser inside a try/catch. Catch (including AbortError from the parser's internal timeout) → 200 with `{ result: {}, status: "fetch_failed", message: "Nie udało się pobrać danych. Wypełnij ręcznie." }`.
- On success: count populated keys in `result`. If 0, `status: "empty"` with the same message. If ≥1 and any of {position, company, description, salary, work_mode} for the relevant portal's expected set is missing, `status: "partial"` with `"Wypełniono częściowo. Uzupełnij brakujące pola."`. If all expected keys for the portal are present, `status: "ok"` (no message).
- "Expected set" per portal: JJIT = {position, company, description, salary, work_mode}; LinkedIn = {position, company, description} (research §LinkedIn — salary/work_mode rarely present for Polish postings; their absence isn't "partial").

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- TypeScript type-check passes via the build: `npm run build`
- New files compile and the existing build still succeeds

#### Manual Verification:

- `curl -X POST http://localhost:4321/api/applications/parse` without an auth cookie returns 401.
- With a valid session cookie, POSTing `{ "source": "" }` returns 422 with a `source` error key.
- POSTing `{ "source": "https://example.com/foo" }` returns 200 with `status: "unsupported"`.
- POSTing `{ "source": "https://justjoin.it/job-offer/foo-bar-warsaw-net" }` returns 200 with `status: "empty"` and `result: {}` (parser still stubbed).
- POSTing `{ "source": "https://www.linkedin.com/jobs/view/4399262456" }` returns 200 with `status: "empty"`.
- `recognize()` returns `null` for plain strings, `ftp://...`, `http://example.com`, and `https://linkedin.com/feed` (no jobId).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the soft-failure envelope behaves as expected against the running dev server before proceeding to the next phase.

---

## Phase 2: JustJoinIT parser

### Overview

Replace the JJIT stub with a real implementation that fetches the `/job-offer/{slug}` HTML, extracts the React Flight payload from `self.__next_f.push([1,"..."])` script bodies, locates the offer object, and maps its fields onto `ParseResult` — including the semicolon-joined Polish-labelled salary string and the skills-prepended description.

### Changes Required:

#### 1. JJIT parser implementation

**File**: `src/lib/parsers/justjoinit.ts`

**Intent**: Fetch the JJIT job-offer page; collect every `<script>` text body via HTMLRewriter; pull all `self.__next_f.push([1, "..."])` chunks via regex; `JSON.parse` each captured string literal; concatenate; locate the JSON sub-string containing `"title"` and `"workplace_type"` keys (the offer object); parse it; map to `ParseResult`.

**Contract**: `export async function parseJustJoinIT(slug: string): Promise<ParseResult>`.

- URL: `https://justjoin.it/job-offer/${slug}`.
- Fetch with `AbortSignal.timeout(8000)`, `User-Agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"`, `Accept-Language: "en-US,en;q=0.9,pl;q=0.8"`.
- Non-200 response → throw (endpoint will catch → `fetch_failed`).
- Parse with `HTMLRewriter` collecting text content of `script` elements into a single buffer.
- Extract Flight chunks via `String.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)/gs)`, `JSON.parse(m[1])`, join.
- Find the offer object via **string-aware brace matching** (the riskiest step of this phase):
  > **Post-merge update (2b9e722):** the marker key is now `"workplaceType"` (camelCase, schema drift), and the implementation iterates candidates rather than throwing on the first failed slice. See the Post-merge follow-ups section. The walk algorithm below is otherwise correct.
  1. Locate the first occurrence of `"title"` in the concatenated flight string. If absent, throw.
  2. Walk **backward** from that index, tracking JSON string state (toggle on unescaped `"`, treat `\\"` and `\\\\` as escapes), **incrementing depth on `}` and decrementing on `{`** (intuition: walking backward, an opening `{` "closes" a nested object below, a closing `}` "opens" one) — the enclosing `{` is the first one encountered while depth is zero. If none found before the buffer start, throw.
  3. Walk **forward** from that opening `{` with the same string-state tracking, incrementing on `{` and decrementing on `}` only when not inside a string literal. Stop when depth returns to zero — that index is the closing `}`.
  4. Slice the substring `[open, close+1]`. Verify it contains both `"title"` and `"workplace_type"` as a sanity check (cheap `String.includes`); if either is missing, throw.
  5. `JSON.parse` the slice. Any throw at any step propagates to the endpoint's catch → `fetch_failed` (silent garbage cannot survive the post-slice sanity check + JSON.parse).
- Implementer note: do **not** use a naïve `{...}` regex or a brace counter that ignores string-literal context — JJIT's `body` HTML routinely contains `{` and `}` inside string values and will mis-close the object.
- Map fields per research §JustJoinIT:
  - `position ← offer.title`
  - `company ← offer.company_name`
  - `description ← offer.body` (HTML string from rich-text editor)
  - `salary ← formatSalary(offer.employment_types)` (see Critical Implementation Details — contract labels, semicolon-joined; undefined if no row has a `from`)
  - `work_mode ← mapWorkplaceType(offer.workplace_type)`: `remote → "Zdalna"`, `hybrid → "Hybrydowa"`, `partly_remote → "Hybrydowa"`, `office → "Stacjonarna"`, anything else → undefined
  - If `offer.required_skills` is a non-empty array: prepend `"Wymagane umiejętności: ${required_skills.join(", ")}\n\n"` to `description`.
- Any thrown error (network, parse, JSON.parse, no offer object found) propagates to the endpoint's catch → `fetch_failed`.

**Contract** (the one tricky bit — Flight chunk extraction):

```ts
// Concatenated Flight payload assembly
const chunks: string[] = [];
for (const m of buf.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)/gs)) {
  try {
    chunks.push(JSON.parse(m[1]));
  } catch {
    /* skip malformed chunk */
  }
}
const flight = chunks.join("");
```

The remainder (locating the offer JSON, parsing, mapping) follows ordinary patterns and needs no snippet.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- POSTing `{ "source": "https://justjoin.it/job-offer/skywise-senior-net-backend-developer-gdansk-net" }` (research's reference URL — substitute any then-live JJIT slug if it has expired) returns 200 with `status: "ok"` and a populated `result` containing position, company, non-empty description (with skills prepended), a salary string formatted like `"18 000 – 25 000 PLN/mies. (B2B); ..."`, and a `work_mode` value from the enum.
- POSTing a JJIT URL whose slug returns 404 from JJIT returns 200 with `status: "fetch_failed"`.
- A JJIT posting that genuinely has no salary still returns `status: "partial"` (no salary key) without failing.
- The description HTML is preserved verbatim (paragraph tags, lists, etc.) — no stripping.

**Implementation Note**: After this phase, pause for manual verification against a live JJIT URL before proceeding to LinkedIn.

---

## Phase 3: LinkedIn parser

### Overview

Replace the LinkedIn stub with a fetch of the unauthenticated guest endpoint plus HTMLRewriter selectors over the resulting HTML fragment. Treat HTTP 999 / authwall / empty topcard as a thrown error so the API route's catch collapses to `fetch_failed` and the form falls back to manual entry.

### Changes Required:

#### 1. LinkedIn parser implementation

**File**: `src/lib/parsers/linkedin.ts`

**Intent**: Fetch `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}` with realistic browser headers; parse the returned HTML fragment with HTMLRewriter using the class-hook selectors documented in research §LinkedIn; sniff `work_mode` from title + location + first ~2 KB of description; return a `ParseResult` with whatever was found.

**Contract**: `export async function parseLinkedIn(jobId: string): Promise<ParseResult>`.

- URL: `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(jobId)}`.
- Fetch with `AbortSignal.timeout(8000)`, the same `User-Agent` and `Accept-Language` headers as JJIT.
- HTTP status not 200 → throw (endpoint catch → `fetch_failed`). HTTP 999 falls into this branch automatically.
- Stream the response through `HTMLRewriter`. Selectors to bind text accumulators to:
  - `.top-card-layout__title, .topcard__title` → `position`
  - `.topcard__org-name-link, .topcard__flavor` (first occurrence of either) → `company`
  - `.topcard__flavor.topcard__flavor--bullet` (first) → `location` (local var, not returned)
  - `.show-more-less-html__markup, .description__text` → `description` (preserve inner HTML — use `element` handler that collects `text()` chunks; HTML formatting is acceptable to lose here since the research notes the markup is descriptive)
  - `.compensation__salary` (rare) → `salary`
- Each accumulator buffers `text()` chunks until `lastInTextNode`, then trims and freezes.
- If the resulting `position` is empty after streaming, throw (the topcard wasn't present → authwall / empty fragment).
- `work_mode` sniffer: build a haystack of `position + " " + location + " " + description.slice(0, 2048)`; lowercase; match regex `/\b(zdaln|remote)/` → `"Zdalna"`; else `/\b(hybrydow|hybrid)/` → `"Hybrydowa"`; else `/\b(stacjonarn|on[-\s]?site|onsite)/` → `"Stacjonarna"`; else undefined.
- Skills are not extracted for LinkedIn (no structured surface).
- Return the assembled `ParseResult`. Undefined fields are omitted, not set to empty strings.

**Contract** (only the one non-obvious bit — HTMLRewriter text accumulation pattern, since the codebase has no prior art for it):

```ts
let titleBuf = "";
new HTMLRewriter()
  .on(".top-card-layout__title, .topcard__title", {
    text(t) {
      titleBuf += t.text;
    },
  })
  // ... other selectors
  .transform(response);
await response.text(); // drain
const position = titleBuf.trim() || undefined;
```

The selector list and field mapping flow follow research §LinkedIn directly.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- POSTing `{ "source": "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4399262456" }` (research's reference URL — substitute a then-live numeric jobId) returns 200 with `status: "ok"` or `status: "partial"` when the Worker's outbound fetch succeeds, and the `result` contains at minimum a populated `position` and either `company` or `description` (or both). If the test hits a 999 day, retry from a different network or move on — the contract is that failures are graceful, not that LinkedIn always works.
- POSTing the canonical `https://www.linkedin.com/jobs/view/{id}` URL (the authwall) returns 200 with `status: "fetch_failed"` (or `status: "empty"` if the page returns 200 but with no topcard) — never a hard error.
- The work_mode sniffer returns one of `"Zdalna" | "Hybrydowa" | "Stacjonarna"` or undefined; never an invalid value.

**Implementation Note**: Pause for manual verification — both happy-path and HTTP-999 paths — before proceeding to form integration.

---

## Phase 4: Form integration

### Overview

Wire the new button into `AddApplicationDialog.tsx`. The button enables only when `recognize()` matches; clicking it calls `/api/applications/parse`, merges the result into form state, and renders an inline non-blocking message above the form fields describing the outcome. The manual flow is untouched.

**Architectural note** (no code change): client and server both import the same `recognize()` from `@/lib/parsers/recognize` so the button's activation rule cannot drift from the server's routing rule, but the server (`parse.ts`, Phase 1) is the authority and never trusts the client's activation.

### Changes Required:

#### 1. Parser button + state in the dialog

**File**: `src/components/board/AddApplicationDialog.tsx`

**Intent**: Add the "Pobierz dane oferty" button immediately below the source `<Input>`, with three new pieces of local state: `parsing: boolean`, `parseStatus: ParseStatus | null`, and `parseMessage: string | null`. Activation is `recognize(form.source.trim()) !== null && !parsing`. Reset all three when the dialog is closed via the existing `handleOpenChange(false)` path so a stale message doesn't carry between sessions.

**Contract**:

- Import `recognize` from `@/lib/parsers/recognize` and `ParseStatus`, `ParseEndpointResponse` from `@/lib/parsers/types`.
- The button is a `<Button type="button" variant="secondary">` placed inside the source field's `<div className="flex flex-col gap-1.5">` block, after the `errors.source` paragraph. Disabled when activation predicate fails or `parsing` is true. Label: `"Pobierz dane oferty"` when idle, `"Pobieranie…"` when parsing.
- onClick handler: set `parsing: true`, clear `parseStatus`/`parseMessage`, POST `{ source: form.source.trim() }` to `/api/applications/parse`. On 200, parse the `ParseEndpointResponse`, then for each defined key in `result` call `update(key, value)` (existing setter — also clears any per-field error). Store `parseStatus` and `parseMessage` from the response. On non-200 or thrown error, set `parseStatus: "fetch_failed"` and `parseMessage: "Nie udało się pobrać danych. Wypełnij ręcznie."`.
- Inline message block: above the existing `bannerError` div, render a `<div role="status">` when `parseMessage` is set, styled to match an info/warning convention (e.g., `rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800` for `partial`/`empty`/`unsupported`/`fetch_failed`; suppress when `parseStatus === "ok"` since success speaks for itself via the populated fields).
- On successful submit (`res.status === 201`), state is cleared by the existing dialog-close path — no extra work.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- Open the add dialog from "Interesujące". Type a non-URL into source — the parser button is disabled.
- Type or paste `https://justjoin.it/job-offer/{a-live-slug}` — the button becomes enabled. Click it; loading state appears; on success the form fields fill in and no inline message appears (status `ok`). If salary or work_mode happens to be missing, the amber inline message appears reading `"Wypełniono częściowo..."`.
- Edit any pre-filled field — the edit sticks and submitting the form creates the application with the edited values.
- Paste a LinkedIn URL with a `currentJobId` query param — the button enables and a click either fills position+company+description or shows the soft-failure message. Either is acceptable per the FR-004 graceful-fallback contract.
- Paste a plain text source (e.g., "Recommended by Jan Kowalski") — the button stays disabled; the manual form is fully usable.
- Paste an unsupported URL (e.g., `https://pracuj.pl/...`) — the button stays disabled (host check in `recognize()` fails).
- Close and reopen the dialog after a parse — the inline message and parsing state are reset; the form is empty.
- Submit a form that was pre-filled by the parser — the card appears in the target column with the parsed values.

**Implementation Note**: This is the last phase; after manual verification of all five user-facing paths above, the slice is shippable. Per AGENTS.md, no tests are scaffolded.

---

## Testing Strategy

### Manual Testing Steps:

1. With dev server running and a valid auth session, open the add-application dialog from the "Interesujące" column.
2. Verify the parser button is initially disabled with the source field empty.
3. Type plain text — button stays disabled.
4. Paste a live JJIT URL — button enables. Click and verify a populated, editable form.
5. Paste a live LinkedIn URL with `currentJobId` — click and verify either a successful pre-fill or an amber soft-failure message; in both cases, the manual fields stay usable.
6. Paste `https://example.com/foo` — button stays disabled.
7. Edit the source after a successful parse — verify previously pre-filled fields remain editable and the form submits.
8. Repeat steps 4 and 5 in the "Zaaplikowano" column to confirm activation works regardless of target column.
9. Close and reopen the dialog mid-parse — verify state resets cleanly.

## Performance Considerations

Each parse call performs exactly one outbound HTTPS fetch from the Worker. JJIT pages are typically 100–500 KB compressed; LinkedIn guest fragments are 20–80 KB. With an 8s timeout and no retry, the worst-case latency is bounded by that timeout. No caching is introduced in MVP per Q7.

## Migration Notes

No schema migration in this slice. The `skills` PRD field is satisfied by prepending parsed skills into the description column.

## References

- Research: `context/changes/parser-driven-add/research.md`
- PRD slice: `context/foundation/prd.md` (FR-004, US-01, NFR no low-confidence pre-fill)
- Roadmap entry: `context/foundation/roadmap.md` (S-04)
- Manual-add baseline: `src/components/board/AddApplicationDialog.tsx`, `src/pages/api/applications/index.ts`, `src/lib/validation/applications.ts`
- Card URL contract: `src/components/board/KanbanCard.astro:12-34`
- Schema: `supabase/migrations/20260526123145_applications_schema.sql:13-28`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared URL recognition + parse endpoint scaffold

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — c6c0dc1
- [x] 1.2 TypeScript type-check passes via the build: `npm run build` — c6c0dc1
- [x] 1.3 New files compile and the existing build still succeeds — c6c0dc1

#### Manual

- [x] 1.4 `curl -X POST http://localhost:4321/api/applications/parse` without an auth cookie returns 401. — c6c0dc1
- [x] 1.5 With a valid session cookie, POSTing `{ "source": "" }` returns 422 with a `source` error key. — c6c0dc1
- [x] 1.6 POSTing `{ "source": "https://example.com/foo" }` returns 200 with `status: "unsupported"`. — c6c0dc1
- [x] 1.7 POSTing `{ "source": "https://justjoin.it/job-offer/foo-bar-warsaw-net" }` returns 200 with `status: "empty"` and `result: {}` (parser still stubbed). — c6c0dc1
- [x] 1.8 POSTing `{ "source": "https://www.linkedin.com/jobs/view/4399262456" }` returns 200 with `status: "empty"`. — c6c0dc1
- [x] 1.9 `recognize()` returns `null` for plain strings, `ftp://...`, `http://example.com`, and `https://linkedin.com/feed` (no jobId). — c6c0dc1

### Phase 2: JustJoinIT parser

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — b441a6b
- [x] 2.2 Build succeeds: `npm run build` — b441a6b

#### Manual

- [x] 2.3 POSTing the JJIT reference URL returns 200 with `status: "ok"` and a populated `result` (position, company, description with skills prepended, salary string in `"… – … PLN/mies. (B2B); …"` format, work_mode from the enum). — b441a6b
- [x] 2.4 POSTing a JJIT URL whose slug returns 404 from JJIT returns 200 with `status: "fetch_failed"`. — b441a6b
- [x] 2.5 A JJIT posting that genuinely has no salary still returns `status: "partial"` (no salary key) without failing. — b441a6b
- [x] 2.6 The description HTML is preserved verbatim (paragraph tags, lists, etc.) — no stripping. — b441a6b

### Phase 3: LinkedIn parser

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 727d275
- [x] 3.2 Build succeeds: `npm run build` — 727d275

#### Manual

- [x] 3.3 POSTing the LinkedIn reference URL returns 200 with `status: "ok"` or `status: "partial"` on success days; the `result` contains at minimum a populated `position` and either `company` or `description`. — 727d275
- [x] 3.4 POSTing the canonical authwall URL `/jobs/view/{id}` returns 200 with `status: "fetch_failed"` or `status: "empty"` — never a hard error. — 727d275
- [x] 3.5 The work_mode sniffer returns one of `"Zdalna" | "Hybrydowa" | "Stacjonarna"` or undefined; never an invalid value. — 727d275

### Phase 4: Form integration

#### Automated

- [x] 4.1 Lint passes: `npm run lint` — 0a08491
- [x] 4.2 Build succeeds: `npm run build` — 0a08491

#### Manual

- [x] 4.3 With an empty or non-URL source, the parser button is disabled. — 0a08491
- [x] 4.4 Live JJIT URL pasted → button enables → click pre-fills the form; missing salary or work_mode triggers the amber `"Wypełniono częściowo..."` inline message. — 0a08491
- [x] 4.5 Edits to pre-filled fields persist and the form submits successfully. — 0a08491
- [x] 4.6 LinkedIn URL with `currentJobId` either pre-fills position+company+description or shows the soft-failure message; manual fields remain usable. — 0a08491
- [x] 4.7 Plain text source keeps the button disabled; manual form is fully usable. — 0a08491
- [x] 4.8 Unsupported URL (e.g., `https://pracuj.pl/...`) keeps the button disabled. — 0a08491
- [x] 4.9 Closing and reopening the dialog resets parsing state and inline message. — 0a08491
- [x] 4.10 Submitting a parser-pre-filled form creates the card in the target column with the parsed values. — 0a08491

## Post-merge follow-ups

- 2b9e722 — JJIT schema drift fix + impl-review triage (F1, F2, F4). See commit body.
- d45d704 — JJIT description HTML stripping. Phase 2 originally required the description to be preserved verbatim (see 2.6), but the field renders in a plain `<Textarea>` and tags showed through. Added a small `htmlToPlainText()` helper in `src/lib/parsers/justjoinit.ts` that converts `<br>`, `</p|li|ul|ol|div|hN>` to newlines, `<li>` to `- `, strips remaining tags, decodes common entities (`&amp;`, `&nbsp;`, `&quot;`, `&#39;`/`&apos;`, `&lt;`, `&gt;`, numeric `&#NNN;`), and collapses whitespace. The `</p></li>` pair is short-circuited to a single newline so list items aren't separated by a blank line.
- 142dc93 — LinkedIn description formatting. Symmetric problem to the JJIT fix above, but on the LinkedIn path the structure was already lost upstream: `HTMLRewriter`'s `text()` handler strips all tags before our code sees them, so `<br>`, `<p>`, and `<li>` boundaries inside `.show-more-less-html__markup` collapsed into one unreadable blob (and the "Show more" / "Show less" button labels leaked in, because `.description__text` wraps both the markup and the toggle buttons). Fix in `src/lib/parsers/linkedin.ts`: register `element()` handlers on nested block tags (`p, div, ul, ol, h1–h6`) and on `br`/`li` to inject `\n` / `\n- ` into `descriptionBuf` at the right points, and track an `inSkippable` counter via an `element()` handler on `.show-more-less-html__button` to drop text from inside the toggles. Output is normalised at the end (collapse trailing/leading whitespace around newlines, cap blank runs at one). Required extending `src/lib/parsers/html-rewriter.d.ts` with an optional `element` handler shape (`tagName` + `onEndTag`) — the runtime already supports it, the project's local typings just hadn't declared it.
- _next_ — LinkedIn `work_mode` detection. Reported live: a LinkedIn offer that the user could see tagged "Praca zdalna" in the UI parsed back with `work_mode` unset, leaving the form's work-mode field empty. Two compounding causes in `src/lib/parsers/linkedin.ts`'s `sniffWorkMode` path: (1) the haystack was capped at `description.slice(0, 2048)`, so for offers where the remote/hybrid/onsite signal sits in the trailing "What we offer" section (e.g. job 4416716342, where "Fully remote work environment" appears past char ~3000 of the cleaned description) the regex never saw it; (2) the `remote` check ran _before_ the `hybrid` check, so a hybrid offer mentioning "remote-friendly" would have classified as `Zdalna`. Worth noting why we don't read the explicit workplace-type chip: LinkedIn's `/jobs-guest/jobs/api/jobPosting/{id}` HTML only exposes Seniority / Employment type / Job function / Industries inside `.description__job-criteria-list` — the workplace-type tag the user sees in the logged-in UI is rendered client-side from authenticated data we don't have, so keyword sniffing remains our only deterministic surface. Fix: reorder so `hybrydow|hybrid` is tested first, then `zdaln|remote`, then `stacjonarn|on[-\s]?site|onsite`, and remove the 2048-char slice so the full normalised description is searched. No behaviour change for offers where the signal was already in the first 2 KB.
