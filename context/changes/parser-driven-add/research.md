---
date: 2026-05-29T14:07:26+02:00
researcher: Dawid Nowak
git_commit: b3ff36b0ad78595a1ee25175c437c5c69a418ab9
branch: feature/parser-driven-add
repository: DawidNowak/JobTracker
topic: "How to fetch and parse job postings from LinkedIn and JustJoinIT for the 'Pobierz dane oferty' auto-fill (S-04)"
tags: [research, parser, linkedin, justjoinit, cloudflare-workers, html-rewriter]
status: complete
last_updated: 2026-05-29
last_updated_by: Dawid Nowak
---

# Research: How to fetch and parse applications from LinkedIn and JustJoinIT

**Date**: 2026-05-29T14:07:26+02:00
**Researcher**: Dawid Nowak
**Git Commit**: b3ff36b0ad78595a1ee25175c437c5c69a418ab9
**Branch**: feature/parser-driven-add
**Repository**: DawidNowak/JobTracker

## Research Question

How should the S-04 ("parser-driven add") slice fetch and parse a pasted job-posting URL from LinkedIn and JustJoinIT, given the locked constraints: deterministic only (no LLM at parse time), no paid scraping service, running on the Cloudflare Workers edge runtime (`@astrojs/cloudflare`), and gracefully degrading to manual entry when extraction fails (per FR-004 / NFR)?

Concrete test URLs supplied by the user:
- JJIT: `https://justjoin.it/job-offer/skywise-senior-net-backend-developer-gdansk-net`
- LinkedIn: `https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4399262456`

## Summary

The two portals require **different** fetch + parse strategies, and one of them has a load-bearing surprise that affects planning:

- **JustJoinIT** — high-confidence path. The public JSON REST API (`api.justjoin.it`, `justjoin.it/api/offers`) was **shut down in November 2023**. The current way to read a single offer is to fetch the public HTML page `https://justjoin.it/job-offer/{slug}` and extract the embedded Next.js React Server Components (RSC) flight payload from `<script>self.__next_f.push([1,"..."])</script>` tags. Every PRD form field except `salary` and `skills` maps to a clean JSON path; `salary` requires flattening a multi-row `employment_types[]` array into one string; `skills` is structurally available (`required_skills[]`) but **the database has no column for it** (see Open Questions).
- **LinkedIn** — best-effort path, no guarantees. The canonical `/jobs/view/{id}` URL is an authwall (no JSON-LD, no useful markup). The only viable unauthenticated surface is `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jobId}`, which returns an HTML fragment with `topcard__*` / `description__*` / `show-more-less-html` class hooks. Expect a **30–60% block rate** from Cloudflare Worker egress IPs (LinkedIn aggressively serves HTTP 999 / 429 to datacenter IPs). Salary, skills, and work-mode are mostly absent for Polish-market postings — only title, company, and description are reliably present.
- **Parser runtime** — use the workerd-native `HTMLRewriter` global. Zero dependencies, zero bundle impact, fits the 3 MiB Free-plan compressed Worker limit comfortably. For the JJIT RSC payload, pair `HTMLRewriter` (to collect `<script>` text bodies) with a regex that finds `self.__next_f.push([1,"..."])` chunks and `JSON.parse`s them.

