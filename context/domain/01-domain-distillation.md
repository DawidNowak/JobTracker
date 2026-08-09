---
title: JobTracker — Domain Distillation
created: 2026-08-08
type: domain-distillation
---

# JobTracker — Domain Distillation

A map of the business domain as it exists in the source documents, cross-checked line by line against the
implementation. No production code is proposed here — the deliverable is the model, the invariants, and the
places where the two diverge.

---

## Step 0 — Project context

### Sources discovered

| Document | Path | Role in this analysis |
| --- | --- | --- |
| PRD (`status: draft`, `version: 1`) | `context/foundation/prd.md` | Primary normative source. Vision, personas, success criteria, US-01…US-04, FR-001…FR-019, an explicit **Business Logic** narrative (`prd.md:160-176`), access control, non-goals |
| Business-logic rationale (Polish) | `context/foundation/business-logic-notes.md` | Why the follow-up rule is the domain decision; names the computed flag `requiresFollowUp` (`business-logic-notes.md:21`) |
| Original idea (Polish) | `context/foundation/idea.md` | Pre-PRD scope. Useful as change history — four columns incl. `Odrzucony` (`idea.md:11`), AI follow-up drafts (`idea.md:15`), `umiejętności` as a field (`idea.md:11-12`) |
| Domain research | `context/foundation/jobtracker-followup-research.md` | External evidence behind the thresholds (7–10 days after applying, 3–5 days after an interview — `jobtracker-followup-research.md:16-19`) |
| Roadmap | `context/foundation/roadmap.md` | Delivery slices S-01…S-11 (`roadmap.md:87-218`); S-04 parser-driven add is flagged *north star* (`roadmap.md:111`) |
| Shape notes | `context/foundation/shape-notes.md` | Pre-PRD shaping; largely superseded by the PRD |
| Tech stack | `context/foundation/tech-stack.md` | Stack rationale |
| Agent rules | `AGENTS.md` | Boundaries (RLS per role, zod at every API boundary, island architecture, Polish UI copy) |
| Change history | `context/archive/**` (25 closed changes, `2026-05-19` → `2026-07-21`) | Per-change `change.md` / `plan.md` / `reviews/impl-review.md` — the record of how each FR landed |

Requirements documentation is unusually complete. This analysis therefore treats the PRD as the model of record
and the code as the thing under audit, rather than the other way round.

### Stack and layering

Astro 6 SSR on Cloudflare Workers · React 19 islands · TypeScript 5.9 strict · Supabase (Postgres + RLS,
`@supabase/ssr`) · zod 4 · Tailwind 4 + shadcn/ui · Vitest + Playwright.

Where business logic actually lives:

| Layer | Path | What of the domain lives here |
| --- | --- | --- |
| Persistence + invariant enforcement | `supabase/migrations/*.sql` | Entity shape, status/work-mode vocabularies as CHECK constraints, per-user RLS, **`last_action_at` triggers** |
| Domain vocabulary + input contracts | `src/lib/validation/applications.ts` | Status and work-mode enums, create/update/note/parse schemas |
| Data access + a little orchestration | `src/lib/services/applications.ts`, `src/lib/services/notes.ts` | Query shaping; one real business rule (archive-source-status filter, `applications.ts:80`) |
| HTTP boundary | `src/pages/api/**` | Auth gate, zod validation, Polish error copy, one rule (`archive.ts:37-42`) |
| Anti-corruption / integration | `src/lib/parsers/*` | Portal recognition (`recognize.ts`), LinkedIn + JustJoin.it HTML → common `ParseResult`, confidence grading (`status.ts`) |
| Pure utilities | `src/lib/format.ts` | **The staleness computation** (`isStale`, `isStaleBusinessDays`) — generic time helpers, no domain names |
| Presentation (React islands) | `src/components/board/*` | **The follow-up rule's thresholds, labels and per-status dispatch** (`KanbanCard.tsx:26-37, 138-139`) |
| Presentation (SSR) | `src/pages/dashboard.astro`, `src/pages/archive*.astro` | Board grouping, read-only archive rendering |
| Auth gate | `src/middleware.ts` | `PROTECTED_ROUTES = ["/dashboard", "/archive"]` (`middleware.ts:4`) |

**There is no domain layer.** `src/lib/` is declared "pure utilities only, no domain logic" by `AGENTS.md`, and
`src/lib/services/` is Supabase queries. The one genuine domain decision the product exists for — *does this
application require action?* — has no home, so it settled in a React component. That observation drives Step 5.

### Limitations of this analysis

- Static reading only. No dev server, no test run, no database was started for this pass. Every citation below
  was read directly in the file at the line given; nothing is inferred from naming.
- The PRD is `status: draft`. Where the PRD contradicts itself (see D-02), I record both readings.
- `context/foundation/test-plan.md` (46 KB) and the 25 archived change folders were surveyed for structure and
  spot-checked, not read end to end. A claim in this document is never sourced from them alone.
- Runtime behaviour of the Supabase triggers is asserted from the SQL text plus the existing integration test
  `tests/integration/lastactionat-trigger.test.ts`, not from an executed query.

---

## Step 1 — Ubiquitous Language

Terms are grouped by area. "In code" cites the most authoritative occurrence; "—" plus an explicit annotation
marks concepts that exist only in the documents.

### Core entities and lifecycle

