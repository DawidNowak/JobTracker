---
date: 2026-06-18T14:00:00+02:00
researcher: Dawid Nowak
git_commit: 470d985a4542ec40ea76cd3d0aab55ab4397055c
branch: master
repository: DawidNowak/JobTracker
topic: "Risk #1 (parser silently saves wrong fields) and Risk #4 (recognize() / outbound abuse surface) from context/foundation/test-plan.md — test rollout Phase 2"
tags: [research, parser, linkedin, justjoinit, recognize, ssrf, test-plan-phase-2]
status: complete
last_updated: 2026-06-18
last_updated_by: Dawid Nowak
---

# Research: Parser correctness + abuse surface (test-plan Phase 2, Risks #1 + #4)

**Date**: 2026-06-18T14:00:00+02:00
**Researcher**: Dawid Nowak
**Git Commit**: 470d985a4542ec40ea76cd3d0aab55ab4397055c
**Branch**: master
**Repository**: DawidNowak/JobTracker

## Research Question

Two risks from `context/foundation/test-plan.md` §2 — to be addressed jointly because they share the same code surface (`/api/applications/parse` + `src/lib/parsers/*`) and Phase 2 of the rollout (§3) packages them together:

- **Risk #1** — *Parser silently saves wrong fields to a card. Portal HTML drifts; `/api/applications/parse` returns plausible but incorrect position/company/description and the user accepts it without noticing.*
- **Risk #4** — *`/api/applications/parse` issues fetch to a non-portal URL (SSRF / abuse). `recognize()` allowlist gap lets an authenticated user coerce the Worker to GET internal Cloudflare metadata, follow redirect chains, or hammer arbitrary hosts.*

For each, the goal of this research is to ground the future `/10x-plan` in concrete code: what the current implementation actually does, where the failure modes live, what evidence Phase 2 tests will have to assert, and what defensive gaps the planner can choose to close (or explicitly leave open).

## Summary

The parser surface is small, self-contained, and already hardened against most of the obvious SSRF shapes — but its **silent-drift surface is broad and entirely untested today**. The status-classification logic in `parse.ts` is the load-bearing contract that decides whether the form pre-fills, shows a partial banner, or stays blank, and the parsers themselves carry two history-proven failure modes (LinkedIn description blob, JJIT marker-key schema drift) that have already shipped wrong-data bugs that humans only caught visually. There are zero parser tests and zero captured HTML fixtures in the repo.

Concrete shape Phase 2 should land:

1. **Risk #1 (silent drift) — pure unit tests over captured HTML fixtures, one per portal.** The status branches in `parse.ts:37-43` are easy to test with synthetic `ParseResult` inputs, but the *parsers themselves* need real captured HTML to give honest signal — every past bug (LinkedIn description tag-collapse, the "Show more" leak, JJIT `workplace_type` → `workplaceType` rename, JJIT body `$<ref>` flight encoding) was a shape-of-payload bug invisible to synthetic input. Oracle for assertions is the visible job page, not the parser output — re-asserting `result.position === "X"` after reading what the parser returned is a tautology and violates the test-plan §2 anti-pattern for Risk #1.
2. **Risk #4 (outbound abuse) — endpoint-level tests with `fetch` stubbed at `globalThis`.** The cleanest assertion ("zero outbound calls on disallowed inputs") fires before `HTMLRewriter` is ever touched, which sidesteps the Node-vs-workerd gap (the parsers themselves can't run under the project's current `node`-environment Vitest because `HTMLRewriter` is a workerd global; see §"Constraints" below). For positive recognize() coverage, a table-of-URLs unit test on `recognize()` alone is sufficient.

Three defensive gaps surface as planner inputs, none currently exploitable:

- The two parsers do not set `redirect: "manual"` on their `fetch` calls (Workers default is `"follow"`). The recognize() allowlist + hard-coded outbound URLs means a redirect destination is upstream-controlled, not user-controlled — but a future LinkedIn or JJIT redirect to an internal-looking host would still be followed without challenge.
- The JJIT URL interpolation `https://justjoin.it/job-offer/${slug}` does not wrap the slug in `encodeURIComponent` (linkedin.ts does). It is currently safe because `recognize()` constrains slug to `^[a-z0-9-]+$`, but the safety depends entirely on that regex never loosening.
- No defence-in-depth re-validation between `recognize()` and the parser-internal fetch. `recognize()` is the only gate.

The first prior impl-review already narrowed one allowlist gap (F3 in `context/changes/parser-driven-add/reviews/impl-review.md`): suffix-match on `*.linkedin.com` was replaced with explicit equality on three hosts. Phase 2's tests should *lock in* that narrowing as a regression guard.

