---
title: JobTracker — Invariant Guardian Aggregate (Refactoring Plan)
created: 2026-08-08
type: refactor-plan
---

# JobTracker — Invariant Guardian Aggregate

A refactoring **plan**. No production code was modified. Every `file:line` below was read directly in this
pass; nothing is carried over on trust from `context/domain/01-domain-distillation.md`, and where this document
disagrees with that one it says so.

---

## Step 0 — Context discovery

### Requirement sources found

| Document | Path | Weight here |
| --- | --- | --- |
| PRD (`status: draft`) | `context/foundation/prd.md` | Normative. Vision (`:22`), success criteria + guardrails (`:32-42`), US-02/US-03/US-04 (`:60-97`), FR-001…FR-019 (`:104-151`), **Business Logic** narrative (`:160-176`) |
| Business-logic rationale (PL) | `context/foundation/business-logic-notes.md` | Why the follow-up rule is *the* domain decision; names the flag `requiresFollowUp` (`:21`) |
| Follow-up research | `context/foundation/jobtracker-followup-research.md` | Evidence behind the thresholds |
| Roadmap / shape notes / idea | `context/foundation/{roadmap,shape-notes,idea}.md` | Delivery history, superseded scope |
| Test plan | `context/foundation/test-plan.md` | Risk #3 is `lastActionAt` drift (`:44`) — already named as high-severity |
| Agent rules | `AGENTS.md` | Layer boundaries, zod-at-the-boundary, RLS-per-role, ⚠️ ask-first on migrations |
| Prior analysis | `context/domain/01-domain-distillation.md` | Ubiquitous language + discrepancy register (D-01…D-13) |

### Stack and where business logic actually sits

Astro 6 SSR on Cloudflare workerd · React 19 islands · TypeScript 5.9 strict · Supabase (Postgres + RLS) ·
zod 4 · Vitest (node + workers pools) + Playwright (local only).

| Layer | Path | Domain content today |
| --- | --- | --- |
| Persistence | `supabase/migrations/20260526123145_applications_schema.sql` | Entity shape, closed vocabularies as CHECKs (`:21`, `:23-24`), per-user RLS (`:42-61`, `:80-99`), **the two `last_action_at` triggers** (`:118-122`, `:144-157`) |
| Input contracts | `src/lib/validation/applications.ts` | Status/work-mode enums, create/update/note schemas |
| Data access | `src/lib/services/applications.ts`, `src/lib/services/notes.ts` | Query shaping; exactly one enforced business rule (`applications.ts:79-80`) |
| HTTP | `src/pages/api/**` | Auth gate, zod parse, Polish copy; one rule (`archive.ts:37-42`) |
| Anti-corruption | `src/lib/parsers/*` | Portal recognition + HTML → `ParseResult` |
| Pure utilities | `src/lib/format.ts` | **The staleness arithmetic** (`:30-54`) under domain-free names |
| Presentation | `src/components/board/KanbanCard.tsx` | **The thresholds, the per-status dispatch, and the labels** (`:26-37`, `:138-139`) |
| SSR pages | `src/pages/dashboard.astro`, `src/pages/archive*.astro` | Grouping, read-only archive render |

**There is no domain layer.** `AGENTS.md` declares `src/lib/` "pure utilities only (no Supabase, no domain
logic)" and `src/lib/services/` "Supabase queries + domain orchestration". The product's one genuine domain
decision therefore had nowhere to live and settled in a React island. That is the root cause this plan
addresses.

---

## Step 1 — Business invariants

Rules that must always hold, extracted from the documents **and** from the code, with the enforcement status
verified by reading the enforcement site.

Legend: **ENFORCED** (violation impossible) · **PARTIAL** (some paths) · **CLIENT-ONLY** (a browser is the sole
guardian) · **DECLARED** (stated, nothing prevents violation) · **VIOLATED** (code contradicts the rule).

### A. The recommendation rule

| # | Invariant | Source | Status | Enforcement site |
| --- | --- | --- | --- | --- |
| **INV-1** | The actionability verdict is a pure function of exactly two inputs — current status and `lastActionAt` — plus `now`. | `prd.md:164`, `prd.md:166` | **CLIENT-ONLY** | `src/components/board/KanbanCard.tsx:138-139`, called during React render |
| **INV-2** | The verdict is never persisted; it is recomputed on every dashboard load. | `prd.md:166`; `business-logic-notes.md:21` | **ENFORCED** (trivially) | No such column (`migration:13-28`); computed at render |
| **INV-3** | Thresholds are fixed, non-configurable, per status: 1 day / 7 days / 4 business days. | `prd.md:139`, `:141`, `:143`, `:166` | **ENFORCED as scattered literals** | `KanbanCard.tsx:29` (7), `:34` (4 business), `:138` (1) |
| **INV-4** | The *computation* is identical across statuses; only the *label* differs. | `prd.md:168` | **VIOLATED structurally** | Two statuses go through `FOLLOWUP_FLAGS` (`KanbanCard.tsx:26-37`); `Interesujące` is a separate hand-written branch (`KanbanCard.tsx:138`) |
| **INV-5** | `Rozmowa` counts business days only (Mon–Fri, no public holidays in MVP). | `prd.md:143`, `:166` | **ENFORCED** | `src/lib/format.ts:41-54`, weekend skip at `:49` |
| **INV-6** | The verdict is a property of the application, evaluated where the domain lives — not of the viewer's device. | `prd.md:166`; `business-logic-notes.md:21` | **VIOLATED** | Evaluated in a `client:load` island (`dashboard.astro:35`) with `now = new Date()` defaulted in the browser (`format.ts:34`, `:41`) and local-timezone day boundaries (`format.ts:30-32`) |
| **INV-7** | The clock measures elapsed inactivity ("24 hours from the moment of creation"). | `prd.md:139`, `prd.md:172` | **VIOLATED** *(the PRD contradicts itself — see Decision D-A)* | `format.ts:30-39` floors both ends to local midnight; the current behaviour is pinned as intended by `tests/unit/format.test.ts:11-15` |
| **INV-8** | Saving a note or changing status **clears** the flag. | `prd.md:95` (US-04 AC) | **VIOLATED in-session** | `CardNotes.tsx:73-74` updates only the note list; `CardDetailDialog.tsx:6-12` exposes no callback to the board, so `KanbanCard.tsx:139` keeps reading the stale `last_action_at` until a full page load |
| **INV-9** | The flag surfaces passively, without the user requesting a check. | `prd.md:170` | **ENFORCED** | Rendered inline (`KanbanCard.tsx:213-261`) |

### B. The clock the rule depends on