| Term | Definition (as sourced) | Doc source | In code |
| --- | --- | --- | --- |
| **Aplikacja / Application** | One tracked job application: the record of a posting the user is pursuing. Carries source, position, company, description, salary, work mode, recruiter contact, status, timestamps. | `prd.md:109` | `supabase/migrations/20260526123145_applications_schema.sql:13-28`; type `ApplicationRow` at `src/types.ts:3` |
| **Źródło / Source** | Required free-text field identifying where the posting came from. **No URL validation** — any text accepted, because a posting may come from a recruiter DM or a job fair. | `prd.md:109-110` | `source text not null` (migration:17); `z.string().min(1)` (`src/lib/validation/applications.ts:13`); form label `Źródło *` (`src/components/board/ApplicationForm.tsx:33`) |
| **Status** | The application's stage. Exactly three values: `Interesujące`, `Zaaplikowano`, `Rozmowa`. Polish literals are the domain values, not display labels. | `prd.md:122` | `src/lib/validation/applications.ts:3`; CHECK constraint at migration:23-24 |
| **Interesujące** | Stage 1 — a posting the user is considering but has not applied to. No recruiter contact has occurred. | `prd.md:122`, `prd.md:127` | `src/lib/validation/applications.ts:3`; default status at `validation/applications.ts:20` and migration:23 |
| **Zaaplikowano** | Stage 2 — the user has applied; awaiting a recruiter response. | `prd.md:122` | `src/lib/validation/applications.ts:3` |
| **Rozmowa** | Stage 3 — interview stage. **Recruiter-initiated**: cannot be entered directly, only by transition from `Zaaplikowano`. | `prd.md:122-123` | `src/lib/validation/applications.ts:3`; add-button exclusion at `src/components/board/AddApplicationDialog.tsx:19` and `KanbanBoard.tsx:169` |
| **Odrzucony / Rejected** | An application the user marks as rejected from `Zaaplikowano` or `Rozmowa`; it leaves the board for the archive. | `prd.md:126` | **No such state in the model.** UI action `Odrzuć` at `src/components/board/KanbanCard.tsx:182`; persisted only as `archived_at` (migration:27). See D-07 |
| **Archiwum / Archive** | The off-board list of rejected applications, reachable from a permanent nav link, with full read-only detail incl. note history. | `prd.md:128-131` | `archived_at timestamptz` (migration:27); `listArchivedApplications` (`src/lib/services/applications.ts:20-31`); pages `src/pages/archive.astro`, `src/pages/archive/[id].astro` |
| **Notatka follow-up / Follow-up note** | Plain-text note attached to an application. No type taxonomy. Ordered most-recent-first with timestamps. | `prd.md:148-151` | Table `application_notes` (migration:67-73); `src/lib/services/notes.ts`; ordering at `notes.ts:16` |
| **Tryb pracy / Work mode** | `Zdalna` \| `Hybrydowa` \| `Stacjonarna`. | `prd.md:109` (field list) | `src/lib/validation/applications.ts:4`; CHECK at migration:21 |
| **Kontakt do rekrutera** | Optional free text (email, LinkedIn URL, or name) — the target of a follow-up. | `prd.md:134-135` | `recruiter_contact` (migration:22); form field `ApplicationForm.tsx:122` |
| **Widełki / Salary range** | Free-text salary range. | `prd.md:109` | `salary text` (migration:20) |
| **Umiejętności / Skills** | Listed in the PRD as a first-class field of the application, both for manual entry and parser pre-fill. | `prd.md:109`, `prd.md:111`, `idea.md:11-12` | **NOT in the code as a field.** No column, no zod key, no `ParseResult` key (`src/lib/parsers/types.ts:3-9`). Folded into description — label reads `Opis i wymagane umiejętności` (`ApplicationForm.tsx:72`) with hint at `ApplicationForm.tsx:82`. See D-01 |

### The follow-up decision (the product's reason to exist)

| Term | Definition (as sourced) | Doc source | In code |
| --- | --- | --- | --- |
| **`lastActionAt`** | Timestamp of the most recent *user action* on an application. Initialised to the creation timestamp. | `prd.md:162`, `prd.md:172` | `last_action_at timestamptz not null default now()` (migration:26) |
| **Akcja / Action** | A domain-significant event. Exactly two things count: (1) saving a follow-up note, (2) changing status. Field edits (position, company, description, salary, work mode) explicitly **do not** count — "a typo fix in a company name is not a signal that the user tended to the application". | `prd.md:164`; rationale `business-logic-notes.md:11-13` | Encoded as two triggers: status change (migration:118-122) and note insert (migration:154-157). Guard clause `when (old.status is distinct from new.status)` at migration:121 |
| **`requiresAction`** | The computed flag: is this card actionable now? Explicitly **not stored** — recomputed on every dashboard load, so it can never drift from `lastActionAt`. | `prd.md:166`, `prd.md:170` | **Name absent from the code.** Nearest: local consts `showPrompt` / `followUp` (`src/components/board/KanbanCard.tsx:138-139`). See D-03 |
| **`requiresFollowUp`** | Second name for the same computed flag, used in the rationale document. | `business-logic-notes.md:21` | **Not in code.** Two doc names for one concept — see D-03 |
| **Próg / Threshold** | Fixed, non-configurable, per-status inactivity budget: **1 day** in `Interesujące`, **7 days** in `Zaaplikowano`, **4 business days** in `Rozmowa`. | `prd.md:139`, `prd.md:141`, `prd.md:143`, `prd.md:166` | Inline literals: `isStale(iso, 7, now)` (`KanbanCard.tsx:29`), `isStaleBusinessDays(iso, 4, now)` (`KanbanCard.tsx:34`), `isStale(application.last_action_at, 1)` (`KanbanCard.tsx:138`) |
| **Dni robocze / Business days** | Mon–Fri; Saturday and Sunday excluded; **public holidays not excluded in MVP**. Justified because recruiters work on a working-week cadence — a Friday interview with a 4-calendar-day threshold would fire on Tuesday. | `prd.md:143-144`, `prd.md:166` | `isStaleBusinessDays` (`src/lib/format.ts:41-54`); weekend skip at `format.ts:49` |
| **Decision prompt** | The `Interesujące` variant of the flag. Semantics: *decide* — apply or skip. Copy: `Zdecyduj — aplikujesz?` | `prd.md:76`, `prd.md:168` | `KanbanCard.tsx:233`; actions `Aplikuj` (`KanbanCard.tsx:246`) and `Pomiń` (`KanbanCard.tsx:258`) |
| **Follow-up prompt** | The `Zaaplikowano` / `Rozmowa` variant. Semantics: *reach out to the recruiter*. Distinct copy per column. | `prd.md:96`, `prd.md:168` | `FOLLOWUP_FLAGS` (`KanbanCard.tsx:26-37`); labels `Czas na follow-up z rekruterem` (`:30`), `Czas na follow-up po rozmowie` (`:35`); CTA `Napisz follow-up` (`KanbanCard.tsx:228`) |
| **Passive surfacing** | The user never runs a report or requests a check; flags appear on the board on load. | `prd.md:170`, `business-logic-notes.md:23-25` | Rendered inline in the card body (`KanbanCard.tsx:213-261`) |
| **Aplikuj** | Single-click resolution of the decision prompt: `Interesujące` → `Zaaplikowano`, no dialog, no form. | `prd.md:81` | `onApply` (`src/components/board/KanbanBoard.tsx:100-132`) |
| **Pomiń** | The other resolution: permanent delete, confirmation dialog, **no archive entry**. | `prd.md:82-83`, `prd.md:117` | `KanbanCard.tsx:258` → `DeleteApplicationDialog`; copy branch at `src/components/board/DeleteApplicationDialog.tsx:22-25` |

