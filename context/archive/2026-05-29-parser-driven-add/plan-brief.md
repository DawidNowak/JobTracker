# Parser-driven add — Plan Brief

> Full plan: `context/changes/parser-driven-add/plan.md`
> Research: `context/changes/parser-driven-add/research.md`

## What & Why

Ship the S-04 north-star slice: a "Pobierz dane oferty" button on the existing add-application form that pre-fills position, company, description, salary, and work_mode when the user pastes a LinkedIn or JustJoinIT URL. This is the slice the PRD's primary Success Criterion (≥80% of applications added via auto-fill) is measured against — without it, the 4-week MVP ships without its actual learning signal.

## Starting Point

S-02 (manual add) shipped on master (`b3ff36b`). The form, validation schema, create endpoint, and kanban-card URL contract are in place and intentionally shaped to be the parser's hook points. No HTTP fetch helper, no HTML parser dependency, and no `skills` column exist yet.

## Desired End State

When the source field contains a recognized LinkedIn or JustJoinIT URL, a button next to it enables; clicking it pre-fills the form with what the upstream HTML deterministically yields. Parser failure or unsupported URLs leave fields empty and surface a non-blocking inline message — the manual path is never blocked. A JJIT URL reliably pre-fills all five fields; a LinkedIn URL pre-fills position + company + description when the Worker's outbound request isn't blocked.

## Key Decisions Made

| Decision                  | Choice                                                                            | Why                                                                                                                            | Source   |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Fetch + parse strategy    | Worker-side `fetch` + `HTMLRewriter` + regex on JJIT RSC payload                  | Deterministic, no third-party service, zero-dependency, fits Workers compressed-bundle budget.                                 | Research |
| `skills` field resolution | Prepend to description (`"Wymagane umiejętności: …"`)                             | Avoids a schema migration in this slice; round-trip editable enough for MVP; LinkedIn has no structured skills surface anyway. | Plan     |
| URL host whitelist        | `*.linkedin.com` (any subdomain) + exact `justjoin.it`                            | Matches real-world LinkedIn variants (`pl.linkedin.com`, `comm/...`); deterministic jobId extraction bounds risk.              | Plan     |
| JJIT salary normalization | Semicolon-joined, Polish contract labels (B2B, UoP, UZ, staż)                     | Preserves contract-type signal users care about; matches research's recommended format.                                        | Plan     |
| Partial-result UX         | Fill what's present; non-blocking amber inline message above form fields          | Aligns with NFR "no silent garbage pre-fill"; user immediately sees what to complete manually.                                 | Plan     |
| Button activation         | Client + server share `recognize()`; button enabled only when it returns non-null | Honest affordance per FR-004 wording; one source of truth.                                                                     | Plan     |
| Caching                   | None in MVP                                                                       | User-initiated low-frequency action; metric doesn't measure latency; revisit if rate-limits bite.                              | Plan     |
| Request safety            | 8s timeout via `AbortSignal.timeout()`, no rate limit, no body cap                | Small known user base; isolate-local rate limit would be best-effort anyway; KV-backed limit is MVP overkill.                  | Plan     |
| LinkedIn failure rate     | Accept 30–60% Worker-IP block rate; surface soft message                          | No paid proxy; PRD's graceful-fallback contract is load-bearing; JJIT carries the 80% metric.                                  | Research |

## Scope

**In scope:**

- New `src/lib/parsers/` directory: pure `recognize()` utility + two portal parser modules + shared types.
- New `POST /api/applications/parse` endpoint (cookie auth, Zod validation, soft-failure envelope).
- One textbox + one button addition to `AddApplicationDialog.tsx` with parsing state + inline message.
- Skills appended into description prefix when parser provides them (JJIT only).

**Out of scope:**

- No `skills` column migration.
- No KV cache, no per-user rate limit, no response body cap, no retries.
- No third-party scraping service, no headless browser, no paid proxy.
- No portals beyond LinkedIn and JustJoinIT.
- No tests (AGENTS.md hard rule).

## Architecture / Approach

```
AddApplicationDialog.tsx (client)
   │  recognize(form.source)            ← shared pure util
   │  → POST /api/applications/parse
   ▼
src/pages/api/applications/parse.ts     ← auth + Zod + 8s timeout + soft envelope
   │  recognize()  →  parseLinkedIn(jobId)  or  parseJustJoinIT(slug)
   ▼
src/lib/parsers/
   recognize.ts       (pure, isomorphic)
   types.ts           (ParseResult, ParseStatus, ParseEndpointResponse)
   linkedin.ts        (fetch /jobs-guest/jobs/api/jobPosting/{id} + HTMLRewriter)
   justjoinit.ts      (fetch /job-offer/{slug} + HTMLRewriter + regex on Flight chunks)
```

All upstream-fetch failures collapse to `status: "fetch_failed"` and HTTP 200 — the client never sees a transport error. Client and server share `recognize()` so the button's activation rule cannot drift from the server's routing rule.

## Phases at a Glance

| Phase                                               | What it delivers                                                                                                         | Key risk                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| 1. Shared URL recognition + parse endpoint scaffold | `recognize()`, `applicationParseSchema`, `POST /api/applications/parse` with soft-failure envelope, both parsers stubbed | Getting the envelope shape wrong forces rework in both portal parsers + form                                |
| 2. JustJoinIT parser                                | Real JJIT fetch + Flight chunk extraction + field mapping + salary normalization + skills-into-description               | Locating the offer JSON inside concatenated Flight chunks is the one fragile step                           |
| 3. LinkedIn parser                                  | Guest-endpoint fetch + HTMLRewriter selectors + work_mode sniffer                                                        | HTTP 999 / authwall failure rate (~30–60% from Worker IPs); contract is graceful fallback, not high success |
| 4. Form integration                                 | Button + activation predicate + parsing state + partial-fill + inline amber message                                      | Visual polish of the inline message; ensuring state resets between dialog opens                             |

**Prerequisites:** S-02 manual add shipped (✅ commit `b3ff36b` on master). Live JJIT and LinkedIn URLs available for manual testing.
**Estimated effort:** ~2–3 sessions across 4 phases (1 + 2 + 3 + 4; phases 2 and 3 can be parallelized after phase 1).

## Open Risks & Assumptions

- **LinkedIn 999 / authwall block rate from Cloudflare Worker egress IPs is documented at 30–60%.** Acceptable per FR-004 graceful fallback. The 80% auto-fill metric is carried primarily by JJIT.
- **JJIT's Flight payload format is undocumented and could change.** The parser is brittle by nature — research notes the legacy REST API was already shut down in November 2023, so this is the only deterministic surface available without paying for one. Mitigation: any failure resolves to `fetch_failed`, never crashes the form.
- **The work_mode sniffer for LinkedIn uses keyword matching on the prose.** It will be wrong sometimes; PRD NFR explicitly accepts an empty value over a low-confidence guess, so undefined when no keyword matches is the right behavior.
- **Slug stability assumption for JJIT.** Research treats slugs as permanent per offer; an expired/removed slug returns 404 and resolves to `fetch_failed` cleanly.

## Success Criteria (Summary)

- Pasting a live JJIT URL into the source field pre-fills position, company, description (with skills prepended), salary, and work_mode; the user can edit and submit.
- Pasting a live LinkedIn URL with `currentJobId` either pre-fills position + company + description or shows a clear soft-failure message; the manual form is never blocked.
- Pasting plain text, an unsupported portal URL, or an authwall LinkedIn URL leaves the form usable and either keeps the button disabled or shows an amber inline message — never a hard error.