## Detailed Findings

### Risk #1 — silent field drift

#### A. The status-branch contract (the single API surface the dialog trusts)

`src/pages/api/applications/parse.ts:33-43` is the entire classification logic:

```ts
function countDefined(result: ParseResult): number {
  return (Object.keys(result) as (keyof ParseResult)[]).filter((k) => result[k] !== undefined).length;
}

function resolveStatus(result: ParseResult, kind: "linkedin" | "jjit"): ParseStatus {
  const populated = countDefined(result);
  if (populated === 0) return "empty";
  const expected = EXPECTED_KEYS[kind];
  const missingExpected = expected.some((k) => result[k] === undefined);
  return missingExpected ? "partial" : "ok";
}
```

Per-portal "expected set" at `parse.ts:28-31`:

- **LinkedIn**: `position`, `company`, `description` (salary + work_mode treated as best-effort — their absence is **not** "partial").
- **JJIT**: `position`, `company`, `description`, `salary`, `work_mode` (skills do not exist as a separate key — they are prepended into `description`).

`ParseStatus` enum at `src/lib/parsers/types.ts:11`:
```
"ok" | "partial" | "empty" | "unsupported" | "fetch_failed"
```

Failure modes collapse to non-`ok` envelope (`parse.ts:65-92`):

| Cause | Status | HTTP |
|---|---|---|
| `recognize()` returns null | `unsupported` | 200 |
| Parser throws (any reason — network, non-200, malformed HTML, missing offer, JSON.parse fail) | `fetch_failed` | 200 |
| Parser returns `{}` (no fields populated) | `empty` | 200 |
| Parser returns ≥1 field but at least one expected key missing | `partial` | 200 |
| All expected keys populated | `ok` | 200 |
| No auth | — | 401 (`parse.ts:46-49`) |
| Body not JSON | — | 400 (`parse.ts:52-56`) |
| Zod fail | — | 422 (`parse.ts:58-61`) |

**The Risk #1 anti-pattern from the test plan ("If `position` is non-empty, the whole result is trustworthy") would manifest here.** A future change to `resolveStatus` that treated "any field populated" as `ok` would silently turn partial → ok and the dialog would suppress its amber banner. A unit test over `resolveStatus` with synthetic `ParseResult` inputs locks the matrix.

#### B. What the dialog does with each status

`src/components/board/AddApplicationDialog.tsx:84-114` (the `handleParse` callback):

- For each non-undefined key in `result`, it calls `update(key, value)` — which **overwrites** whatever the user had typed (no merge, no diff). Comment in the plan body confirms this is intentional ("the button is an explicit user action").
- It stores `payload.status` and `payload.message` in local state.
- The amber banner above the form renders `parseMessage` **iff `parseStatus !== "ok"`** (line 175): on success the populated fields speak for themselves; on partial/empty/unsupported/fetch_failed the user is told to fill in manually.
- The "Pobierz dane oferty" button gates on `recognize(form.source.trim()) !== null && !parsing` (line 82) — exactly the same `recognize()` import the server uses, so the client cannot show the button without the server agreeing it's a parseable URL. The server never trusts the client.