### Parsing / integration

| Term | Definition (as sourced) | Doc source | In code |
| --- | --- | --- | --- |
| **Pobierz dane oferty** | The auto-fill action. Activates only when the source field holds a recognised portal URL; pre-fills the offer fields; user may edit before saving. | `prd.md:55`, `prd.md:111` | Gate `canParse` (`src/components/board/AddApplicationDialog.tsx:74`); endpoint `src/pages/api/applications/parse.ts` |
| **Obsługiwany portal / Supported portal** | LinkedIn or JustJoinIT. | `prd.md:55` | `recognize()` (`src/lib/parsers/recognize.ts:18-36`) — hosts `linkedin.com`, `www.`/`pl.` variants, `justjoin.it` |
| **Parse confidence** | A field that cannot be extracted with reasonable confidence stays **empty** — never a low-confidence guess. No silent garbage pre-fill. | `prd.md:112`, `prd.md:158` | `ParseStatus = ok \| partial \| empty \| unsupported \| fetch_failed` (`src/lib/parsers/types.ts:11`); `resolveStatus` (`src/lib/parsers/status.ts:12-18`); per-portal expectations at `status.ts:3-6` |
| **Graceful fallback** | Parse failure or unsupported portal → fields stay empty, explicit Polish message, manual entry. Never a silent failure. | `prd.md:57`, `prd.md:112` | `MESSAGES` (`parse.ts:22-27`); failure paths return HTTP 200 with a status, not an error (`parse.ts:49-76`) |
| **Link do oferty** | Board-visible link, shown **only** when source parses as a URL; plain-text sources show nothing (no disabled state). | `prd.md:132-133` | `parseSourceHref` (`src/lib/format.ts:1-11`); conditional render `KanbanCard.tsx:198-207` |

### Access and identity

| Term | Definition (as sourced) | Doc source | In code |
| --- | --- | --- | --- |
| **User / Konto** | Flat user model. No roles, no admin, no sharing. Email + password (Google OAuth deferred to v2). | `prd.md:180`, `prd.md:191` | Supabase `auth.users`; FK at migration:15; endpoints `src/pages/api/auth/*` |
| **Izolacja danych / Data isolation** | No user sees another user's applications, "under any circumstance… an auth failure here is not a P2 bug — it's an incident". | `prd.md:41` | RLS policies migration:42-61 (applications) and 80-99 (notes), hardened at `20260526132205_harden_application_notes_rls.sql:17-44` |

---

## Step 2 — Subdomain classification

Classification is anchored to the PRD's own statement of purpose: the kanban is the mental model users already
have, and *"the proactive intelligence layer on top… That layer is the product"* (`prd.md:22`). Anything the
product could buy, skip, or do badly without losing its reason to exist is not Core.

| # | Area | Category | Justification (tied to stated goals / non-goals) |
| --- | --- | --- | --- |
| 1 | **Follow-up / decision recommendation** — `lastActionAt` semantics, per-status thresholds, business-day counting, decision-vs-follow-up prompt semantics | **CORE** | Named as *the product* at `prd.md:22`. It is the only part that "classifies, recommends, checks conditions, and walks the user through a process" (`business-logic-notes.md:35-38`). Thresholds are domain-researched, not arbitrary (`jobtracker-followup-research.md:16-19`). A spreadsheet replicates everything else. |
| 2 | **`lastActionAt` action semantics** (what counts as an action) | **CORE** | The distinction between "edited a typo" and "tended to this application" is the domain insight that makes the recommendation trustworthy (`business-logic-notes.md:11-13`). Guardrail-level: silent loss "corrupts the follow-up timing rule downstream" (`prd.md:42`). |
| 3 | **Application lifecycle + transition rules** — three active stages, `Rozmowa` unreachable by creation, reject only from stages 2–3, `Interesujące` deletes instead of archiving | **CORE** | These rules encode the recruitment process itself. `prd.md:123` ("no one enters an interview without first applying") and `prd.md:117-118` (nothing worth preserving where no recruiter contact occurred) are domain judgements, not UI conveniences. |
| 4 | **Job-posting parsing (LinkedIn / JustJoinIT)** | **SUPPORTING** — with a Core-adjacent success bar | Not the product's decision-making, but the PRD's *primary* success criterion is that ≥80% of applications are added via auto-fill (`prd.md:32`), and the roadmap marks S-04 as the north star (`roadmap.md:111`). It is bespoke (no off-the-shelf component parses these two portals into this schema) and it makes the Core layer usable at volume. Supporting, not Generic — and the highest-value Supporting area. |
| 5 | **Note history** | **SUPPORTING** | Serves the Core rule in two ways: a note insert is one of the two `lastActionAt` resets (`prd.md:164`), and the history is the stated primary value of the archive (`prd.md:131`). But plain text with no taxonomy (`prd.md:149`) — deliberately dumb. |
| 6 | **Archive** | **SUPPORTING** | Exists to keep dead weight off the board (`prd.md:123`) while preserving note history (`prd.md:131`). Explicitly minimal: no search, filter or sort (`prd.md:190`). |
| 7 | **Kanban board / drag-and-drop / card UI** | **SUPPORTING** | The PRD is explicit that the kanban is *already internalised* by users (`prd.md:22`) — it is the delivery surface for the Core rule, not the differentiator. Note that today it also *contains* the Core rule; that is the defect in Step 5, not a reclassification. |
| 8 | **Authentication + session** | **GENERIC** | `prd.md:103` — the starter already ships it; Google OAuth was dropped because it delivers "no functional unlock". Bought from Supabase. |
| 9 | **Per-user data isolation (RLS)** | **GENERIC mechanism, guardrail severity** | The mechanism is stock Postgres RLS on `auth.uid()`. Classified Generic because nothing about it is JobTracker-specific — but `prd.md:41` rates failure as an incident, which is why `AGENTS.md` makes RLS the system under test rather than something to mock. Generic ≠ low priority. |
| 10 | **CRUD, forms, validation, HTTP plumbing** | **GENERIC** | zod + Astro routes + shadcn. Interchangeable. |
| 11 | **Analytics / pattern detection, AI drafts, notifications, calendar, browser extension, job-match scoring** | **OUT OF DOMAIN (non-goals)** | Explicitly excluded at `prd.md:184-190`. Listed here so the map records that their absence is intentional, not a gap. |