**Recommendation for the `/10x-plan` step**: build the JJIT happy path first (it carries S-04's north-star value reliably), and ship LinkedIn as a parallel best-effort path that returns "could not parse — please fill manually" on failure, fully aligning with PRD FR-004's graceful-fallback contract. Do not add a parser dependency; `HTMLRewriter` + regex covers both portals.

## Detailed Findings

### Integration surface (where the new code hooks in)

The S-02 manual add path shipped on `master` (commit `b3ff36b`) and is the host for this feature.

- Form component: [`src/components/board/AddApplicationDialog.tsx`](src/components/board/AddApplicationDialog.tsx) — plain `useState`, no react-hook-form. Source input is at lines 140–150 (`id="add-application-source"`); submit handler at lines 74–114 POSTs to `/api/applications`. The "Pobierz dane oferty" button + parsing state (`parsing`, `parseError`) attach here.
- Create endpoint: [`src/pages/api/applications/index.ts:30-61`](src/pages/api/applications/index.ts) — POST, Zod-validated, RLS via `auth.uid()` on the session JWT (not service-role). The new parse endpoint should be a sibling: `src/pages/api/applications/parse.ts`, same auth pattern.
- Zod schema: [`src/lib/validation/applications.ts`](src/lib/validation/applications.ts) — `source` is required and untrimmed server-side; client trims before submit. A new `applicationParseSchema` (just `{ source: string }`) is needed for the parse endpoint.
- Card URL detection (FR-018, "Link do oferty"): already shipped — [`src/components/board/KanbanCard.astro:12-34`](src/components/board/KanbanCard.astro) gates the link via `new URL(application.source)` and an `http:`/`https:` protocol check. The parser's URL recognizer should mirror this contract.
- No HTTP fetch helper, no rate-limit utility, no parser dependency, and no test framework exist. Per AGENTS.md the S-04 plan must not scaffold tests.

### LinkedIn

**One-line verdict**: fetch `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jobId}` from the Worker with a browser `User-Agent`; parse class hooks with `HTMLRewriter`; treat non-200 / authwall HTML / empty topcard as a soft failure → manual entry. Expect failure ~30–60% of the time from Worker IPs.

**jobId extraction** — every LinkedIn URL maps to a numeric `jobId`. Surfaces in the wild:

| Pattern | Where jobId lives |
|---|---|
| `/jobs/view/{id}` | path segment |
| `/jobs/view/{slug-with-id-at-end}` | trailing digits in slug |
| `/jobs/collections/recommended/?currentJobId={id}` | `currentJobId` query (user's example) |
| `/jobs/search/?currentJobId={id}` | `currentJobId` query |
| `/comm/jobs/view/{id}` | path segment |
| `/jobs/view/?refId=...&currentJobId={id}` | `currentJobId` query |

Two-step extraction is more robust than one regex:
1. URL-parse → check `searchParams.get('currentJobId')`.
2. Fallback: `pathname.match(/(\d{8,})(?:[/?#]|$)/)`.

`{8,}` future-proofs (current jobIds are 10 digits) and rejects tracking IDs.

**Guest endpoint empirical result** — `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4399262456` (user's example) returns a usable HTML fragment with title, company, location, posted-at, employment type, applicants, description. **No `<script type="application/ld+json">` is emitted.** Parsing must be DOM-class-based. Selector contract (consistent across 2025–2026 community scrapers — Apify, `linkedin-jobs-scraper`, dev.to guides):

- Title: `.top-card-layout__title` (or sometimes `.topcard__title`)
- Company: `.topcard__org-name-link` (anchor) or `.topcard__flavor`
- Location: `.topcard__flavor.topcard__flavor--bullet`
- Description: `.show-more-less-html__markup` (or `.description__text`)
- Criteria list (seniority, employment type): `.description__job-criteria-list .description__job-criteria-text`
- Compensation (rarely present): `.compensation__salary`

**Canonical `/jobs/view/{id}`** — authwall confirmed. No JSON-LD, no `og:title`, no useful markup. Do not attempt this URL.

**Cloudflare Worker egress reality** — LinkedIn returns **HTTP 999 ("Request Denied")** to crawlers from datacenter/cloud IP ranges, including Cloudflare's anycast. Multiple 2025–2026 sources document this:
- LinkedIn Help: "network blocked" for cloud / data-center IP ranges.
- Community reports (openclaw#59849, cf-community 575279/696283): LinkedIn, Indeed, Glassdoor all block VPS IP ranges aggressively.
- Mitigation that works from Workers: realistic browser `User-Agent`, `Accept-Language` header, retries with jitter.
- Mitigation that does **not** defeat IP-reputation blocks (without a paid proxy, which is off the table): user-agent rotation alone, header tweaks alone.

**Field coverage vs PRD requirements** — honest table:

| PRD field | Available from guest endpoint? |
|---|---|
| Position (title) | Yes — reliable |
| Company | Yes — reliable |
| Description | Yes — `show-more-less-html__markup` block, HTML-formatted |
| Skills | No structured field; sometimes prose inside description |
| Salary range | Rarely — `.compensation__salary` is opt-in, US/UK only; Polish postings almost never include it |
| Work mode (Zdalna/Hybrydowa/Stacjonarna) | No structured field; sniff from title + location + first 2 KB of description with `/\b(remote\|zdaln\|hybrid\|hybrydow\|on[-\s]?site\|stacjonarn)\b/i` |

### JustJoinIT

**One-line verdict**: fetch `https://justjoin.it/job-offer/{slug}` from the Worker; use `HTMLRewriter` to collect `<script>` bodies; regex out `self.__next_f.push([1,"..."])` chunks; `JSON.parse` the captured string-literals; locate the offer object containing keys `"title"` and `"workplace_type"`. The legacy public REST API was decommissioned in **November 2023** — `api.justjoin.it/v2/...`, `justjoin.it/api/offers`, and `_next/data/.../job-offer/{slug}.json` all return 404 today.

**URL format** — canonical only: `https://justjoin.it/job-offer/{slug}`. Slug shape: `{company}-{position}-{city}-{tech-tag}`, lowercase, hyphen-separated, ASCII-folded. No legacy `/offers/{slug}` or `/pl/...` localization prefix in current use. Treat slug as permanent for the offer's lifetime.

**Field mapping** — based on the RSC-embedded object (matches the legacy `/api/offers` schema, snake_case):

| PRD form field | JJIT JSON path |
|---|---|
| `position` | `title` |
| `company` | `company_name` |
| `description` | `body` (HTML string) |
| `skills` | `required_skills[]` (array of strings) — **no DB column exists** |
| `salary` (single text column) | derive from `employment_types[]` |
| `work_mode` | `workplace_type` |

Bonus fields available if useful: `experience_level`, `working_time`, `city`, `multilocation[].city`, `apply_url`, `published_at`, `is_offer_active`.

**Work-mode mapping** to the Polish enum:

| `workplace_type` | App enum |
|---|---|
| `remote` | `Zdalna` |
| `hybrid` | `Hybrydowa` |
| `partly_remote` | `Hybrydowa` (legacy alias) |
| `office` | `Stacjonarna` |
| anything else / null | leave empty (do not guess) |

**Salary normalization** — `employment_types` is `[{type, from, to, currency, unit}]`. Algorithm:
1. Filter entries with non-null `from`.
2. Per entry, format `"{from} – {to} {currency}/{unit-abbrev}"`.
3. Map `type` → Polish label: `b2b → B2B`, `permanent → UoP`, `mandate_contract → UZ`, `internship_contract → staż`.
4. Join with `; `.

Example output: `"18 000 – 25 000 PLN/mies. (B2B); 14 000 – 20 000 PLN/mies. (UoP)"`. If no entry has a salary, leave the field empty.

**Description** — `body` is HTML (rich-text editor output: `<p>`, `<ul>`, `<strong>`, etc.). Store as-is — the description column accepts HTML/text per the schema. There is no consistent `bodyEnglish` field in current RSC payloads.

**Anti-bot posture** — JustJoinIT is Cloudflare-fronted but the public page does not currently challenge plain `fetch()` from realistic browser headers. No community reports of JJIT specifically blocking Cloudflare Workers IPs. A polite per-user rate limit on the Worker side (1 fetch / few seconds) is good citizenship and matches the PRD's "user-initiated, not crawled" framing.

### Cloudflare Workers HTML parsing

**One-line verdict**: use the workerd-native `HTMLRewriter` global for both portals; pair with regex for the JJIT RSC payload. **Do not add a parser dependency.**

- `HTMLRewriter` is a runtime global inside `@astrojs/cloudflare` server endpoints — no import, no type-only dep needed. Supports class selectors (`.foo`, `E.foo`), descendant/child combinators, attribute selectors. Streams text in chunks; accumulate via `text(t) { buf += t.text }` and watch `lastInTextNode`.
- Workers compressed-bundle limit: **3 MiB Free / 10 MiB Paid** (not 1 MiB — corrected from earlier claim). Plenty of room, but every dep eats into it.
- Astro 6 removed `Astro.locals.runtime`; `HTMLRewriter` was never on `locals` anyway — it's always been a workerd global.
- `node-html-parser` (~50 KB) is the acceptable fallback if `HTMLRewriter` ergonomics hurt — pure JS, no Node built-ins, bundles cleanly. Not recommended here; the use cases don't need a DOM tree.
- `linkedom` (~200 KB+, may need `nodejs_compat`) and `cheerio` are oversized for the task.
- Regex-only for the JJIT RSC payload is the simplest deterministic primitive: `[...buf.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)/gs)].map(m => JSON.parse(m[1])).join('')` then find the JSON substring containing `"title"` and `"workplace_type"` keys inside the joined Flight string.

## Code References

- `src/components/board/AddApplicationDialog.tsx:74-114` — submit flow; insert parser button + state here
- `src/components/board/AddApplicationDialog.tsx:140-150` — source input, immediate neighbor of the new button
- `src/pages/api/applications/index.ts:30-61` — create-endpoint pattern to mirror in `parse.ts`
- `src/lib/validation/applications.ts:12-21` — Zod schema to add `applicationParseSchema` next to
- `src/components/board/KanbanCard.astro:12-34` — URL detection contract already shipped; mirror it in the parser
- `supabase/migrations/20260526123145_applications_schema.sql:13-28` — schema; note absence of `skills` column

## Architecture Insights

- **Two-tier parsing**: a single API route `/api/applications/parse` accepts `{ source }`, routes by host to a portal-specific extractor module, returns a uniform `{ position?, company?, description?, salary?, work_mode? }` partial. Skills is either dropped or stored elsewhere — decide before planning (see Open Questions).
- **Soft-failure contract** is load-bearing. Every failure mode (unsupported host, non-200 fetch, authwall HTML, empty topcard, malformed RSC) returns 200 with an empty extraction result and a non-blocking message. The client never shows a destructive error; the user just fills fields manually. This is FR-004's "no silent garbage pre-fill" combined with the principle that the parser should never block the S-02 manual path.
- **Per-portal modules with shared shape** — keep `parseLinkedIn(url)` and `parseJustJoinIT(url)` independent. Their fetch+parse logic shares nothing in common; forcing a "BaseParser" abstraction now is premature.
- **URL recognition is two-step**: first a host match (`justjoin.it`, `linkedin.com` / `www.linkedin.com` / `pl.linkedin.com` / `linkedin.com/comm`), then a path/query match producing the parser key (`jjit:{slug}` or `linkedin:{jobId}`). The "Pobierz dane oferty" button activates only when recognition succeeds — exactly as FR-004 specifies.
- **Caching opportunity**: the same job URL re-pasted shouldn't re-fetch. A short server-side cache (Cloudflare KV with a 1-hour TTL keyed by parser key) would also reduce origin load and dampen any retry storms. Optional for MVP; flag for v2 if rate-limits bite.

## Historical Context (from prior changes)

- `context/changes/manual-add-application/plan.md:55` — explicitly defers "Pobierz dane oferty" to S-04. Section 3.2 locks the URL-detection contract (`new URL()` constructor, http/https protocol gate) that the parser's host-match step should reuse.
- `context/changes/manual-add-application/plan.md:80` — fixes the URL recognition rule on the card to no protocol coercion. Mirror it in the parser's activation check.
- `context/changes/manual-add-application/reviews/impl-review-2.md` (F3) — no source-field normalization is applied server-side. The parser must accept the raw user input and do its own trim/parse.
- `context/changes/applications-schema-and-rls/` — defines the schema; the `skills` column gap originates here, not in S-02.

## Related Research

- `context/foundation/prd.md` — FR-004 (parser activation, graceful fallback), NFR (no low-confidence pre-fill), US-01 (acceptance criteria).
- `context/foundation/roadmap.md:111-122` — S-04 framing; the "URL parsing strategy (server-side scrape vs third-party fetch service vs vendor API) is a `/10x-plan` decision" unknown is now resolved by this document: **server-side fetch from the Worker, no third-party service, no vendor API.**
- `context/foundation/tech-stack.md` — confirms Cloudflare Pages target and `has_ai: false` posture that locked the "deterministic only" constraint.

## Open Questions

1. **Skills column** — FR-004 requires the parser to pre-fill "skills," but no `skills` column exists in `applications` (verified via grep across `supabase/migrations/` and `src/`). JJIT exposes `required_skills[]` cleanly; LinkedIn does not. Three resolution paths to choose between at `/10x-plan` time:
   - (a) Add a `skills text` column in this slice (cross-cuts the F-01 schema; requires a migration).
   - (b) Drop `skills` from the parser scope and amend PRD FR-004.
   - (c) Append `required_skills[]` into `description` (e.g., as a "Wymagane umiejętności: …" prefix). Cheapest but conflates fields.
   - Recommendation: (a) — add the column. Skills is named in the PRD success criteria and JJIT carries it for free; appending to description (option c) loses round-trip editability.
2. **URL host whitelist scope** — does `pl.linkedin.com/jobs/...` count? `linkedin.com/comm/jobs/view/...`? The plan should enumerate exactly which hosts the "Pobierz dane oferty" button activates on; the research recommends `*.linkedin.com` (any subdomain) + `justjoin.it` (no subdomain), normalizing both to lowercase.
3. **LinkedIn failure rate budget** — what's the acceptable share of LinkedIn parses that silently degrade to manual? The Primary Success Criterion is "≥80% of applications added via auto-fill," which spans both portals; if LinkedIn's effective auto-fill rate is ~50%, the JJIT path must carry the metric. The plan should call this out explicitly so the metric is interpreted correctly.
4. **Cache** — KV-backed cache (1h TTL keyed by parser key) is straightforward but adds a binding. Worth it for MVP, or v2?
5. **Salary column type** — the schema's single `salary text` column was a deliberate simplification (S-02 history). JJIT's multi-row `employment_types[]` will get flattened into one comma/semicolon-joined string. Confirm this is acceptable, or whether the plan should split into `salary_from`, `salary_to`, `salary_currency`, `salary_contract_type` columns. Recommendation: keep the single text column for MVP — the field is informational, not queryable.