| # | Invariant | Source | Status | Enforcement site |
| --- | --- | --- | --- | --- |
| **INV-10** | `lastActionAt` advances on exactly two events: status change, note save. | `prd.md:164` | **ENFORCED (advance half)** | `migration:118-122` with the `when (old.status is distinct from new.status)` guard at `:121`; `migration:144-157` |
| **INV-11** | Field edits never advance `lastActionAt`. | `prd.md:164`; `business-logic-notes.md:11-13` | **PARTIAL** | Trigger `WHEN` clause + zod stripping unknown keys (`validation/applications.ts:23-36`). No column privilege or trigger rejects a direct write to `last_action_at` |
| **INV-12** | `lastActionAt` is initialised equal to `created_at`. | `prd.md:172` | **ENFORCED** | Both `default now()` (`migration:25-26`); asserted byte-equal at `tests/integration/lastactionat-trigger.test.ts:22-27` |
| **INV-13** | Status change / note save must persist reliably — silent loss corrupts the timing rule. | `prd.md:42` (guardrail) | **PARTIAL** | HTTP failures surface (`KanbanBoard.tsx:85-94`), but nothing verifies the clock actually advanced; a `WHEN`-skipped update returns 200 |

### C. Lifecycle

| # | Invariant | Source | Status | Enforcement site |
| --- | --- | --- | --- | --- |
| **INV-14** | `Rozmowa` is reachable only by transition, never by creation. | `prd.md:122` (FR-007) | **CLIENT-ONLY** | `AddApplicationDialog.tsx:19` (`AddableStatus`) and `KanbanBoard.tsx:169`. The server accepts it: `validation/applications.ts:20` allows all three; `api/applications/index.ts:22-33` passes it through; `migration:24` permits it |
| **INV-15** | Archive only from `Zaaplikowano` / `Rozmowa`. | `prd.md:126` (FR-009) | **ENFORCED** | `.in("status", [...])` inside the UPDATE predicate (`services/applications.ts:80`) + 422 (`api/applications/[id]/archive.ts:40-42`) |
| **INV-16** | An application cannot be archived twice. | Implied FR-009 | **ENFORCED** | `.is("archived_at", null)` (`services/applications.ts:79`) + 422 (`archive.ts:37-39`) |
| **INV-17** | An archived application is fully read-only. | `prd.md:130` (FR-017) | **DECLARED — zero server enforcement** | `updateApplication` has no `archived_at` filter (`services/applications.ts:53-71`); `PATCH` has no guard (`api/applications/[id].ts:41`); `createNote` has no parent-state check (`services/notes.ts:24-40`, `api/applications/[id]/notes/index.ts:67`). Read-only exists only because `archive/[id].astro:108` renders a read-only component |
| **INV-18** | A skipped `Interesujące` card is permanently deleted, no archive entry. | `prd.md:82-83` | **ENFORCED** | Hard delete (`services/applications.ts:126-139`); no archive path from `Interesujące` (INV-15) |
| **INV-19** | Transitions between active columns are unrestricted in both directions. | `prd.md:125` | **ENFORCED by design** | `validation/applications.ts:32`; `KanbanBoard.tsx:59-98` |

### D. Containment and isolation

| # | Invariant | Source | Status | Enforcement site |
| --- | --- | --- | --- | --- |
| **INV-20** | A user's rows are visible/mutable only to that user. | `prd.md:41` (guardrail) | **ENFORCED** | Four RLS policies per table (`migration:42-61`, `:80-99`), hardened in `20260526132205_harden_application_notes_rls.sql`; services also filter `user_id`; suites `tests/integration/rls-*.test.ts` |
| **INV-21** | A note belongs to exactly one application and is reachable only through it. | `prd.md:150` (FR-014); migration header `:126-127` | **PARTIAL** | Cross-*user* blocked by RLS. Cross-*application within one user* is open: `[noteId].ts:18-27` validates `idParam` then never passes it on (`:47`, `:82`), and `updateNote`/`deleteNote` key on `noteId + user_id` only (`services/notes.ts:51-52`, `:66-67`) |
| **INV-22** | `source` is always present and non-empty. | `prd.md:109` | **ENFORCED** | `not null` (`migration:16`) + `z.string().min(1)` (`validation/applications.ts:13`) |
| **INV-23** | Status / work mode are closed vocabularies. | `prd.md:109`, `:122` | **ENFORCED** | CHECKs (`migration:21`, `:23-24`) + zod enums (`validation/applications.ts:3-7`) |
| **INV-24** | A note body is never empty. | Implied FR-013 | **ENFORCED** | `check (length(body) > 0)` (`migration:71`) + `z.string().min(1)` (`validation/applications.ts:44`) |

---

## Step 2 — Classification and selection of #1

Each invariant scored on three axes:

**(a) Centrality** — distance from the stated product purpose. The PRD is unambiguous: the kanban is a mental
model users already have, and the intelligence layer on top *"is the product"* (`prd.md:22`).
**(b) Spread** — how many layers/files it lives in.
**(c) Enforcement** — enforced, declared, or violable.