---

## Step 3 — Aggregate candidates and their invariants

### Candidate A — `Application` (aggregate root), with `ApplicationNote` as a contained entity

The boundary is well-evidenced: notes are addressed only through the parent in the URL space
(`src/pages/api/applications/[id]/notes/...`), the FK cascades on delete (migration:69), a note insert mutates
parent state (migration:154-157), and the hardened RLS policy requires the parent to belong to the same user
(`20260526132205_harden_application_notes_rls.sql:20-28`). The domain treats them as one consistency unit. The
code mostly does too — with the exceptions below.

Invariant status legend: **ENFORCED** (code makes violation impossible) · **PARTIAL** (enforced on some paths)
· **DECLARED** (stated in docs and/or comments, nothing prevents violation) · **IGNORED** (no enforcement).

| # | Invariant | Source quote | Status | Evidence |
| --- | --- | --- | --- | --- |
| I-01 | A user's applications are visible and mutable only to that user. | *"no user sees another user's applications under any circumstance"* (`prd.md:41`) | **ENFORCED** | Four separate RLS policies on `auth.uid()` (migration:42-61); services also filter `.eq("user_id", userId)` (e.g. `services/applications.ts:63`) — defence in depth. Suites: `tests/integration/rls-applications.test.ts`, `rls-unauthenticated.test.ts` |
| I-02 | A note always belongs to exactly one application owned by the same user. | Migration header: *"a user cannot insert a note that points at another user's application"* (migration:126-127) | **PARTIAL** | Cross-**user** is enforced (EXISTS clause, harden migration:20-28). Cross-**application within the same user** is not: `PATCH`/`DELETE` on `/applications/[id]/notes/[noteId]` validate `[id]` then never use it (`src/pages/api/applications/[id]/notes/[noteId].ts:47`, `:82`), and `updateNote`/`deleteNote` key on `noteId + user_id` only (`services/notes.ts:51-52`, `:66-67`). The root does not guard its child. See D-06 |
| I-03 | `lastActionAt` advances **only** on a status change or a note save — never on a field edit. | *"`lastActionAt` resets under exactly two conditions… General field edits… do NOT reset it"* (`prd.md:164`) | **PARTIAL** | The *advance* half is DB-enforced by two triggers (migration:118-122, 154-157) and covered by `tests/integration/lastactionat-trigger.test.ts:22-70`. The *no-other-write* half is enforced only by schema shape — `last_action_at` is absent from `applicationUpdateSchema` (`validation/applications.ts:23-33`), so zod strips it. Nothing at the DB level (no column privileges, no trigger guard) prevents a direct write. Practical exposure is low: `SUPABASE_KEY` is imported from `astro:env/server` (`src/lib/supabase.ts:3`) and never reaches the browser. See D-11 |
| I-04 | `lastActionAt` is initialised equal to the creation timestamp. | *"`lastActionAt` is initialized to the creation timestamp"* (`prd.md:172`) | **ENFORCED** | Both columns `default now()` (migration:25-26); asserted byte-equal at `tests/integration/lastactionat-trigger.test.ts:22-27` |
| I-05 | An application may be archived only from `Zaaplikowano` or `Rozmowa`. | *"Scope is Zaaplikowano + Rozmowa only — cards in 'Interesujące' are deleted, not archived"* (`prd.md:127`) | **ENFORCED** | `.in("status", ["Zaaplikowano", "Rozmowa"])` in the UPDATE predicate (`services/applications.ts:80`); explicit 422 with Polish copy (`api/applications/[id]/archive.ts:40-42`); UI hides `Odrzuć` for `Interesujące` (`KanbanCard.tsx:176`). **The best-modelled rule in the codebase** |
| I-06 | An application cannot be archived twice. | Implied by FR-009 (`prd.md:126`) | **ENFORCED** | `.is("archived_at", null)` in the same predicate (`services/applications.ts:79`) + 422 branch (`archive.ts:37-39`) |
| I-07 | A skipped (`Pomiń`) `Interesujące` card is permanently deleted with **no** archive entry. | *"No archive entry is created for a skipped card — deletion is permanent"* (`prd.md:83`) | **ENFORCED** | Hard `DELETE` (`services/applications.ts:126-139`); no archive path reachable from `Interesujące` (I-05) |
| I-08 | An archived application is **read-only** — all fields and full note history visible, *"no editing is possible"*. | `prd.md:130-131` | **IGNORED (server-side)** | `updateApplication` has no `archived_at` filter (`services/applications.ts:53-71`) and `PATCH /api/applications/[id]` no guard (`api/applications/[id].ts:41`); `createNote` has no parent-state check (`api/applications/[id]/notes/index.ts:67`). Read-only exists only because the archive UI renders `ReadOnlyNotesList` (`archive/[id].astro:108`). Concrete failure: `POST` a note to an archived application → the trigger bumps a frozen record's `last_action_at`; `PATCH {status}` on an archived application mutates the value later displayed at `archive/[id].astro:96-98`. See D-05 |
| I-09 | `Rozmowa` is entered **only** by transition — never by creation. | *"Rozmowa has no add button; it is populated exclusively by status changes from Zaaplikowano"* (`prd.md:122`) | **IGNORED (server-side)** | `applicationCreateSchema.status` accepts the full three-value enum (`validation/applications.ts:20`) and `POST /api/applications` passes it straight through (`api/applications/index.ts:22-33`). Enforced in the UI only — `AddableStatus = Exclude<ApplicationStatus, "Rozmowa">` (`AddApplicationDialog.tsx:19`) and the header-action condition (`KanbanBoard.tsx:169`). A direct API call creates a card in `Rozmowa`. See D-04 |
| I-10 | Status transitions between active columns are unrestricted in both directions. | *"any active-column → any active-column is allowed, including backward moves"* (`prd.md:125`, `prd.md:176`) | **ENFORCED** (by design — nothing to restrict) | `applicationUpdateSchema.status` (`validation/applications.ts:32`) accepts any enum value; drag-and-drop allows any pair (`KanbanBoard.tsx:59-98`) |
| I-11 | `source` is always present and non-empty. | *"the source field is required"* (`prd.md:109`) | **ENFORCED** | `not null` (migration:17) + `z.string().min(1)` (`validation/applications.ts:13`) |
| I-12 | Status and work mode are drawn from closed vocabularies. | `prd.md:122`; field list `prd.md:109` | **ENFORCED** | CHECK constraints (migration:21, 23-24) + zod enums (`validation/applications.ts:3-7`) — vocabulary duplicated in two places but consistent |
| I-13 | A note body is never empty. | Implied by FR-013 (`prd.md:148`) | **ENFORCED** | `check (length(body) > 0)` (migration:71) + `z.string().min(1)` (`validation/applications.ts:44`) + client trim guard (`CardNotes.tsx:62`) |
| I-14 | `requiresAction` is never persisted — always recomputed. | *"The flag… is not stored as a persistent field. It is computed on-the-fly"* (`prd.md:166`); rationale at `business-logic-notes.md:19-21` | **ENFORCED** (trivially) | No such column exists (migration:13-28); computed at render (`KanbanCard.tsx:138-139`). Honoured — but see D-10 for *where* it is computed |
| I-15 | The threshold clock measures elapsed time from the last action ("24 hours"). | *"a card added to 'Interesujące' will be flagged after 24 hours of inactivity starting from the moment of creation"* (`prd.md:172`) | **VIOLATED** | `isStale` normalises both ends to local midnight before differencing (`format.ts:30-39`), so the flag fires at the next midnight boundary, not after 24 h. A card created at 23:00 is flagged at 00:00 — one hour later. See D-02 |