**Test-plan §6.3 already covers HTTP-shape testing for parse.ts.** What it does not yet have is parser-output-shape testing (Risk #1's actual target).

#### C. LinkedIn parser — fields, sniffer, and history of silent-drift bugs

`src/lib/parsers/linkedin.ts`. Fetches `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jobId}` (line 32) and streams the response through `HTMLRewriter` (lines 51-101). Field extraction:

- `position` — `.top-card-layout__title, .topcard__title` (line 52). **Required**: if empty after streaming, the parser throws (line 105), which collapses to `fetch_failed`. This is the only "hard" field.
- `company` — first non-empty of `.topcard__org-name-link, .topcard__flavor` (lines 57-61).
- `location` — `.topcard__flavor.topcard__flavor--bullet` (lines 62-66). Held locally as work-mode-sniffer input; not returned.
- `description` — `.show-more-less-html__markup, .description__text` (lines 67-71), with **two complications** that the post-merge follow-ups in `context/changes/parser-driven-add/plan.md:430` document:
  1. `HTMLRewriter`'s `text()` handler strips tags before user code sees them, so block boundaries must be re-injected via `element()` handlers on `br`, `li`, and nested block tags (lines 80-94). Without these, the description rendered as one unreadable blob.
  2. The "Show more" / "Show less" `<button>` is a child of `.description__text`, so its text leaked into the description until the `inSkippable` counter (lines 72-79) was added.
- `salary` — `.compensation__salary` (lines 95-99). Rarely present for Polish postings.
- `work_mode` — sniffed from `position + " " + location + " " + description` haystack via `sniffWorkMode()` (lines 7-13). **History-proven bug** (plan.md:431, "_next_" follow-up): the original implementation `slice(0, 2048)`d the description (missed work-mode signal past ~2 KB) and tested `remote` before `hybrid` (so "remote-friendly" hybrid postings classified as `Zdalna`). Fix shipped — order is now `hybrydow|hybrid`, then `zdaln|remote`, then `stacjonarn|on[-\s]?site|onsite`, and the full description is searched. This bug is the canonical Risk #1 example: every field above was "populated", `status` was `ok`, the dialog stayed silent, and the user accepted a wrong `work_mode` value.

`normalizeDescription()` (lines 23-29) cleans up whitespace post-extraction.

#### D. JJIT parser — Flight extraction, marker-key schema drift, HTML-to-text

`src/lib/parsers/justjoinit.ts`. Fetches `https://justjoin.it/job-offer/${slug}` (line 222 — note: no `encodeURIComponent`, see §Risk #4 below) and pulls the React Server Components Flight payload out of `self.__next_f.push([1, "..."])` chunks (lines 247-256). Field extraction depends on locating the **offer object** — a JSON sub-string inside the concatenated Flight buffer.

Marker-key strategy (lines 188-219):
- The marker key is `"workplaceType"` (camelCase). **History-proven bug** (`plan.md:428`, commit `2b9e722`): the original implementation searched for `"workplace_type"` (snake_case, matching the old REST schema). JJIT renamed the key in late May 2026 and every JJIT parse silently returned `fetch_failed`. The fix in `2b9e722` not only changed the key — it also restructured the search to **try multiple candidates** (`MAX_OFFER_CANDIDATES = 8`, line 8) before giving up, because a benign instance of the key might appear in a non-offer object first.
- String-aware brace matching (`sliceObjectAround`, lines 135-186) walks backward to find the enclosing `{` and forward to find the matching `}`, tracking string-literal state so that `{`/`}` characters inside the HTML body don't mis-close the slice.
- Validates the slice contains both `"title"` and `"companyName"` before attempting `JSON.parse` (line 211).
- Fails closed: throws on any inconsistency → `fetch_failed`.

Field mapping (lines 264-301):
- `position ← offer.title`
- `company ← offer.companyName` (note: also camelCase post-drift — the field was `company_name` in the legacy schema)
- `description ← htmlToPlainText(resolveTextRef(flight, offer.body))` — `offer.body` is a **Flight text reference** of the form `$<hex>` (line 273), resolved against the joined Flight buffer (`resolveTextRef`, lines 98-109). The plan.md post-merge entry `d45d704` documents that the description was originally returned as HTML and re-rendered as `<p>...</p>` inside the Textarea — the fix added `htmlToPlainText()` (lines 121-133) which collapses tags, decodes entities, and preserves list/paragraph boundaries.
- `salary ← formatSalary(offer.employmentTypes)` (lines 57-78, called at 295). Multi-row salary table with mixed contract types (B2B, UoP, UZ, staż); contract labels mapped via `CONTRACT_LABELS` (lines 10-18). Two shape variants both handled (modern flat `from/to/currency/unit`, legacy nested `salary: { from, to, currency }` — lines 26-32).
- `work_mode ← mapWorkplaceType(offer.workplaceType)` (lines 80-93). Accepts both shape variants of `workplaceType` (plain string or `{ label, value }` object — also captured by the schema-drift fix).
- `description` prepends `"Wymagane umiejętności: ..."` from `offer.requiredSkills` (lines 277-290).

Buffer caps (lines 7, 243-245, 258-260): `MAX_BUFFER_CHARS = 4_000_000` for both `scriptBuffer` and the joined Flight buffer. Originally added per impl-review F4.

#### E. The oracle problem — what tests should assert against

The test-plan §2 anti-pattern for Risk #1 is explicit: **"writing assertions by re-reading what the parser currently returns instead of from the independent source (the visible job page). Snapshot-against-self is a tautology."**

This rules out:
- ❌ `expect(result).toMatchSnapshot()` style tests against the captured HTML — the snapshot is just "whatever the parser currently does."
- ❌ Generating expected values by running the parser once and freezing the output.

What it does allow:
- ✅ Capture a real HTML payload (LinkedIn guest endpoint response, JJIT job page). Read the rendered job page in a browser. Type the expected `position`, `company`, salient lines from `description`, `salary`, `work_mode` **by hand** into the test file. Assert against those.
- ✅ One happy fixture per portal as the baseline. One or two "field-missing" fixtures (e.g., a JJIT posting with no salary entries; a LinkedIn posting with no `.compensation__salary` div) that prove `undefined` (not `""`, not a default) for the missing field.
- ✅ One "deliberately corrupted" fixture per portal (e.g., LinkedIn HTML with `.topcard__title` missing → must throw → endpoint maps to `fetch_failed`; JJIT Flight with no `"workplaceType"` → throws → `fetch_failed`).

These fixtures are the only honest signal Phase 2 can land for Risk #1. They are also brittle by nature — a portal HTML change will red them, which **is** the signal Risk #4 from the test plan calls out as a possible scheduled-canary candidate (test-plan §5, last row: "Parser HTML drift canary (scheduled), optional, after §3 Phase 4"). Phase 2 plants the fixtures; Phase 4 may run them on a cron against live URLs.

#### F. Current test coverage of the parser surface — **zero**

Confirmed by repo-wide search:
- No `tests/**/*parser*`, no `tests/**/*linkedin*`, no `tests/**/*justjoin*`, no `tests/**/*recognize*`, no `tests/**/*parse*`.
- No `.html` fixtures in the repo outside `node_modules`.
- No `fetch` mock helpers, no `nock`/`msw`/`undici-mock-agent` in `package.json` devDeps.
- HTTP smoke (`tests/http/post-applications.test.ts`, `patch-applications.test.ts`) exercises `POST /api/applications` and `PATCH /api/applications/[id]` — it does **not** exercise `POST /api/applications/parse`. Phase 2 will be the first test to hit that endpoint.

### Risk #4 — recognize() / outbound abuse surface

#### A. The allowlist as a set of mutually exclusive branches

`src/lib/parsers/recognize.ts`. Preconditions before any non-null return:
- Trimmed input non-empty (line 6).
- `new URL(trimmed)` succeeds (lines 8-12). No base URL — must be absolute.
- `url.protocol` is exactly `http:` or `https:` (line 14). Rejects `javascript:`, `data:`, `file:`, `gopher:`, `ftp:`, etc.
- `url.hostname.toLowerCase()` is matched (line 16).

Non-null branches:

| # | kind | Host (exact, lowercased) | Path / query shape | Extracted |
|---|---|---|---|---|
| A | `linkedin` | `linkedin.com` ∨ `www.linkedin.com` ∨ `pl.linkedin.com` (line 18) | `?currentJobId=` matches `/^\d{8,}$/` (lines 19-22) | `jobId` (digits-only) |
| B | `linkedin` | same host set | pathname matches `/(\d{8,})(?:[/?#]|$)/` (lines 23-26) | `jobId` (digits-only) |
| C | `jjit` | `justjoin.it` exactly (line 30) | pathname matches `/^\/job-offer\/([a-z0-9-]+)\/?$/` (line 31) | `slug` (lowercase + digits + hyphen only) |

Everything else returns `null` → `unsupported` status, no fetch.

The current state is the **post-F3** allowlist. The pre-F3 version (commit before `2b9e722`'s adjacent changes) used `host === "linkedin.com" || host.endsWith(".linkedin.com")` — an arbitrary-subdomain allowlist. The fix to explicit three-host equality is the documented security narrowing (`context/changes/parser-driven-add/reviews/impl-review.md` F3, decision: FIXED). Phase 2 test work should turn this into a regression test (a `recognize()` table with `evil.linkedin.com`, `attacker.com.linkedin.com`, etc. all returning `null`).

#### B. Bypass-attempt enumeration

For each shape commonly tried against URL allowlists, the verdict and the line that decides it:

| Shape | Verdict | Why |
|---|---|---|
| Trailing dot host (`linkedin.com.`) | SAFE | `url.hostname` preserves trailing dot; `"linkedin.com." === "linkedin.com"` is false (line 18) → null |
| Mixed case (`LinkedIn.COM`) | SAFE | `.toLowerCase()` on line 16 normalizes |
| Userinfo (`https://www.linkedin.com@evil.com/...`) | SAFE | WHATWG `URL` puts `evil.com` in `hostname` |
| Port-prefix tricks (`https://www.linkedin.com:80@evil.com`) | SAFE | Same — `hostname` is `evil.com` |
| Explicit port on allowed host (`https://www.linkedin.com:8080/...`) | SAFE | Passes `recognize()` but parsers ignore the original URL — they build outbound URLs from extracted id only (linkedin.ts:32, justjoinit.ts:222), so the port is dropped |
| IDN / punycode look-alike (`linkedın.com`, dotless-i) | SAFE | WHATWG `URL` converts to punycode (`xn--linkedn-...`) which fails the equality check |
| Subdomain confusion (`linkedin.com.evil.com`, `evil-linkedin.com`) | SAFE | Equality is exact, not suffix |
| Other LinkedIn locales (`uk.linkedin.com`, `business.linkedin.com`) | INTENTIONALLY BLOCKED | Three-host allowlist (line 18) excludes everything else; this is the F3 narrowing |
| `www.justjoin.it` | INTENTIONALLY BLOCKED | Line 30 requires bare `justjoin.it` |
| JJIT path with extra segments | BLOCKED | Anchored regex `^...\/?$` (line 31) |
| `javascript:` / `data:` / `file:` / `gopher:` | SAFE | Protocol allowlist (line 14) |
| `http:` LinkedIn (downgrade) | SAFE | `recognize()` accepts it, parsers force `https://` literally (linkedin.ts:32, justjoinit.ts:222) — no plaintext outbound |

No input shape I could construct passes `recognize()` and causes a `fetch()` to a host other than `www.linkedin.com` or `justjoin.it`.

#### C. URL-on-the-wire vs URL-from-input — id sanitization

After `recognize()` returns, the original URL is **discarded**. The parsers receive only the extracted `jobId` (LinkedIn) or `slug` (JJIT) and rebuild the outbound URL from a string literal:

- **LinkedIn** (`linkedin.ts:32`): `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${encodeURIComponent(jobId)}`. `jobId` is constrained by `recognize.ts:20` or `recognize.ts:23` to `\d{8,}`, so `encodeURIComponent` is belt-and-suspenders. SAFE.
- **JJIT** (`justjoinit.ts:222`): `https://justjoin.it/job-offer/${slug}` — **no `encodeURIComponent`**. SAFE as long as the regex `^/job-offer/([a-z0-9-]+)/?$` (recognize.ts:31) holds — that character class excludes `/ ? # @ : .` and uppercase. **LATENT GAP**: if anyone ever loosens the slug regex (to support, say, JJIT slugs with unicode), the lack of `encodeURIComponent` becomes exploitable for path injection. Cheap fix; cheap test (a `recognize()` mutation could be a unit-test fixture that asserts the slug shape).

#### D. Redirect handling — **GAP at the code level**

Neither parser sets `redirect: "manual"` or `redirect: "error"`. Workers' `fetch` default is `redirect: "follow"` (up to 20 hops):

- `linkedin.ts:33-39` — no `redirect` option.
- `justjoinit.ts:223-229` — no `redirect` option.
- Neither parser inspects `response.url` post-fetch to confirm it still resolves to the expected host.

This is not a current exploit — both endpoints (`www.linkedin.com/jobs-guest/...` and `justjoin.it/job-offer/...`) are public surfaces that don't redirect to user-controlled hosts in practice. But it's an unstated defence-in-depth dependency on upstream behaviour. Two planner options:

- Set `redirect: "manual"` and treat any 3xx as a thrown error → `fetch_failed`. Cheap, opinionated, makes the test for "no outbound to internal hosts" pass even under a hypothetical malicious upstream redirect. Risk: a legitimate upstream redirect (e.g. JJIT moves the `/job-offer/` route) becomes a hard failure.
- Set `redirect: "follow"` (explicit) and post-fetch validate `new URL(response.url).hostname` against the expected literal. More flexible; one extra assertion.

Either is testable via `fetch` stub: install a stub that returns a 302 to `http://169.254.169.254/...` and assert the parser throws.

#### E. No re-check between recognize() and fetch()

`src/pages/api/applications/parse.ts:63-79`:

```ts
const trimmed = parsed.data.source.trim();
const recognized = recognize(trimmed);
if (!recognized) { /* unsupported */ }
// ...
const result = recognized.kind === "linkedin"
  ? await parseLinkedIn(recognized.jobId)
  : await parseJustJoinIT(recognized.slug);
```

`recognize()` is the **only** gate. The endpoint does not re-validate `recognized.jobId` against `/^\d{8,}$/` nor `recognized.slug` against `/^[a-z0-9-]+$/` before delegating. The parsers themselves do not re-validate either. The safety depends entirely on `recognize()` being correct. This is **fine for a single gate** but means a single-line regression in `recognize()` removes the entire SSRF defence. A defence-in-depth re-check inside each parser (cheap — `if (!/^\d{8,}$/.test(jobId)) throw new Error(...)`) is the planner's call.

#### F. fetch interception surface for Phase 2 tests

`fetch` is used as the **global** in both parsers (no module import, no DI seam). This means:

- `vi.spyOn(globalThis, "fetch")` works in the test process (Vitest `environment: "node"`, Node 18+ has native `fetch`). Confirmed by inspecting `vitest.config.ts:11`.
- For **endpoint-level tests** ("when source is `https://example.com/foo`, `fetch` is never called"), the spy can sit at the top of the test and the assertion is `expect(fetch).not.toHaveBeenCalled()`. The early `unsupported` return at `parse.ts:65-72` short-circuits before the parser runs, so `HTMLRewriter` is never touched. **This is the cleanest seam for Risk #4 tests.**
- For **parser-level fixture tests** (Risk #1), stubbing `fetch` to return a captured HTML `Response` runs into a real problem: `HTMLRewriter` is a workerd-runtime global, declared as ambient in `src/lib/parsers/html-rewriter.d.ts:22` but **not present in the Node test environment**. Calling `parseLinkedIn()` directly under Vitest will `ReferenceError` the moment `new HTMLRewriter()` runs (linkedin.ts:51, justjoinit.ts:235). Two paths the planner can choose between:
  - **(a) Workers-runtime Vitest pool** — add `@cloudflare/vitest-pool-workers` and isolate the parser unit tests under it. Heavier; clean ergonomics; matches what production actually does.
  - **(b) Test the parsers through the HTTP endpoint** — let `astro dev` (already wired by `tests/global-setup.ts` for Phase 3) instantiate `HTMLRewriter` natively under `@astrojs/cloudflare` dev mode, and stub upstream `fetch` from inside the test process. Risk: `fetch` stubbing across processes is harder; might need to inject fixtures via a temp `tests/fixtures/` endpoint or rely on the dev server's `fetch` being the same Node `fetch` (requires verification — Astro dev under `@astrojs/cloudflare` uses workerd's `fetch`, not Node's).
  - Quietly recommend (a) for Phase 2: it isolates parser tests cleanly and avoids the cross-process stubbing dance. Confirm `@cloudflare/vitest-pool-workers` plays with `@astrojs/cloudflare` v13.5 first.

#### G. Existing test scaffolding Phase 2 can reuse

Phase 1 (`testing-bootstrap-and-data-isolation`) and Phase 3 (HTTP smoke) shipped real infrastructure (`tests/README.md`, `tests/global-setup.ts`, `tests/setup.ts`, `tests/helpers/{supabase-clients,users,cookies}.ts`). What's directly usable by Phase 2:

- **`tests/helpers/users.ts`** + **`tests/helpers/cookies.ts`** — for endpoint-level Risk #4 tests that need an authenticated session against `POST /api/applications/parse`.
- **`tests/global-setup.ts:73-99`** — already spawns `astro dev` and sets `process.env.TEST_BASE_URL`. The Risk #4 endpoint test can fetch `${BASE}/api/applications/parse` exactly like `tests/http/post-applications.test.ts` does today.
- **`tests/helpers/supabase-clients.ts`** + the ephemeral-user pattern — for any test that needs to confirm "after a successful parse, the form persists what the parser returned" (probably **out of scope** for Phase 2; would belong to a future end-to-end pass).

What does **not** exist yet and must be added by Phase 2:
- `tests/fixtures/parsers/` — captured HTML payloads (LinkedIn guest fragment + JJIT page) plus a `README.md` documenting the capture procedure (`curl -A "<UA>" <url> > linkedin-<jobId>.html`).
- Either `@cloudflare/vitest-pool-workers` (path a above) or an `astro dev` HTTP-only pattern for parser tests (path b).
- A `fetch` stub helper (`tests/helpers/fetch.ts`?) for the SSRF assertions. Could be as small as a `withFetchStub(handler, fn)` wrapper around `vi.stubGlobal("fetch", ...)` + `vi.unstubAllGlobals()`.

## Code References

- `src/pages/api/applications/parse.ts:28-43` — `EXPECTED_KEYS` per portal + `countDefined` + `resolveStatus`: the entire status-classification logic.
- `src/pages/api/applications/parse.ts:45-93` — request envelope: auth → JSON parse → Zod → recognize → dispatch → status response.
- `src/lib/parsers/types.ts:11` — `ParseStatus` enum (`"ok" | "partial" | "empty" | "unsupported" | "fetch_failed"`).
- `src/lib/parsers/recognize.ts:14` — protocol allowlist.
- `src/lib/parsers/recognize.ts:18` — LinkedIn host equality (post-F3 narrowing).
- `src/lib/parsers/recognize.ts:19-26` — LinkedIn jobId extraction (query then pathname fallback).
- `src/lib/parsers/recognize.ts:30-36` — JJIT host + slug-regex match.
- `src/lib/parsers/linkedin.ts:7-13` — `sniffWorkMode` (post-fix order: hybrid first, then remote, then onsite).
- `src/lib/parsers/linkedin.ts:32-39` — outbound `fetch`, no `redirect` option, 8 s `AbortSignal.timeout`.
- `src/lib/parsers/linkedin.ts:51-101` — `HTMLRewriter` selector chain + the `inSkippable` counter for "Show more" / "Show less" buttons.
- `src/lib/parsers/linkedin.ts:103-121` — final field assembly; throws on empty topcard.
- `src/lib/parsers/justjoinit.ts:7-8` — buffer caps (`MAX_BUFFER_CHARS`, `MAX_OFFER_CANDIDATES`).
- `src/lib/parsers/justjoinit.ts:98-109` — Flight `$<hex>` text-reference resolution (the JJIT body decoder).
- `src/lib/parsers/justjoinit.ts:121-133` — `htmlToPlainText` (post-`d45d704` fix).
- `src/lib/parsers/justjoinit.ts:135-186` — `sliceObjectAround` (string-aware brace matching).
- `src/lib/parsers/justjoinit.ts:188-219` — `extractOfferObject` (candidate-loop, marker = `"workplaceType"`).
- `src/lib/parsers/justjoinit.ts:222-229` — outbound `fetch`, no `encodeURIComponent` on `slug`, no `redirect` option.
- `src/lib/parsers/justjoinit.ts:262-301` — field mapping (title → position, companyName → company, body → description, employmentTypes → salary, workplaceType → work_mode, requiredSkills → prepended to description).
- `src/lib/parsers/html-rewriter.d.ts:22` — ambient `HTMLRewriter` declaration (workerd-only, not present in Node test env).
- `src/components/board/AddApplicationDialog.tsx:82` — client-side `recognize()` gate on the parse button.
- `src/components/board/AddApplicationDialog.tsx:84-114` — `handleParse`: overwrites form fields with defined keys from `result`; stores status/message.
- `src/components/board/AddApplicationDialog.tsx:175` — banner renders only when `parseStatus !== "ok"`.
- `src/lib/validation/applications.ts:43-45` — `applicationParseSchema` (`source: z.string().min(1)`, no max).
- `tests/global-setup.ts:73-99` — `.dev.vars` swap + `astro dev` spawn + `TEST_BASE_URL`.
- `tests/helpers/cookies.ts:8-36` — `signInAndCaptureCookies` (for any authenticated parse-endpoint test).
- `vitest.config.ts:11` — `environment: "node"` (the constraint that blocks running `HTMLRewriter` in-process).

## Architecture Insights

- **`recognize()` is the single security boundary.** The current architecture pushes the entire SSRF defence into one ~36-line pure function, deliberately. The parsers do not re-validate. This is a sound design (single source of truth, easy to audit) but it amplifies the impact of any regression to `recognize.ts`. A `recognize()` test table is therefore very high signal-to-cost — it's the smallest possible piece of code with the biggest possible blast radius.
- **The status envelope is a contract the dialog already depends on.** `AddApplicationDialog.tsx` is the only consumer of `ParseEndpointResponse` (confirmed by grep). Changing `resolveStatus` shape would silently change UX. A unit test on `resolveStatus` is the cheapest way to lock the contract; a small integration test on the endpoint (with a stubbed parser) is the next-cheapest.
- **Parsers fail-closed by design.** Every error path collapses to `fetch_failed` with an empty result. This is what makes the "endpoint returns 200 even on failure" architecture safe — the worst case is the user fills the form manually. Tests should preserve this invariant by asserting status codes, not by parsing the response body shape.
- **`HTMLRewriter` is the implicit reason Vitest + Astro is hard for parsers.** The decision to use the workerd-native primitive (over `node-html-parser` or `cheerio` — see `parser-driven-add/research.md:142-152`) was the right runtime/bundle-size call but it's the load-bearing reason parser unit tests need either a Workers-runtime pool or a running dev server. The planner should call this out explicitly.
- **Phase 2 risks "test what the parser does, not what the page says" if it's not careful.** This is the most important architecture decision the planner makes. The fixture-vs-snapshot framing matters more than the runner choice.

## Historical Context (from prior changes)

- `context/changes/parser-driven-add/change.md:14` — already records F3 (SSRF allowlist narrowing) as FIXED in the cleanup pass. Phase 2 inherits a post-F3 codebase.
- `context/changes/parser-driven-add/research.md:84-89` — documents the Cloudflare Worker egress reality (LinkedIn returns HTTP 999 to datacenter IPs 30–60% of the time). This is the reason "happy path" tests against live LinkedIn URLs are flaky and were not part of MVP. A captured-fixture test sidesteps this entirely.
- `context/changes/parser-driven-add/research.md:103-106` — JJIT REST API was decommissioned Nov 2023; the Flight-payload extraction is the only path. The marker-key drift (snake_case → camelCase) is exactly the kind of upstream change a scheduled drift canary (test-plan §5 last row) would catch.
- `context/changes/parser-driven-add/plan.md:175-186` — Phase 2's brace-walk algorithm is documented in plan body (now superseded by the candidate-loop fix; plan.md:173 has a forward pointer). Useful for understanding why the parser's failure mode is "throws on any inconsistency" — every step short-circuits to `fetch_failed`.
- `context/changes/parser-driven-add/plan.md:430-431` — the LinkedIn description tag-collapse fix (`142dc93`) and work-mode sniffer fix (`_next_`) — both Risk #1 silent-drift bugs that shipped to users and were only caught by humans noticing wrong values in the form. Excellent evidence that a real-HTML fixture suite is justified.
- `context/changes/parser-driven-add/reviews/impl-review.md` F3, F4, F5 — already-considered SSRF / DoS / resource-leak surfaces. F3 fixed (allowlist), F4 fixed (buffer caps), F5 skipped (theoretical). Phase 2 tests should treat F3 + F4 as regression-guard targets, not new findings.
- `context/changes/testing-bootstrap-and-data-isolation/` — Phase 1; established the helper conventions Phase 2 inherits (every client is fresh per test, `persistSession: false`, ephemeral users, assert at the row level).
- `context/foundation/test-plan.md` §6.2 + §6.3 — cookbook patterns for integration and HTTP tests; the Risk #4 endpoint test will look exactly like a §6.3 HTTP test plus a `vi.stubGlobal("fetch", ...)` block.

## Related Research

- `context/changes/parser-driven-add/research.md` — the original deep dive into LinkedIn + JJIT scraping. Still the authoritative source on portal-side behaviour and field mappings.
- `context/foundation/test-plan.md` §2 (Risk #1 + #4 response guidance), §3 Phase 2, §5 (parser HTML fixture suite + drift canary), §6 cookbook patterns.

## Open Questions

These are the decisions `/10x-plan` for this change will need to make explicit. None of them is a blocker for research; all are tradeoff calls the planner should not make implicitly.

1. **Vitest runner for parser unit tests** — `@cloudflare/vitest-pool-workers` for in-process parser tests, OR test parsers only via `astro dev` + `fetch` stub at the dev-server level? The former is cleaner ergonomically; the latter avoids adding a new runner. **Recommendation: pool-workers if it cohabits with `@astrojs/cloudflare` v13.5; otherwise endpoint-only.**
2. **Fixture capture procedure** — manual `curl` once per portal, committed under `tests/fixtures/parsers/` with a `README.md` documenting "captured 2026-06-18 via `curl -A '...' '...' > linkedin-4399262456.html`"? Or programmatic capture via a one-off `npm run capture-fixtures` script? **Recommendation: manual `curl`, committed. Fixtures are versioned ground truth; a script that re-captures will eventually mask drift.**
3. **Defence-in-depth re-check on `recognized.jobId`/`slug`** — add an explicit regex check inside each parser before fetch? Or rely solely on `recognize()`? **Recommendation: add it — three lines per parser, becomes a unit-test fixture, narrows blast radius of any future `recognize()` regression.**
4. **Redirect policy on parser `fetch`** — `redirect: "manual"` (treat 3xx as failure) or `redirect: "follow"` + post-fetch host re-validation? **Recommendation: `"manual"` for symmetry with the rest of the fail-closed posture; document in §"What We're NOT Doing" that this rejects legitimate upstream redirects.**
5. **`encodeURIComponent` on JJIT slug** — add it for symmetry with LinkedIn? Cheap; future-proof. **Recommendation: add.**
6. **Drift canary now or later?** — Phase 2 lands fixtures; the test-plan §5 optional "Parser HTML drift canary (scheduled)" runs the same fixtures against live URLs on a cron. Bring it into scope now, or defer to Phase 4? **Recommendation: defer to Phase 4 (where CI YAML edits are already on the table); Phase 2 stays focused on fixture suite + URL classifier + SSRF endpoint test.**
7. **How many "field missing" fixtures per portal?** — One is enough to prove the `undefined` invariant (no silent empty-string default). More dilute the maintenance budget. **Recommendation: one happy + one field-missing + one deliberately-corrupted per portal. Total six fixtures.**
8. **What to do about LinkedIn HTTP 999 in CI?** — Phase 4's canary will eventually run against live LinkedIn from CI egress IPs and hit the 30–60% block rate. Treat 999 as "skip, don't fail"? Mark the test `.fails.toFail()`? **Recommendation: out of scope for this change — Phase 2 uses fixtures only, no live LinkedIn calls. Push the question to Phase 4's canary plan.**