| Invariant group | (a) Centrality | (b) Spread | (c) Enforcement | Score |
| --- | --- | --- | --- | --- |
| **INV-1/4/6/7/8** — the verdict and its clock semantics | **Maximum** — this *is* the product (`prd.md:22`) | 3 files, 1 layer (a React island + a formatting util); zero server presence | **Client-only, two rules violated (INV-6, INV-7), one broken in-session (INV-8)** | **1st** |
| INV-10/11/13 — what counts as an action | Maximum (the verdict's precondition; `prd.md:42` guardrail) | DB triggers + zod, 2 layers | Advance half enforced; "on a *live* application" half absent | 2nd |
| INV-17 — archived is read-only | High (terminal state) | 0 server layers | Declared only | 3rd |
| INV-14 — `Rozmowa` unreachable by creation | High (`prd.md:122`) | UI type alias only | Client-only | 4th |
| INV-21 — note containment | Medium-High | Routes + services | Partial | 5th |
| INV-20 — data isolation | Guardrail severity, but **Generic** mechanism | 2 migrations, 4 test suites | Best-defended rule in the repo | not a candidate |
| INV-15/16/18/19/22/23/24 | Medium | 1–2 layers each | Enforced | not candidates |

### Selected invariant

> ### INV-CORE — "The prompt tells the truth"
>
> For every live application, the actionability verdict is derived **on the server**, by **one rule**, from
> exactly `(status, lastActionAt, now)` — and `lastActionAt` advances **only** when an action the domain
> recognises lands on an application that is **still live**.

**Why this is one invariant and not two.** The verdict half and the clock half cannot be separated without
making both meaningless. `prd.md:166` defines the verdict as a function of the clock; `prd.md:42` names silent
corruption of that clock as a guardrail *precisely because* it "corrupts the follow-up timing rule
downstream". A correct rule over a corrupted clock produces a confident wrong answer, which is worse than no
answer. The two halves have exactly one consistency boundary — the application — which is what makes an
aggregate the right instrument.

**Why it wins on both axes at once:**

1. **Most central.** Every other subdomain is Supporting or Generic. A spreadsheet replicates the board, the
   notes, and the archive; nothing replicates this rule.
2. **Least enforced.** It has *no server-side representative at all*. The name `requiresAction`
   (`prd.md:166`) / `requiresFollowUp` (`business-logic-notes.md:21`) does not appear anywhere in `src/`; the
   concept exists as two anonymous local consts inside a render function (`KanbanCard.tsx:138-139`). Two of
   its sub-rules are outright violated (INV-6, INV-7), one is broken until page reload (INV-8), and its
   clock accepts writes on records the domain froze (INV-17).
3. **Nothing else can consume it.** Because the rule renders instead of returning, no server code can answer
   "which applications require action?" The secondary success criterion at `prd.md:37` ("the majority of
   flagged cards receive a note or status change") is unmeasurable for the same reason.

Runner-up rejected: INV-20 (data isolation) is a guardrail, but it is the best-enforced rule in the project
and its mechanism is stock Postgres — central by severity, not by product identity.

### Decision owed before implementation — D-A

The PRD asserts two incompatible clock semantics:

| Reading | Sources | Behaviour |
| --- | --- | --- |
| **Elapsed duration** — 24 h / 7×24 h | `prd.md:139` ("1 day (24 hours)"), `prd.md:172` ("after 24 hours of inactivity"), `prd.md:174` ("The 24-hour clock restarts") | A card created Mon 23:00 flags Tue 23:00 |
| **Calendar-day boundary** | `prd.md:74` ("1 calendar day"), `prd.md:166` ("1 calendar day… 7 calendar days") | A card created Mon 23:00 flags Tue 00:00 — after 1 hour |

The code silently picked calendar boundaries (`format.ts:30-39`) and a unit test froze that choice as
deliberate (`tests/unit/format.test.ts:11-15`, *"even with under 2 hours elapsed"*). **This plan does not
resolve D-A** — it is the product owner's call. What the plan does is make the choice a single named constant
in one file instead of an accident distributed across a formatting helper.

**Recommendation: elapsed duration.** It matches the two most specific statements (`prd.md:139`, `:172`), it
needs no timezone to be well-defined, and it is the only reading under which a server-computed verdict and a
client-viewed verdict can never disagree. Business days (INV-5) still require a timezone for weekend
determination — anchor to `Europe/Warsaw`, the product's stated locale, and record it.

---

## Step 3 — Diagnosis of INV-CORE

### 3.1 Where the rule is enforced today, layer by layer

| Layer | Verdict half | Clock half |
| --- | --- | --- |
| **Database** | Nothing — correct, INV-2 forbids persisting it | `migration:118-122` (status change), `migration:144-157` (note insert). **Neither checks `archived_at`** — `migration:135-137` updates by `id` alone |
| **Services** | Nothing | `services/applications.ts:79-80` guards state on *archive only*; `updateApplication` (`:53-71`) and `createNote` (`services/notes.ts:24-40`) guard nothing |
| **API routes** | Nothing | `api/applications/[id]/archive.ts:33-42` maps state failures to 422 — the only route that does. `api/applications/[id].ts:41` and `api/applications/[id]/notes/index.ts:67` pass straight through |
| **SSR page** | Nothing — `dashboard.astro:18-31` fetches raw rows and groups them | n/a |
| **React island** | **SOLE GUARDIAN** — `KanbanCard.tsx:26-37`, `:138-139` | Optimistically *fakes* the clock: `KanbanBoard.tsx:72-77` and `:106-111` write a locally generated `last_action_at` into state |
| **Tests** | `tests/unit/format.test.ts` pins the arithmetic (and the disputed semantics) | `tests/integration/lastactionat-trigger.test.ts:22-70` pins all four trigger behaviours — on live rows only |

**Summary: the verdict has zero server-side enforcement points. The clock has two, and both are blind to the
archived state.**

### 3.2 Failure modes, with the exact code path

**F-1 — The flag fires up to ~24 h early.**
`format.ts:34-39` floors both timestamps to local midnight (`startOfLocalDay`, `:30-32`) and compares whole
days. A card created Monday 23:00 is flagged at Tuesday 00:00. The 7-day threshold can fire after 6 days +
1 hour. Pinned as intended by `tests/unit/format.test.ts:11-15`. *(Blocked on D-A.)*

**F-2 — The device decides the domain verdict.**
`isStale`/`isStaleBusinessDays` default `now = new Date()` (`format.ts:34`, `:41`) and derive day boundaries
from local getters (`format.ts:30-32`), executing inside a `client:load` island (`dashboard.astro:35`). A user
who travels, or whose clock is skewed, sees a different verdict for identical stored state. Directly
contradicts `prd.md:166` and `business-logic-notes.md:21`.

**F-3 — Saving a note does not clear the flag (INV-8).**
`CardNotes.handleAdd` posts the note and updates only its own list (`CardNotes.tsx:73-74`).
`CardDetailDialog` receives `application` as an immutable prop and exposes no update callback
(`CardDetailDialog.tsx:6-12`, `:70`). `KanbanCard.tsx:139` therefore keeps evaluating the pre-note
`last_action_at`. The DB clock advanced (`migration:154-157`); the screen did not. `prd.md:95` requires the
flag to clear.

**F-4 — One rule, two implementations (INV-4).**
`Zaaplikowano` and `Rozmowa` route through the table-driven `FOLLOWUP_FLAGS` (`KanbanCard.tsx:26-37`);
`Interesujące` is a hand-written branch with a different shape (`KanbanCard.tsx:138`). `prd.md:168` states the
computation is identical. A threshold recalibration — which `prd.md:140` explicitly anticipates — requires two
edits in two shapes in one JSX file.

**F-5 — A frozen record's clock still moves (INV-17 → INV-CORE).**
Two live paths:
- `POST /api/applications/{archived-id}/notes` → `notes/index.ts:67` → `services/notes.ts:24-40` (no parent
  state check; RLS INSERT policy checks only `user_id`, `migration:85-88`) → AFTER-INSERT trigger
  (`migration:144-157`) → `bump_application_last_action_at` updates by `id` alone (`migration:135-137`).
- `PATCH /api/applications/{archived-id}` with `{status}` → `[id].ts:41` → `services/applications.ts:53-71`
  (no `archived_at` filter) → BEFORE-UPDATE trigger (`migration:118-122`).

Both return **200**. The mutated status is then displayed as current at `archive/[id].astro:96-97`.

**F-6 — The aggregate root does not mediate its children (INV-21).**
`[noteId].ts:18-27` validates `idParam`, then calls `updateNote(supabase, noteIdParam, …)` (`:47`) and
`deleteNote(supabase, noteIdParam, …)` (`:82`) — `idParam` is discarded. `services/notes.ts:51-52` and
`:66-67` key on `id + user_id`. So `PATCH /api/applications/<A>/notes/<note-of-B>` succeeds when A and B belong
to the same user, including editing an archived application's history through a live card's URL.

**F-7 — A card can be born in `Rozmowa` (INV-14).**
`applicationCreateSchema.status` accepts all three values (`validation/applications.ts:20`);
`api/applications/index.ts:22-33` passes it to the insert; `migration:24` permits it. Only
`AddApplicationDialog.tsx:19` excludes it. Such a card starts its life under the business-day threshold in a
stage the domain says is recruiter-initiated.

**F-8 — The error is swallowed and the user is told the opposite (fail-fast violation).**
```
src/pages/dashboard.astro:26-30
  } catch (err) {
    // RLS or transient error — render an empty board. Surfacing is out of scope for S-02.
    console.error("Dashboard load failed", err);
  }
```
A failed load renders three empty columns and no error. The user's takeaway is *"nothing requires action"* —
the exact inverse of an unknown verdict. This is the single most important fail-fast defect for INV-CORE:
the product's one job silently returns a false negative.

**F-9 — Nothing verifies the clock actually advanced (INV-13).**
`updateApplication` (`services/applications.ts:53-71`) returns 200 on any matched row. If the status sent
equals the stored status, the trigger's `WHEN` guard (`migration:121`) skips, no bump occurs, and the API
still reports success. `KanbanBoard.tsx:76` then displays a locally invented `last_action_at` that the
database never wrote.

### 3.3 Diagnosis summary

| Symptom | Root cause |
| --- | --- |
| F-1, F-2, F-4 | The rule has no owner; its decisions were made inside a formatting helper and a render function |
| F-3, F-9 | The client holds a copy of the clock and computes the verdict from it |
| F-5, F-6, F-7 | The root never mediates: no load-check-save path exists, so preconditions have nowhere to be expressed |
| F-8 | No domain error type exists, so a failure has no representation other than a log line |

---

## Step 4 — Design of the guardian aggregate

### 4.1 Boundary

**Aggregate root: `Application`.** Contained entity: `ApplicationNote`. Evidence the boundary is real: notes
are addressed only through the parent (`src/pages/api/applications/[id]/notes/...`), the FK cascades
(`migration:69`), a note insert mutates parent state (`migration:144-157`), and the hardened RLS policy
requires the parent to belong to the same user.

**Outside the boundary:** `User` (Supabase Auth, Generic), `ParsedOffer` (value object, anti-corruption layer
— already healthy, untouched by this plan).

### 4.2 New layer and where it goes

```
src/lib/domain/                      ← NEW: pure domain model, zero I/O, zero React
  application.ts                     ← the aggregate root + its errors
  actionability.ts                   ← the verdict value object + FollowUpPolicy
  clock.ts                           ← elapsed/business-day arithmetic (moved out of format.ts)
  errors.ts                          ← DomainError hierarchy
src/lib/services/
  application-repository.ts          ← NEW: loads/saves the aggregate
```

> ⚠️ **`AGENTS.md` amendment required.** The current rule reads *"`src/lib/` — pure utilities only (no
> Supabase, no domain logic)"*. `src/lib/domain/` satisfies "no Supabase" but violates "no domain logic". The
> boundary should be restated as three tiers: `src/lib/` pure utilities · `src/lib/domain/` pure domain model
> (no I/O, no framework imports) · `src/lib/services/` repositories and adapters. Listed in Step 5.4.

### 4.3 Domain errors — fail-fast, named, never silent

```ts
// src/lib/domain/errors.ts
export type DomainErrorCode =
  | "APPLICATION_ARCHIVED"
  | "APPLICATION_ALREADY_REJECTED"
  | "REJECT_STAGE_INVALID"
  | "INTERVIEW_STAGE_NOT_CREATABLE"
  | "NOTE_FOREIGN_TO_APPLICATION"
  | "ACTION_CLOCK_NOT_ADVANCED";

export abstract class DomainError extends Error {
  abstract readonly code: DomainErrorCode;
  abstract readonly httpStatus: 409 | 422 | 500;
  abstract readonly userMessage: string; // Polish — the only copy the client sees
}

export class ArchivedApplicationIsImmutableError extends DomainError {
  readonly code = "APPLICATION_ARCHIVED";
  readonly httpStatus = 409;
  readonly userMessage = "Aplikacja jest w archiwum — nie można jej zmieniać.";
}

export class InterviewStageNotCreatableError extends DomainError {
  readonly code = "INTERVIEW_STAGE_NOT_CREATABLE";
  readonly httpStatus = 422;
  readonly userMessage = 'Do kolumny „Rozmowa" można przenieść ofertę tylko z „Zaaplikowano".';
}

export class NoteForeignToApplicationError extends DomainError {
  readonly code = "NOTE_FOREIGN_TO_APPLICATION";
  readonly httpStatus = 404; // 404-collapse: never confirm existence outside the aggregate
  readonly userMessage = "Nie znaleziono notatki.";
}

export class ActionClockNotAdvancedError extends DomainError {
  readonly code = "ACTION_CLOCK_NOT_ADVANCED";
  readonly httpStatus = 500;
  readonly userMessage = "Nie udało się zapisać zmiany. Spróbuj ponownie.";
}
// … APPLICATION_ALREADY_REJECTED (409), REJECT_STAGE_INVALID (422) reuse the existing
//    Polish copy at api/applications/[id]/archive.ts:38 and :41.
```

`NoteForeignToApplicationError` returning 404 rather than 403 preserves the existing 404-collapse rule the
test plan calls load-bearing (`context/foundation/test-plan.md:220`).

### 4.4 The verdict value object

```ts
// src/lib/domain/actionability.ts
export type PromptKind = "decision" | "follow-up";

export interface Actionability {
  readonly required: boolean;
  readonly kind: PromptKind | null;
  readonly label: string | null;       // Polish, moved verbatim from KanbanCard.tsx:30/:35/:233
  readonly evaluatedAt: string;        // ISO — the server `now` used, so the client can never re-derive
}

// ONE table. One shape. All three statuses. (Closes INV-4 / F-4.)
const POLICY: Record<ApplicationStatus, ThresholdSpec> = {
  Interesujące:  { amount: 1, unit: "days",          kind: "decision",  label: "Zdecyduj — aplikujesz?" },
  Zaaplikowano:  { amount: 7, unit: "days",          kind: "follow-up", label: "Czas na follow-up z rekruterem" },
  Rozmowa:       { amount: 4, unit: "business-days", kind: "follow-up", label: "Czas na follow-up po rozmowie" },
};

export const NOT_REQUIRED = (now: Date): Actionability => ({ required: false, kind: null, label: null, evaluatedAt: now.toISOString() });

export function evaluate(status: ApplicationStatus, lastActionAt: string, now: Date): Actionability {
  const spec = POLICY[status];
  const elapsed = spec.unit === "business-days"
    ? businessDaysBetween(lastActionAt, now, BUSINESS_TZ)   // BUSINESS_TZ = "Europe/Warsaw"
    : elapsedDays(lastActionAt, now);                       // ← D-A switch lives here, and only here
  return elapsed >= spec.amount
    ? { required: true, kind: spec.kind, label: spec.label, evaluatedAt: now.toISOString() }
    : NOT_REQUIRED(now);
}
```

Everything D-A touches is `elapsedDays` in `src/lib/domain/clock.ts` — one function, one decision, one test
file. INV-2 is preserved: nothing here is stored.

### 4.5 The aggregate root

```ts
// src/lib/domain/application.ts
export class Application {
  private constructor(
    private state: ApplicationState,          // mirrors the row
    private notes: ApplicationNote[],         // loaded lazily; [] when not needed
    private intents: PersistIntent[] = [],    // what save() must apply
  ) {}

  // ── construction ────────────────────────────────────────────────────────
  static rehydrate(row: ApplicationRow, notes: ApplicationNote[] = []): Application;

  /** Creation. Precondition: INV-14 — Rozmowa is recruiter-initiated. */
  static open(input: NewApplication, ownerId: string): Application {
    if (input.status === "Rozmowa") throw new InterviewStageNotCreatableError();
    // last_action_at / created_at are NOT set here — the DB defaults own INV-12 (migration:25-26)
    return new Application({ ...input, user_id: ownerId }, [], [{ kind: "insert" }]);
  }

  // ── queries ─────────────────────────────────────────────────────────────
  get isLive(): boolean { return this.state.archived_at === null; }

  /** THE ONLY PLACE the verdict is computed. INV-1, INV-2, INV-3, INV-4, INV-5, INV-6. */
  actionability(now: Date): Actionability {
    if (!this.isLive) return NOT_REQUIRED(now);        // archived cards are never actionable
    return evaluate(this.state.status, this.state.last_action_at, now);
  }

  // ── commands (every one begins with a precondition) ─────────────────────

  /** INV-10 + INV-17. Advances the clock. */
  changeStatus(next: ApplicationStatus): void {
    this.assertLive();
    if (next === this.state.status) return;            // matches migration:121 — no-op, no bump
    this.state.status = next;
    this.intents.push({ kind: "status", to: next, expectsClockBump: true });
  }

  /** INV-11 + INV-17. Must NOT advance the clock — the domain rule that makes the verdict trustworthy. */
  editDetails(patch: ApplicationDetailsPatch): void {
    this.assertLive();
    if ("status" in patch) throw new Error("status must go through changeStatus()"); // programmer error, not domain
    Object.assign(this.state, patch);
    this.intents.push({ kind: "details", patch, expectsClockBump: false });
  }

  /** INV-10 + INV-17 + INV-21. Advances the clock — including in Interesujące (prd.md:174). */
  appendNote(body: string): void {
    this.assertLive();
    this.intents.push({ kind: "note-append", body, expectsClockBump: true });
  }

  /** INV-21 — the root mediates. Closes F-6. Never advances the clock (no trigger on UPDATE). */
  editNote(noteId: string, body: string): void {
    this.assertLive();
    this.requireOwnNote(noteId);
    this.intents.push({ kind: "note-edit", noteId, body, expectsClockBump: false });
  }

  removeNote(noteId: string): void {
    this.assertLive();
    this.requireOwnNote(noteId);
    this.intents.push({ kind: "note-remove", noteId, expectsClockBump: false });
  }

  /** INV-15 + INV-16. */
  reject(): void {
    if (!this.isLive) throw new ApplicationAlreadyRejectedError();
    if (this.state.status !== "Zaaplikowano" && this.state.status !== "Rozmowa")
      throw new RejectStageInvalidError();
    this.intents.push({ kind: "reject", expectsClockBump: false });
  }

  // ── preconditions ───────────────────────────────────────────────────────
  private assertLive(): void {
    if (!this.isLive) throw new ArchivedApplicationIsImmutableError();   // INV-17 — closes F-5
  }
  private requireOwnNote(noteId: string): void {
    if (!this.notes.some((n) => n.id === noteId)) throw new NoteForeignToApplicationError();
  }
}
```

No method mutates and reports success on a violation. Every illegal operation raises before any intent is
recorded, so nothing reaches the repository.

### 4.6 Repository — one aggregate in, one aggregate out

```ts
// src/lib/services/application-repository.ts
export interface ApplicationRepository {
  load(id: string, userId: string): Promise<Application | null>;          // includes notes
  loadLiveBoard(userId: string): Promise<Application[]>;                  // one query, no notes
  loadArchived(userId: string): Promise<Application[]>;
  save(app: Application): Promise<Application>;                           // applies intents, returns DB truth
}
```

`save()` translates each intent into **one predicate-carrying statement**, so the precondition is re-checked
by the database in the same statement that writes — no read-then-write race:

| Intent | Statement | Guard carried in the predicate | Migration needed |
| --- | --- | --- | --- |
| `status` / `details` | `UPDATE … .eq(id).eq(user_id).is("archived_at", null)` | INV-17 | no |
| `note-edit` / `note-remove` | `UPDATE/DELETE application_notes … .eq(id, noteId).eq("application_id", appId).eq(user_id)` | INV-21 | no |
| `reject` | existing predicate at `services/applications.ts:79-80` | INV-15, INV-16 | no |
| `insert` | `INSERT` with status narrowed by zod | INV-14 | optional backstop |
| **`note-append`** | **`rpc("append_application_note", …)`** | **INV-17 — see below** | **yes ⚠️** |

**Atomicity — why `note-append` is different.** An INSERT carries no WHERE clause, so "check the parent is
live, then insert" is two round trips and a genuine TOCTOU window: an archive request landing between them
produces a note on a frozen record *and* a bumped clock. The guard and the write must be one transaction:

```sql
-- supabase/migrations/<ts>_guard_notes_on_archived_applications.sql   ⚠️ ask first
create or replace function public.append_application_note(app_id uuid, note_body text)
returns public.application_notes
language plpgsql
security invoker            -- RLS on application_notes still applies (INV-20 untouched)
set search_path = ''
as $$
declare
  parent public.applications%rowtype;
  inserted public.application_notes%rowtype;
begin
  select * into parent from public.applications
   where id = app_id and user_id = auth.uid()
     for update;                                     -- lock the root for the transaction
  if not found then
    raise exception 'APPLICATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  if parent.archived_at is not null then
    raise exception 'APPLICATION_ARCHIVED' using errcode = 'P0001';   -- INV-17, fail-fast
  end if;
  insert into public.application_notes (application_id, user_id, body)
       values (app_id, auth.uid(), note_body)
    returning * into inserted;                       -- AFTER-INSERT trigger bumps the clock, same tx
  return inserted;
end;
$$;
```

The existing bump trigger (`migration:144-157`) is unchanged and still runs inside this transaction — the
insert and the clock advance remain atomic, as they already are today. The RPC only adds the missing
precondition, under a row lock.

**Clock verification (closes F-9).** Every write returns the row (`.select("*")`). `save()` compares:

```ts
if (intent.expectsClockBump && returned.last_action_at === before.last_action_at) {
  throw new ActionClockNotAdvancedError();   // 500, no 200-with-stale-clock
}
```

This is the guardrail at `prd.md:42` made executable: a status change or note save that did not move the clock
is a failed operation, not a successful one.

### 4.7 Thin routes — parse → aggregate → map

```ts
// src/pages/api/applications/[id].ts (after)
export const prerender = false;

export const PATCH: APIRoute = async (context) => {
  const user = context.locals.user;
  if (!user) return jsonResponse(401, { error: "Brak autoryzacji." });

  const id = context.params.id;
  if (!id || !uuidSchema.safeParse(id).success) return jsonResponse(400, { error: "Nieprawidłowy identyfikator." });

  const parsed = applicationUpdateSchema.safeParse(await readJson(context.request));
  if (!parsed.success) return jsonResponse(422, { errors: formatApplicationErrors(parsed.error) });

  const repo = makeApplicationRepository(createClient(context.request.headers, context.cookies));

  try {
    const app = await repo.load(id, user.id);
    if (!app) return jsonResponse(404, { error: "Nie znaleziono aplikacji." });

    const { status, ...details } = parsed.data;
    if (status) app.changeStatus(status);                       // ← preconditions live here
    if (Object.keys(details).length > 0) app.editDetails(details);

    const now = new Date();                                     // server clock — INV-6
    const saved = await repo.save(app);
    return jsonResponse(200, {
      application: saved.toRow(),
      actionability: saved.actionability(now),                  // ← client never recomputes
    });
  } catch (err) {
    return toHttpResponse(err);                                 // DomainError → status + Polish copy
  }
};
```

```ts
// src/lib/http.ts (addition)
export function toHttpResponse(err: unknown): Response {
  if (err instanceof DomainError) return jsonResponse(err.httpStatus, { error: err.userMessage, code: err.code });
  console.error("Unhandled error", err);
  return jsonResponse(500, { error: "Wystąpił nieoczekiwany błąd." });
}
```

### 4.8 Execution moves from the client to the server

```
BEFORE                                   AFTER
──────                                   ─────
dashboard.astro  → raw ApplicationRow[]  dashboard.astro
       ↓                                    → repo.loadLiveBoard(user.id)
KanbanBoard (island)                        → app.actionability(new Date())   ← server clock
       ↓                                    → ApplicationCardView[] { row, actionability }
KanbanCard.tsx:138-139                            ↓
  isStale(...)  ← device clock            KanbanBoard (island)
  FOLLOWUP_FLAGS.find(...)                      ↓
  → renders the verdict                   KanbanCard → renders view.actionability.label
                                                     (no thresholds, no clock, no import from format.ts)
```

- `dashboard.astro` **must not swallow** the load error (F-8). On failure it renders an explicit Polish error
  state — never three empty columns.
- After a mutation, `KanbanBoard` replaces the card's verdict with the `actionability` returned by the API
  instead of recomputing. `CardDetailDialog` gains an `onApplicationChanged(view)` callback so a saved note
  propagates to the board — closing F-3 without any client-side rule.
- While a mutation is in flight, the card shows **no** verdict rather than a guessed one. INV-CORE says the
  server owns the answer; "unknown" is an honest intermediate state, a client-computed guess is not.
- `isStale` and `isStaleBusinessDays` are deleted from `src/lib/format.ts` (`:30-54`); `KanbanCard.tsx:5` is
  their only production caller. `formatRelative` and `parseSourceHref` stay.

---

## Step 5 — Before/after, phases, tests, names

### 5.1 Before → after, per current rule location

| # | Location today | Today | After |
| --- | --- | --- | --- |
| 1 | `KanbanCard.tsx:26-37` (`FOLLOWUP_FLAGS`, 2 of 3 statuses) | Threshold table in a render module | Deleted. `POLICY` in `src/lib/domain/actionability.ts`, all three statuses, one shape |
| 2 | `KanbanCard.tsx:138` (`Interesujące` branch) | Second, differently-shaped implementation | Deleted (INV-4 satisfied structurally) |
| 3 | `KanbanCard.tsx:139` (`followUp` lookup) | Verdict computed at render, device clock | Deleted. Card reads `view.actionability` |
| 4 | `format.ts:30-39` (`isStale`) | Calendar-midnight arithmetic in a formatting util | Moved to `domain/clock.ts` as `elapsedDays`, semantics settled by D-A |
| 5 | `format.ts:41-54` (`isStaleBusinessDays`) | Local-timezone weekend skip | Moved to `domain/clock.ts` as `businessDaysBetween(…, BUSINESS_TZ)` |
| 6 | `dashboard.astro:18-31` | Fetch rows, group, swallow errors | `repo.loadLiveBoard` → `actionability(now)` → view DTOs; **error surfaced, never an empty board** |
| 7 | `KanbanBoard.tsx:72-77`, `:106-111` | Optimistic locally-invented `last_action_at` | Optimistic *position* only; verdict replaced by the API's `actionability` on response |
| 8 | `CardNotes.tsx:73-84` | Note added, parent card untouched (F-3) | Response propagates via `onApplicationChanged` → board verdict refreshes |
| 9 | `services/applications.ts:53-71` (`updateApplication`) | No `archived_at` filter | `.is("archived_at", null)` in the predicate; zero rows → `ArchivedApplicationIsImmutableError` |
| 10 | `services/notes.ts:24-40` (`createNote`) | Inserts against any parent | `rpc("append_application_note")` — parent locked and checked in one transaction |
| 11 | `services/notes.ts:42-60`, `:62-75` | Key on `noteId + user_id` | `.eq("application_id", appId)` added; root mediates (INV-21) |
| 12 | `api/applications/[id]/notes/[noteId].ts:47`, `:82` | `idParam` validated then discarded | `idParam` passed to `repo.load`, note reached through the aggregate |
| 13 | `api/applications/[id].ts:41` | Straight passthrough to the service | Load → command → save → map domain error |
| 14 | `api/applications/index.ts:22-33` | Accepts `status: "Rozmowa"` | `applicationCreateSchema.status` narrowed to the two addable values; `Application.open` throws as a second gate |
| 15 | `validation/applications.ts:20` | `applicationStatusSchema.default("Interesujące")` | `z.enum(["Interesujące","Zaaplikowano"]).default("Interesujące")` (INV-14) |
| 16 | `api/applications/[id]/archive.ts:28-42` | Correct, but the rule is spelled inline | Unchanged behaviour; rule relocates to `Application.reject()`; the route maps the error |
| 17 | `migration:135-137` (`bump_application_last_action_at`) | Updates by `id` alone | Unchanged (the RPC guard makes it unreachable for archived parents); optional `where archived_at is null` backstop |
| 18 | `AddApplicationDialog.tsx:19`, `KanbanBoard.tsx:169` | Sole INV-14 guardian | Kept as UX affordance — no longer load-bearing |

### 5.2 Phases

The project has an existing Vitest runner with two pools, an RLS-as-SUT discipline, and a `/10x-tdd` workflow.
Phases 1, 2, 4 and 5 are **test-first** (pure functions and server-observable HTTP behaviour). Phases 3 and 6
are not — a repository is verified through integration tests written alongside it, and the UI change is
verified by deletion plus existing E2E.

| Phase | Content | Test-first? | Gate | Migration? |
| --- | --- | --- | --- | --- |
| **0 — Decide** | Resolve **D-A** (elapsed vs calendar) and confirm `BUSINESS_TZ = "Europe/Warsaw"`. Amend `prd.md:139`/`:172` or `prd.md:74`/`:166` so the PRD stops contradicting itself. Amend `AGENTS.md` for `src/lib/domain/`. | n/a | PRD self-consistent | no |
| **1 — Clock** | `src/lib/domain/clock.ts`: `elapsedDays`, `businessDaysBetween`. Port the surviving vectors from `tests/unit/format.test.ts`; **rewrite the D-A-dependent ones** (`:11-15`, `:17-21`, `:23-27`) to the decided semantics. | **yes** | `npm test` | no |
| **2 — Verdict** | `src/lib/domain/actionability.ts` — `POLICY`, `evaluate`, `Actionability`. One table, three statuses (INV-4). | **yes** | `npm test` | no |
| **3 — Aggregate + repository** | `domain/application.ts`, `domain/errors.ts`, `services/application-repository.ts`. Predicate-guarded statements; `expectsClockBump` verification. | tests alongside | `npm run typecheck && npm test` | no |
| **4 — Routes** | Rewrite the five routes to load → command → save → map. Add `toHttpResponse` to `src/lib/http.ts`. Narrow `applicationCreateSchema.status`. | **yes** (HTTP suite) | `npm test` | no |
| **5 — DB guard** ⚠️ | `append_application_note` RPC + optional `archived_at is null` backstop on the bump function. Requires approval per `AGENTS.md`. | **yes** (integration suite) | `npm run db:push`, `npm run db:types`, `npm test` | **yes** |
| **6 — Server-side verdict + UI** | `dashboard.astro` computes and passes `ApplicationCardView[]`; **stop swallowing the load error**; delete `FOLLOWUP_FLAGS`, `showPrompt`, `followUp`, and `isStale`/`isStaleBusinessDays` from `format.ts`; add `onApplicationChanged` through `CardDetailDialog` → `CardNotes`. | no | `npm run typecheck && npm run lint && npm test`, then `npm run test:e2e` | no |

Phases 1–4 ship without any schema change. Phase 5 is the only ⚠️ ask-first item and is independently
valuable; if it is declined, F-5's note path stays open and that must be recorded, not quietly dropped.

**Ordering constraint:** Phase 6 must not land before Phase 4, or the board will read a verdict the API does
not yet return.

### 5.3 Test cases for INV-CORE

**Unit — `tests/unit/domain/clock.test.ts`** (node pool)

| # | Case | Expected (under the *elapsed* recommendation) |
| --- | --- | --- |
| U-1 | 23 h 59 m elapsed, threshold 1 day | not stale |
| U-2 | 24 h 00 m elapsed, threshold 1 day | stale (boundary inclusive) |
| U-3 | Mon 23:00 → Tue 00:30, threshold 1 day | **not stale** — the F-1 regression vector |
| U-4 | 6 d 23 h elapsed, threshold 7 days | not stale |
| U-5 | Future `lastActionAt` | not stale, no throw |
| U-6 | Fri 09:00 anchor → following Tue, 4 business days | not stale (2 business days — `prd.md:143` vector) |
| U-7 | Fri 09:00 anchor → following Thu, 4 business days | stale |
| U-8 | Sat anchor → Wed / Thu, 4 business days | not stale / stale |
| U-9 | Same instant supplied as two different device timezones | identical result (F-2) |

**Unit — `tests/unit/domain/actionability.test.ts`**

| # | Case | Expected |
| --- | --- | --- |
| A-1 | `Interesujące`, over threshold | `{ required: true, kind: "decision", label: "Zdecyduj — aplikujesz?" }` |
| A-2 | `Zaaplikowano`, over threshold | `kind: "follow-up"`, label `"Czas na follow-up z rekruterem"` |
| A-3 | `Rozmowa`, over threshold | `kind: "follow-up"`, label `"Czas na follow-up po rozmowie"` |
| A-4 | Each status, one unit under threshold | `required: false`, `kind: null` |
| A-5 | Archived application, any elapsed time | `required: false` — archived is never actionable |
| A-6 | All three statuses resolve through the same `POLICY` entry point | no status has a bespoke branch (INV-4) |

**Unit — `tests/unit/domain/application.test.ts`** — preconditions, no I/O

| # | Operation | Expected |
| --- | --- | --- |
| P-1 | `open({ status: "Rozmowa" })` | throws `InterviewStageNotCreatableError` (INV-14) |
| P-2 | `open({ status: "Interesujące" \| "Zaaplikowano" })` | succeeds |
| P-3 | `changeStatus` on archived | throws `ArchivedApplicationIsImmutableError` (INV-17) |
| P-4 | `editDetails` on archived | throws |
| P-5 | `appendNote` on archived | throws |
| P-6 | `editNote`/`removeNote` on archived | throws |
| P-7 | `editNote(noteId not in aggregate)` | throws `NoteForeignToApplicationError` (INV-21) |
| P-8 | `changeStatus(sameStatus)` | no intent recorded, no clock bump (mirrors `migration:121`) |
| P-9 | `editDetails` | intent has `expectsClockBump: false` (INV-11) |
| P-10 | `changeStatus` / `appendNote` | intent has `expectsClockBump: true` (INV-10) |
| P-11 | `reject()` from `Interesujące` | throws `RejectStageInvalidError` (INV-15) |
| P-12 | `reject()` on already-archived | throws `ApplicationAlreadyRejectedError` (INV-16) |
| P-13 | `reject()` from `Zaaplikowano`/`Rozmowa` | succeeds |
| P-14 | any thrown precondition | aggregate state unchanged, `intents` empty — nothing partially applied |

**Integration — `tests/integration/archived-immutability.test.ts`** (node pool, PostgREST level, real RLS, no
mocks per `AGENTS.md`)

| # | Case | Expected |
| --- | --- | --- |
| I-1 | Archive an application, then insert a note via the RPC | rejected `P0001`; `application_notes` row count unchanged |
| I-2 | …then re-read the parent | `last_action_at` **byte-identical** to the pre-attempt value (the core corruption vector, F-5) |
| I-3 | Archive, then `UPDATE status` through the guarded predicate | zero rows affected; `last_action_at` unchanged |
| I-4 | Note append on a **live** parent via the RPC | note inserted **and** `last_action_at` advanced — atomic, same transaction |
| I-5 | RPC called with another user's `app_id` | fails; no row inserted (INV-20 unaffected) |
| I-6 | `UPDATE application_notes` with a mismatched `application_id` predicate | zero rows (INV-21) |
| I-7 | Existing `lastactionat-trigger.test.ts:22-70` behaviours | still green — the four trigger invariants are untouched |

**HTTP — `tests/http/actionability.test.ts`, `archived-application.test.ts`**

| # | Request | Expected |
| --- | --- | --- |
| H-1 | `GET`-equivalent board load with a card 8 days idle in `Zaaplikowano` | response carries `actionability.required === true`, `kind: "follow-up"` |
| H-2 | `PATCH /api/applications/{id}` `{status}` | 200, body contains a **recomputed** `actionability` |
| H-3 | `POST /api/applications/{id}/notes` on a flagged card | 201, response `actionability.required === false` (INV-8 / F-3) |
| H-4 | `PATCH /api/applications/{archived}` `{status}` | **409** `APPLICATION_ARCHIVED`, Polish copy — not 200 |
| H-5 | `POST /api/applications/{archived}/notes` | **409** `APPLICATION_ARCHIVED` — not 201 |
| H-6 | `POST /api/applications` `{status: "Rozmowa"}` | **422** — not 201 (INV-14 / F-7) |
| H-7 | `PATCH /api/applications/<A>/notes/<note-of-B>` (same user) | **404** exactly (`toBe(404)`, 404-collapse) — not 200 (F-6) |
| H-8 | `DELETE /api/applications/<A>/notes/<note-of-B>` | **404** exactly |
| H-9 | `PATCH` a field-only edit | 200; `last_action_at` unchanged; `actionability` unchanged (INV-11) |
| H-10 | `POST /api/applications/{id}/archive` from `Interesujące` | 422, existing Polish copy preserved (`archive.ts:41`) |

**E2E — `tests/e2e/`** (local only, not a CI gate)

| # | Scenario | Expected |
| --- | --- | --- |
| E-1 | Flagged card in `Zaaplikowano`, open detail, save a note, close | flag disappears **without a page reload** (F-3) |
| E-2 | Board with a device clock set 2 days ahead | verdict matches the server, not the device (F-2) |
| E-3 | Existing `followup-flag.spec.ts`, `rozmowa-followup-flag.spec.ts`, `decision-prompt-*.spec.ts` | still green against server-supplied verdicts |

**Negative-control (fail-fast) checks** — each of these must fail loudly, never log-and-continue:
`dashboard.astro` repository failure → explicit Polish error state, never an empty board (F-8);
`expectsClockBump` unmet → `ActionClockNotAdvancedError` → 500, never 200 (F-9).

### 5.4 Load-bearing names to register

The project has no glossary file; the ubiquitous-language table in
`context/domain/01-domain-distillation.md` (Step 1) is the de facto register, and `AGENTS.md` is the
enforcement surface. Register there:

| Name | Kind | Where it lives | Replaces / resolves |
| --- | --- | --- | --- |
| `Application` (aggregate root) | Aggregate | `src/lib/domain/application.ts` | scattered service functions |
| `ApplicationNote` (contained entity) | Entity | same | free-floating `application_notes` access |
| **`Actionability`** | Value object | `src/lib/domain/actionability.ts` | resolves the `requiresAction` (`prd.md:166`) vs `requiresFollowUp` (`business-logic-notes.md:21`) doc split — **one name wins**; the anonymous `showPrompt`/`followUp` (`KanbanCard.tsx:138-139`) disappear |
| `PromptKind` = `"decision" \| "follow-up"` | Type | same | encodes `prd.md:168` |
| `FollowUpPolicy` / `POLICY` | Policy table | same | `FOLLOWUP_FLAGS` (`KanbanCard.tsx:26-37`) + the `Interesujące` branch |
| `elapsedDays`, `businessDaysBetween`, `BUSINESS_TZ` | Domain clock | `src/lib/domain/clock.ts` | `isStale`, `isStaleBusinessDays` (`format.ts:30-54`) |
| `ApplicationRepository` | Repository | `src/lib/services/application-repository.ts` | scattered queries in `services/applications.ts`, `services/notes.ts` |
| `DomainError` + the six codes | Error taxonomy | `src/lib/domain/errors.ts` | ad-hoc inline 422 strings |
| `ApplicationCardView` | Read DTO | `src/types.ts` | raw `ApplicationRow` passed to islands |
| `append_application_note` | DB function | new migration | unguarded `createNote` |
| **AGENTS.md three-tier rule** | Boundary | `AGENTS.md` | current "`src/lib/` — pure utilities only (no domain logic)" |

Also worth recording, since the PRD is the model of record: whichever side of **D-A** wins must be written back
into `prd.md`, and `prd.md:166`'s wording should adopt `Actionability` as the single name.

### 5.5 Explicitly out of scope

Deferred, and named so their absence is a decision rather than an oversight: the missing `skills` field
(`prd.md:109`/`:111` vs no column, no zod key, no `ParseResult` key); modelling rejection as an explicit
lifecycle state instead of `archived_at` alone; the card's "dodano" label rendering `last_action_at`
(`KanbanCard.tsx:137` + `format.ts:68`) rather than `created_at`; and column-level hardening of
`last_action_at`. None of them is required to make INV-CORE enforceable.

---

## Summary

JobTracker's requirement documents are unusually complete, and they say plainly what the product is: the
kanban is a mental model users already have, and the follow-up intelligence layer on top *"is the product"*
(`prd.md:22`). That layer is also the only significant rule in the codebase with no server-side representative
— the thresholds, the per-status dispatch, and the labels all live inside a React island at
`src/components/board/KanbanCard.tsx:26-37` and `:138-139`, computed against the visitor's device clock, while
`src/lib/format.ts:30-54` quietly holds the domain's clock semantics under generic names. I selected as the
single invariant to protect **INV-CORE — "the prompt tells the truth"**: the verdict is derived server-side by
one rule from `(status, lastActionAt, now)`, and `lastActionAt` advances only when a recognised action lands
on a live application; the two halves are one invariant because a correct rule over a corruptible clock
produces a confident wrong answer. Diagnosis found nine concrete failure paths, of which the sharpest are a
frozen archived record whose clock still moves via `POST …/notes` (`services/notes.ts:24-40` →
`migration:144-157`, returning 200), a flag that does not clear after saving a note until a full page reload
(`CardNotes.tsx:73-74` with no callback through `CardDetailDialog.tsx:6-12`), a note reachable through the
wrong parent's URL because the validated `idParam` is discarded (`[noteId].ts:47`, `:82`), and a swallowed
dashboard load error that renders an empty board and thereby tells the user "nothing requires action"
(`dashboard.astro:26-30`). The design makes `Application` a guardian aggregate in a new pure `src/lib/domain/`
layer: every command opens with a precondition that throws a named `DomainError` instead of updating state, a
repository translates each intent into a single predicate-carrying statement so guards are re-checked
atomically at the database, the one operation that cannot carry a predicate — appending a note — moves into a
row-locking `append_application_note` RPC, and `actionability(now)` becomes the sole place the verdict is
computed, delivered from `dashboard.astro` and returned by every mutating route so the client never
recalculates. One product decision blocks phase 1 and is not mine to make: `prd.md:139`/`:172` say "24 hours"
while `prd.md:74`/`:166` say "1 calendar day", the code silently chose calendar boundaries, and a unit test at
`tests/unit/format.test.ts:11-15` froze that accident as intent — I recommend elapsed duration, which needs no
timezone and matches the more specific statements. Phases 1–4 and 6 need no schema change; only the note-guard
RPC in phase 5 is an `AGENTS.md` ⚠️ ask-first migration, and if it is declined the note path to F-5 stays open
and should be recorded as an accepted risk rather than quietly dropped.