### Candidate B — `FollowUpPolicy` / `ApplicationActionability`

Not an aggregate — a **domain policy (stateless domain service over a value object)**. Recorded here because
it is the single most important modelling element in the product and currently has **no representative in the
code at all**. Its inputs are exactly two (`prd.md:164`: current status + `lastActionAt`) and its output is a
flag plus a prompt kind (decision vs follow-up, `prd.md:168`). Today those inputs are read from a raw DB row
inside JSX and the output exists as two unnamed local booleans (`KanbanCard.tsx:138-139`).

| # | Invariant | Source quote | Status | Evidence |
| --- | --- | --- | --- | --- |
| I-16 | Thresholds are fixed and not user-configurable. | *"Threshold is fixed, not user-configurable"* — repeated at `prd.md:139`, `:141`, `:143` | **ENFORCED** (as hard-coded literals) | `KanbanCard.tsx:29, 34, 138` |
| I-17 | The prompt's *semantics* differ per column while the *computation* is identical. | *"The displayed label differs per column; the underlying computation rule is identical"* (`prd.md:168`) | **DECLARED, structurally contradicted** | Two of three statuses go through the table-driven `FOLLOWUP_FLAGS` (`KanbanCard.tsx:26-37`); the third (`Interesujące`) is a separate hand-written branch (`KanbanCard.tsx:138`) using a different helper shape. The identical rule is expressed twice, two different ways |
| I-18 | `Rozmowa` counts business days only (Mon–Fri; holidays not excluded in MVP). | `prd.md:143-144` | **ENFORCED** | `isStaleBusinessDays` (`format.ts:41-54`), weekend skip at `:49`; unit-tested in `tests/unit/format.test.ts` |
| I-19 | Evaluation is server-truthful — a property of the application's state, not of the viewer. | *"computed on-the-fly each time the user navigates to the dashboard"* (`prd.md:166`); *"obliczana przy każdym załadowaniu dashboardu"* (`business-logic-notes.md:21`) | **IGNORED** | Computed in a `client:load` React island (`dashboard.astro:35` → `KanbanCard.tsx:138-139`) with `new Date()` defaulted in the browser (`format.ts:34`, `:41`) and local-midnight normalisation (`format.ts:30-32`). The domain verdict depends on the device clock and timezone. See D-10 |

### Candidate C — `JobPostingSource` / `ParsedOffer` (value objects)

A clean, well-bounded anti-corruption layer — the healthiest non-core code in the repo.

| # | Invariant | Source quote | Status | Evidence |
| --- | --- | --- | --- | --- |
| I-20 | Auto-fill activates only for a recognised supported-portal URL. | *"the 'Pobierz dane oferty' button activates only when the entered text is a valid URL from a supported portal"* (`prd.md:55`) | **ENFORCED** | `canParse = recognize(...) !== null` (`AddApplicationDialog.tsx:74`); server re-recognises independently (`parse.ts:48-56`) — the client gate is not trusted |
| I-21 | A low-confidence field is left empty rather than guessed. | *"that field remains empty rather than pre-filled with a low-confidence guess — no silent garbage pre-fill"* (`prd.md:158`) | **ENFORCED** | Only `!== undefined` results are written to the form (`AddApplicationDialog.tsx:93-97`); grading via `resolveStatus` (`status.ts:12-18`) |
| I-22 | Parse failure never blocks the user — manual entry always available, with an explicit message. | `prd.md:57`, `prd.md:112` | **ENFORCED** | All failure modes return HTTP 200 + a `ParseStatus` + Polish copy (`parse.ts:22-27`, `:49-76`); the form remains fully editable |
| I-23 | Source URL identity is validated independently of the free-text `source` field. | `prd.md:110` (source is free text) vs `prd.md:132` (link shown only for valid URLs) | **ENFORCED** | `parseSourceHref` restricted to `http:`/`https:` (`format.ts:1-11`); conditional render (`KanbanCard.tsx:198`) |

### Candidate D — `UserAccount`

Generic; owned entirely by Supabase Auth. The only domain-relevant invariant is I-01. No custom aggregate
needed, and none should be introduced.

---

## Step 4 — Model ↔ code discrepancies

The most valuable section: places where domain knowledge exists in the documents but is absent, weakened, or
contradicted in the code. Ordered by domain significance.

| # | The document says | The code does | Proof | Severity |
| --- | --- | --- | --- | --- |
| **D-01** | `skills` is a first-class application field, entered manually and pre-filled by the parser: *"position, company, description, **skills**, salary range, and work mode"* (`prd.md:109`, `prd.md:111`; also `idea.md:11-12`, `roadmap.md:101`, `roadmap.md:113`) | No `skills` anywhere. No column (migration:13-28), no zod key (`validation/applications.ts:12-21`), no `ParseResult` key (`parsers/types.ts:3-9`). Silently merged into `description`, visible only in a UI label: `Opis i wymagane umiejętności` (`ApplicationForm.tsx:72`) and its hint (`ApplicationForm.tsx:82`) | `prd.md:111` vs `src/lib/parsers/types.ts:3-9` | **High** — a named domain concept was dropped by implementation decision and never written back to the PRD. Anyone reading the PRD will believe the field exists |
| **D-02** | *"a card added to 'Interesujące' will be flagged after **24 hours** of inactivity starting from the moment of creation"* (`prd.md:172`); FR-015 says *"1 day (24 hours)"* (`prd.md:139`) | Calendar-midnight arithmetic: both timestamps are floored to local midnight, then whole days are differenced (`format.ts:30-39`). A card created Monday 23:00 is flagged Tuesday 00:00 — after 1 hour. `Zaaplikowano`'s 7-day threshold can fire after 6 days + 1 hour | `prd.md:172` vs `src/lib/format.ts:30-39` (`startOfLocalDay` + `dayDelta >= days`) | **High** — the Core rule fires up to ~24 h early on every card. Note the PRD is internally inconsistent: US-03 says *"1 calendar day"* (`prd.md:74`) and the Business Logic section says *"1 calendar day… 7 calendar days"* (`prd.md:166`), which matches the code. **The doc contradicts itself; a decision is owed, not a patch** |
| **D-03** | The computed flag is a named domain concept — `requiresAction` (`prd.md:166`) / `requiresFollowUp` (`business-logic-notes.md:21`) | Neither name exists in the source. The concept surfaces as two anonymous local consts inside a render function: `showPrompt` and `followUp` (`KanbanCard.tsx:138-139`) | `prd.md:166` and `business-logic-notes.md:21` vs `src/components/board/KanbanCard.tsx:138-139` | **High** — the product's central concept is unnameable in code. Also a ubiquitous-language failure inside the docs themselves: two names for one thing |
| **D-04** | *"New applications can be added only to Interesujące and Zaaplikowano — Rozmowa has no add button; it is populated **exclusively** by status changes"* (`prd.md:122`) | `applicationCreateSchema` accepts all three statuses (`validation/applications.ts:20`); `POST /api/applications` passes the value straight to the insert (`api/applications/index.ts:22-33`). The DB CHECK allows it too (migration:24). Only the UI type excludes it (`AddApplicationDialog.tsx:19`) | `prd.md:122` vs `src/lib/validation/applications.ts:20` + `src/pages/api/applications/index.ts:33` | **Medium-High** — a lifecycle rule enforced by a React type alias. `AGENTS.md` mandates zod validation at every API boundary; here the schema is present but permits a state the domain forbids |
| **D-05** | Archived applications are read-only: *"all fields and the complete note history are visible; **no editing is possible**"* (`prd.md:130`) | No server-side guard. `PATCH /api/applications/[id]` edits archived rows (`api/applications/[id].ts:41` → `services/applications.ts:53-71`, no `archived_at` filter). `POST .../notes` appends to archived rows (`api/.../notes/index.ts:67`), and the AFTER-INSERT trigger then bumps the archived row's `last_action_at` (migration:154-157). Read-only exists only as a UI choice (`archive/[id].astro:108`) | `prd.md:130` vs `src/lib/services/applications.ts:53-71` and `src/pages/api/applications/[id]/notes/index.ts:67` | **Medium-High** — an aggregate in a terminal state accepts mutations. Contrast with I-05/I-06, where the same file *does* express state guards in the UPDATE predicate — the pattern exists, it just wasn't applied here |
| **D-06** | Notes are history *of an application*: *"the full history of follow-up notes **for an application**"* (`prd.md:150`); the aggregate boundary is asserted in the migration header (migration:126-127) | The note-mutation routes validate the application id and then discard it. `updateNote`/`deleteNote` locate the row by `noteId + user_id` alone (`services/notes.ts:51-52`, `:66-67`), so `PATCH /api/applications/<A>/notes/<note-of-B>` succeeds when A and B belong to the same user | `src/pages/api/applications/[id]/notes/[noteId].ts:47` and `:82` (the validated `idParam` is never passed on) vs `src/lib/services/notes.ts:42-60` | **Medium-High** — textbook aggregate-boundary violation. Not a security hole (cross-user is blocked by RLS), but the root does not mediate access to its children, and the URL implies a containment guarantee it does not provide |
| **D-07** | The domain verb is **reject**: *"User can mark an application as rejected"* (`prd.md:126`); the UI action is `Odrzuć` (`KanbanCard.tsx:182`) | The model has no rejection concept. Only `archived_at` (migration:27), `archiveApplication` (`services/applications.ts:73-88`), route `/archive`. The status column retains `Zaaplikowano`/`Rozmowa` after rejection, so the archive detail page shows a stale live-stage status (`archive/[id].astro:96-98`) | `prd.md:126` vs `supabase/migrations/…_applications_schema.sql:27` and `src/lib/services/applications.ts:73-88` | **Medium** — one domain event (*rejected*) is represented by a mechanism (*archived*), and the terminal state is not in the state column. Two vocabularies for one lifecycle transition |
| **D-08** | Notes are a *history trail*: *"ślad historii komunikacji"* (`idea.md:16`), *"appended to a history list"* (`prd.md:70`). FR-013/FR-014 grant **write and view** only (`prd.md:148-151`); note **deletion** appears in no document | Notes are fully mutable and deletable from the board UI (`CardNotes.tsx:87-143`; endpoints at `api/applications/[id]/notes/[noteId].ts`), with a confirm dialog (`CardNotes.tsx:234-259`). Correctly, neither edit nor delete bumps `last_action_at` (only INSERT has a trigger, migration:154) | `prd.md:148-151` vs `src/pages/api/applications/[id]/notes/[noteId].ts:59-92` | **Medium** — undocumented capability that weakens an append-only history. `idea.md:16` sanctions *edit*; *delete* is unsanctioned by any source |
| **D-09** | The card carries a **creation** timestamp: *"the card appears in the column… with creation timestamp"* (`prd.md:58`) | The card renders `last_action_at` under a label that says "added": `formatRelative(application.last_action_at)` (`KanbanCard.tsx:137`) producing the string `` `dodano ${…}` `` (`format.ts:68`), shown at `KanbanCard.tsx:263`. After any status change the card claims to have been added at a time it was not | `prd.md:58` vs `src/components/board/KanbanCard.tsx:137` + `src/lib/format.ts:68` | **Medium** — two distinct domain timestamps (`created_at`, `last_action_at`) collapsed into one display, under the wrong noun. `created_at` is stored (migration:25) and simply never shown on the board |
| **D-10** | The rule is a property of the application, evaluated on dashboard load: *"obliczana przy każdym załadowaniu dashboardu"* (`business-logic-notes.md:21`); *"computed on-the-fly each time the user navigates to the dashboard"* (`prd.md:166`) | Evaluated in the browser, per card, at React render time, against the **device clock in the device timezone** — `new Date()` is the parameter default (`format.ts:34`, `:41`) and day boundaries use `getFullYear/getMonth/getDate` (`format.ts:30-32`). `dashboard.astro` ships raw rows and does no evaluation (`dashboard.astro:20-31`) | `business-logic-notes.md:21` vs `src/pages/dashboard.astro:35` + `src/components/board/KanbanCard.tsx:138-139` + `src/lib/format.ts:30-41` | **Medium** — the domain verdict is a function of untrusted client state. Travelling across timezones changes which cards are flagged. Also blocks any future server-side use of the rule (digest, sort, count) |
| **D-11** | *"`lastActionAt` resets under **exactly two** conditions"* (`prd.md:164`); the migration header claims *"DB-enforced last_action_at semantics"* (migration:1) | The DB enforces the two *bumps* but does not prevent a third path: `last_action_at` is a plain updatable column under a permissive RLS UPDATE policy (migration:52-56), with no column privileges and no trigger rejecting direct writes. The only thing stopping it is zod stripping unknown keys (`validation/applications.ts:23-33`). Exposure is limited — `SUPABASE_KEY` is server-only (`src/lib/supabase.ts:3`) | `prd.md:164` + migration:1 vs `supabase/migrations/…_applications_schema.sql:52-56` (no column-level restriction) | **Low-Medium** — the header comment overstates the guarantee. Real today, latent risk if a client-side Supabase client is ever introduced |
| **D-12** | The bump function is named for its condition: `applications_bump_last_action_at_on_status_change` | The function body sets `last_action_at` **unconditionally** (migration:113); the status guard lives in the trigger's `WHEN` clause (migration:121), outside the named unit. Correct today, but the invariant is not where its name promises | `supabase/migrations/…_applications_schema.sql:108-122` | **Low** — attaching this function to any other trigger silently breaks I-03. The integration test explicitly notes the trap (`tests/integration/lastactionat-trigger.test.ts:30-33`) |
| **D-13** | Primary success criterion: *"At least 80% of job applications are added using 'Pobierz dane oferty' auto-fill"* (`prd.md:32`) | No instrumentation exists. Nothing records whether a create followed a parse: `applicationCreateSchema` has no provenance field (`validation/applications.ts:12-21`), and the create route stores none (`api/applications/index.ts:33`). Consistent with the non-goal *"No analytics or pattern detection"* (`prd.md:189`) | `prd.md:32` vs `src/lib/validation/applications.ts:12-21` | **Low (product), noteworthy** — the criterion that justifies the whole Supporting parser subdomain cannot be evaluated. Not a code defect; a PRD that sets an unmeasurable bar |

**Doc-to-doc drift** (recorded for completeness; code follows the PRD correctly in all three cases): the fourth
column `Odrzucony` (`idea.md:11`) became three columns + archive (`prd.md:122`); AI-generated follow-up drafts
(`idea.md:15`) moved to non-goals (`prd.md:184`); numeric success targets of 70%/60% (`idea.md:30-31`) softened
to *"the majority"* (`prd.md:36-37`).

---

## Step 5 — Refactoring ranking

Scored on **Value** (how close to Core — Step 2) × **Risk** (how weakly the invariant is enforced today —
Step 3/4).

| Rank | Candidate | Value | Risk | Rationale |
| --- | --- | --- | --- | --- |
| **1** | **Extract the follow-up/decision policy into a domain module** (Candidate B) — a named `requiresAction`-style concept owning the three thresholds, the two clock semantics, the prompt kind, and the labels; evaluated server-side | **Highest** — this *is* the product (`prd.md:22`) | **Highest** — I-15 violated, I-17 structurally contradicted, I-19 ignored; D-02, D-03, D-10 all land here | See below |
| **2** | **Make `Application` a real aggregate root**: notes reached only through their parent (I-02/D-06), archived state guarded server-side (I-08/D-05), `Rozmowa` unreachable by creation (I-09/D-04) | High — lifecycle rules are Core (Step 2 #3) | High — three separate rules enforced by UI or by nothing | Three independent server-side gaps sharing one root cause: the root never mediates. Cheap to close — the guard pattern already exists at `services/applications.ts:79-80`, it simply wasn't reused |
| **3** | **Model rejection as an explicit lifecycle state** (D-07) | Medium-High — Core lifecycle | Medium — no incorrect behaviour today, but the terminal state is invisible in the status column and the archive shows stale live-stage status | Vocabulary repair: one domain event currently represented by an implementation mechanism. Requires a migration → falls under `AGENTS.md` ⚠️ *ask first* |
| **4** | **Resolve `skills`** (D-01) — either restore the field end to end or amend PRD/roadmap to record the merge into `description` | Medium — a named domain concept | Medium — the PRD misleads every future reader | Not necessarily a code change. The cheap correct move may be to fix the document |
| **5** | **Correct the card timestamp** (D-09) | Low-Medium | Low | Small, isolated, user-visibly wrong today |
| **6** | **Harden `last_action_at` at the column level** and rename the trigger function to match its guard (D-11, D-12) | Medium — protects Core input | Low today (`SUPABASE_KEY` is server-only) | Defence in depth; becomes urgent only if a browser-side Supabase client is ever added |

### #1 candidate: the follow-up policy has no home

**Extract the actionability rule out of `KanbanCard.tsx` into a named domain module, evaluated on the server.**

Why it ranks first on both axes at once:

1. **It is the entire justification for the product.** The PRD states it plainly — the kanban is a mental model
   users already have, and the intelligence layer on top *"is the product"* (`prd.md:22`).
   `business-logic-notes.md:31-42` argues the certification case entirely on this rule. Every other subdomain
   is Supporting or Generic.

2. **It currently lives in a presentation component.** `src/components/board/KanbanCard.tsx:26-37` and
   `:138-139` hold the thresholds, the per-status dispatch, and the labels — inside a React island whose job is
   drawing a card. `src/lib/format.ts` holds the arithmetic under domain-free names (`isStale`) and is barred
   from domain logic by `AGENTS.md`. The layer that should own this does not exist.

3. **The rule is already expressed twice, inconsistently.** Two of three statuses go through the table-driven
   `FOLLOWUP_FLAGS`; `Interesujące` is a separate hand-written branch (`KanbanCard.tsx:138`) — even though the
   PRD is explicit that *"the underlying computation rule is identical"* (`prd.md:168`). A fourth stage, or a
   threshold recalibration (which `prd.md:140` anticipates: *"Threshold can be calibrated post-launch"*),
   requires edits in two shapes in one JSX file.

4. **Its clock semantics are wrong and unowned.** D-02 (fires up to ~24 h early) and D-10 (device clock and
   timezone decide a domain verdict) are both consequences of the rule having no owner: the calendar-midnight
   choice was made inside a formatting helper, where no one would look for a domain decision. Note that this
   *also* means the PRD's own inconsistency (`prd.md:139` "24 hours" vs `prd.md:166` "1 calendar day") has never
   been surfaced for a decision — the code silently picked one.

5. **Nothing else can consume it.** Because the rule renders rather than returns, no server code can ask "which
   applications require action?" Sorting flagged cards first, a count in the nav, or the secondary success
   criterion *"the majority of flagged cards receive a note or status change"* (`prd.md:37`) are all currently
   unreachable without duplicating the rule.

6. **It is the cheapest high-value fix in the list.** Unlike #2 and #3 it needs no migration and no schema
   change — it is a pure extraction plus a decision about the clock. It is also the most testable: the rule's
   inputs are exactly two (`prd.md:164`) and `format.ts` already takes an injectable `now` (`format.ts:34`,
   `:41`), so the extracted policy is unit-testable without a DOM, a database, or a browser.

**One decision must be made first, and it is the product owner's, not a refactoring detail:** does the
threshold mean *24 elapsed hours* (`prd.md:139`, `prd.md:172`) or *a calendar-day boundary* (`prd.md:74`,
`prd.md:166`)? The PRD asserts both. Extracting the policy without settling this would freeze the current
accidental answer into a deliberate-looking domain module.

---

## Appendix — Coverage of what already protects the model

Recorded so the ranking is not read as a general indictment. These are genuinely well-modelled:

- **RLS as the system under test** — `AGENTS.md` forbids mocking the Supabase client and forbids asserting
  through `src/lib/services/`; suites assert at the PostgREST row level (`tests/integration/rls-*.test.ts`),
  including a dedicated cross-user attack suite (`tests/integration/rls-application-notes-attack.test.ts`).
  I-01 is the best-defended invariant in the project.
- **The `last_action_at` triggers** — the Core rule's *input* is enforced in the database, not the application,
  and all four behaviours are pinned by integration tests (`tests/integration/lastactionat-trigger.test.ts:22-70`).
- **The archive guard** — `services/applications.ts:79-80` expresses I-05 and I-06 as predicates in the UPDATE
  itself, so the rule cannot be bypassed by a concurrent request. This is the pattern D-04 and D-05 should
  follow.
- **The parser anti-corruption layer** — `recognize()` / `ParseResult` / `resolveStatus` cleanly separate two
  foreign HTML formats from the domain, the server never trusts the client's recognition, and every failure
  mode is an explicit named status rather than an exception.
