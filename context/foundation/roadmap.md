---
project: "JobTracker"
version: 1
status: draft
created: 2026-05-25
updated: 2026-05-29
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: JobTracker

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

> **Auth-model note (2026-05-25):** during decomposition the user chose to keep the starter's existing email+password auth as the MVP path and defer Google OAuth to v2. PRD FR-001, Access Control, and Non-Goals were amended in the same pass to match; see PRD §Authentication for the revised Socratic rationale.

## Vision recap

Job seekers managing 10+ concurrent applications across LinkedIn / Pracuj.pl / Indeed lose their pipeline to fragmentation — missed follow-up windows and silently dead leads they didn't notice. The product is a kanban with a proactive intelligence layer on top: it detects "this application has been silent past its stage threshold" and surfaces the signal at the right moment.

The product wedge — the one trait that, if removed, makes the product indistinguishable from a spreadsheet or Notion table — is the proactive timing rule layered over a kanban the user already mentally has. The primary Success Criterion (≥80% of applications added via "Pobierz dane oferty" auto-fill) bets that URL parsing is the wedge's user-facing surface; the follow-up flags are its decision layer.

## North star

**S-04: User adds an application from a LinkedIn or JustJoinIT URL via "Pobierz dane oferty"** — this is the validation milestone, meaning the smallest end-to-end flow whose successful delivery would prove the product hypothesis. The primary Success Criterion measures it directly (auto-fill share of adds); the 4-week MVP that ships without S-04 ships without its actual learning signal.

## At a glance

| ID    | Change ID                          | Outcome (user can …)                                          | Prerequisites    | PRD refs              | Status   |
| ----- | ---------------------------------- | ------------------------------------------------------------- | ---------------- | --------------------- | -------- |
| F-01  | applications-schema-and-rls        | (foundation) Application + note schema with per-user RLS      | —                | NFR (durability), Access Control | ready    |
| S-01  | kanban-shell-and-nav               | log in and see an empty 3-column board + top nav              | F-01             | FR-001, FR-002, FR-007, FR-010 (link) | proposed |
| S-02  | manual-add-application             | add a job application by typing fields                        | S-01             | FR-003, FR-019        | done     |
| S-04  | parser-driven-add                  | paste a portal URL and get a pre-filled add form *(north star)* | S-02             | US-01, FR-004, FR-018 | proposed |
| S-05  | kanban-status-transitions          | move a card between active columns; lastActionAt is reset     | S-02             | FR-008                | proposed |
| S-03  | edit-and-delete-application        | edit any field on a card; delete a card from any column       | S-02             | FR-005, FR-006, FR-016 | proposed |
| S-06  | notes-and-card-detail              | write follow-up notes and read note history on a card         | S-02             | FR-013, FR-014        | proposed |
| S-07  | interesujace-decision-prompt       | act on the 1-day decision prompt in Interesujące              | S-05, S-03       | US-03, FR-015         | proposed |
| S-08  | zaaplikowano-followup-flag         | see the 7-day follow-up flag in Zaaplikowano                  | S-06             | US-02, FR-011         | proposed |
| S-09  | rozmowa-followup-flag              | see the 4-business-day follow-up flag in Rozmowa              | S-06             | US-04, FR-012         | proposed |
| S-10  | reject-to-archive                  | mark a card as rejected; it moves to the archive              | S-05             | FR-009                | proposed |
| S-11  | archive-view                       | open the archive list and read full archived cards            | S-10, S-06       | FR-010 (page), FR-017 | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                              | Chain                                | Note                                                                                  |
| ------ | ---------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| A      | Foundation & board shell           | `F-01` → `S-01`                      | Data layer + RLS, then the empty board. Auth is satisfied by baseline email+password. |
| B      | Wedge — parser-driven add          | `S-02` → `S-04`                      | Carries the north star. With `main_goal: speed`, this is the must-ship-early chain.   |
| C      | Operate the kanban                 | `S-03` / `S-05` (parallel off S-02)  | CRUD + movement. Each branch is independently planable once S-02 lands.               |
| D      | Notes & proactive prompts          | `S-06` → `S-07` / `S-08` / `S-09`    | S-07 also joins Stream C at S-05 and S-03; S-08 / S-09 only need S-06.                |
| E      | Archive lifecycle                  | `S-10` → `S-11`                      | S-11 also reads note history from S-06.                                               |

## Baseline

What's already in place in the codebase as of 2026-05-25 (auto-researched + user-confirmed). Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 6.3.1 + React 19 + Tailwind 4 + Radix wired (`astro.config.mjs`, `src/components/ui/button.tsx`); only auth pages and an empty `dashboard.astro` exist beyond starter scaffold.
- **Backend / API:** partial — Astro server endpoints under `src/pages/api/auth/` (signin / signup / signout) wired to Supabase; no domain endpoints; no Zod validation at API boundaries.
- **Data:** partial — Supabase SDK wired (`src/lib/supabase.ts:9`, `@supabase/ssr`); `supabase/config.toml` present with empty `schema_paths`; no migrations, no domain tables, no seed data.
- **Auth:** present (for MVP) — Supabase Auth wired with email+password (signin / signup / signout endpoints, `src/middleware.ts` protects `/dashboard`). Google OAuth is parked to v2 per Auth-model adjustment above; the email+password gate satisfies MVP FR-001 (after PRD amendment) and FR-002.
- **Deploy / infra:** present — `@astrojs/cloudflare` adapter (`astro.config.mjs:16`), `wrangler.jsonc`, `.github/workflows/ci.yml` runs lint + build on push/PR to master with Supabase secrets injected, `.env.example` template.
- **Observability:** absent — no logging library, no error tracking; Cloudflare observability flag enabled in `wrangler.jsonc:14-16` but no app-side instrumentation.

## Foundations

### F-01: Applications schema and RLS

- **Outcome:** (foundation) `applications` table (with `status`, `lastActionAt`, source, fields per FR-003) and `application_notes` table exist; PostgreSQL row-level security policies isolate every row to `auth.uid()`; Zod schemas validate writes at API boundaries; `lastActionAt` reset is enforced by PostgreSQL triggers — a `BEFORE UPDATE` trigger on `applications` sets `lastActionAt = now()` only when `OLD.status IS DISTINCT FROM NEW.status`, and an `AFTER INSERT` trigger on `application_notes` updates the parent row's `lastActionAt`. Edits to non-status fields (position, company, description, skills, salary, work mode, recruiter contact) leave `lastActionAt` untouched. New rows initialize `lastActionAt` via column default `now()`.
- **Change ID:** applications-schema-and-rls
- **PRD refs:** Business Logic (lastActionAt rules), NFR (kanban state durability), Access Control (user data isolation), FR-003, FR-013
- **Unlocks:** S-01 (board read query) and all slices that mutate applications or notes (S-02, S-03, S-04, S-05, S-06, S-10)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the "invest in data" foundation called out in the framing recap. PRD elevates user data isolation to an incident-class guardrail, so RLS must land with the schema, not as a follow-on hardening pass. Same for `lastActionAt`: the follow-up timing rule is downstream of correct reset semantics; a silent miss here corrupts every prompt slice (S-07 through S-09). DB-level trigger enforcement (rather than API-only) means a buggy or future endpoint cannot silently break the rule — the DB owns the column, the API never sets it. RLS is provider-agnostic via `auth.uid()`, so it works against the existing email+password session.
- **Status:** ready

## Slices

### S-01: Kanban shell and nav

- **Outcome:** A logged-in user (authenticated via the existing email+password flow) lands on a three-column kanban board (Interesujące / Zaaplikowano / Rozmowa) with a persistent top nav containing "Tablica" and "Archiwum" links. Columns are empty (no add or interaction yet). FR-001 and FR-002 are satisfied by baseline (signin / signup / signout endpoints in `src/pages/api/auth/`); this slice's scope is the authenticated landing page, not new auth plumbing.
- **Change ID:** kanban-shell-and-nav
- **PRD refs:** FR-001 (via baseline), FR-002 (via baseline), FR-007, FR-010 (nav link only — archive page lands in S-11)
- **Prerequisites:** F-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Thin slice on purpose — landing the shell unblocks every interactive slice without bundling form work. The nav placement of "Archiwum" is shipped here even though the page is empty until S-11, because PRD FR-010 explicitly wants the link permanent and obvious. Auth ratification (verifying sign-in / sign-up / sign-out actually work end-to-end against the upcoming RLS-protected schema) belongs here as an exit gate, not in F-01.
- **Status:** proposed

### S-02: Manual add application

- **Outcome:** User clicks "+" in Interesujące or Zaaplikowano, fills the form (source required free text; position, company, description, skills, salary range, work mode; optional "Kontakt do rekrutera"), and the card appears in the column whose "+" was clicked with creation timestamp.
- **Change ID:** manual-add-application
- **PRD refs:** FR-003, FR-019
- **Prerequisites:** S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** First write-path slice. The form is reused in edit mode (S-03) and parser mode (S-04), so the form contract lands here. Adding "Kontakt do rekrutera" (FR-019) in this slice avoids a backfill edit when the follow-up slices need it later.
- **Status:** done (shipped 2026-05-29, commit b3ff36b; awaiting archive)

### S-04: Parser-driven add  *(north star)*

- **Outcome:** When the source field contains a valid LinkedIn or JustJoinIT URL, the "Pobierz dane oferty" button activates; clicking pre-fills position, company, description, skills, salary range, work mode. The user can edit any field before saving. Parser failure or unsupported portal leaves fields empty (no silent garbage pre-fill). On the kanban card, a "Link do oferty" link appears when source is a valid URL.
- **Change ID:** parser-driven-add
- **PRD refs:** US-01, FR-004, FR-018, NFR (no low-confidence pre-fill)
- **Prerequisites:** S-02
- **Parallel with:** S-05, S-03 (all share head S-02)
- **Blockers:** —
- **Unknowns:**
  - URL parsing strategy (server-side scrape vs third-party fetch service vs vendor API) is a `/10x-plan` decision; the roadmap holds it as in-scope-but-undecided. Owner: TBD at plan time. Block: no.
- **Risk:** The validation milestone — meaning the slice whose user-visible behavior the primary Success Criterion (≥80% auto-fill share) is measured against. Placed as slice 4 (earliest its Prerequisites allow) because the 4-week MVP cannot afford to ship without it under `main_goal: speed`. The PRD's graceful-fallback contract is load-bearing: parser flake must not block the manual-add path that already exists in S-02.
- **Status:** proposed

### S-05: Kanban status transitions

- **Outcome:** User changes an application's status between any two active columns (Interesujące ↔ Zaaplikowano ↔ Rozmowa), including backward moves. Each transition resets `lastActionAt` and is recorded with a timestamp.
- **Change ID:** kanban-status-transitions
- **PRD refs:** FR-008, Business Logic (transition rules)
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-03 (all share head S-02)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** After this lands, the kanban is functionally a kanban — without S-05 the board is read-only. Bi-directional transitions are non-negotiable per PRD Business Logic; sequencing them in one slice avoids a "phase 1 forward-only, phase 2 add backward" regression risk.
- **Status:** proposed

### S-03: Edit and delete application

- **Outcome:** User edits any field on an existing card. User deletes a card: from Zaaplikowano or Rozmowa a warning dialog appears ("Rekord nie zostanie zachowany w archiwum. Tej akcji nie można cofnąć."); from Interesujące the same permanent-delete behavior applies per FR-016 (decision-prompt skip flow re-uses this path in S-07).
- **Change ID:** edit-and-delete-application
- **PRD refs:** FR-005, FR-006, FR-016
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05 (all share head S-02)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bundles edit and delete because both reuse the S-02 form / card surface; splitting them would double the touch on the same files for marginal scope clarity. FR-016's permanent-delete-from-Interesujące shares this slice's confirmation dialog plumbing — the decision-prompt UI (S-07) only wires the trigger.
- **Status:** proposed

### S-06: Notes and card detail

- **Outcome:** User opens a card detail view (modal or page), writes a plain-text follow-up note, and sees the full note history ordered most recent first with timestamps. Saving a note resets `lastActionAt` per Business Logic (including in Interesujące, where it is a conscious deferral of the apply/skip decision).
- **Change ID:** notes-and-card-detail
- **PRD refs:** FR-013, FR-014, Business Logic (note save resets lastActionAt)
- **Prerequisites:** S-02
- **Parallel with:** S-04, S-05, S-03 (all share head S-02)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Introduces the card detail surface that S-07, S-08, S-09, S-11 all rely on. Notes are also the act-on side of every follow-up flag in S-08 and S-09, so deferring this past S-05 would push the proactive-intelligence layer out of reach.
- **Status:** proposed

### S-07: Interesujące decision prompt

- **Outcome:** Cards in "Interesujące" with no action for ≥ 1 calendar day display "Zdecyduj — aplikujesz?" on the board face. The user clicks "Aplikuj" (single click, no confirmation — moves to Zaaplikowano via S-05's transition) or "Pomiń" (confirmation dialog "Usunąć tę aplikację? Tej akcji nie można cofnąć." — permanent delete via S-03's path; no archive entry).
- **Change ID:** interesujace-decision-prompt
- **PRD refs:** US-03, FR-015
- **Prerequisites:** S-05, S-03
- **Parallel with:** S-08, S-09 (share Stream D theme but different prereqs)
- **Blockers:** —
- **Unknowns:** —
- **Risk:** First flag slice — establishes the on-the-fly threshold computation pattern (`now − lastActionAt vs. stage threshold`) that S-08 and S-09 will reuse. Getting the rule right here de-risks both follow-up flag slices.
- **Status:** proposed

### S-08: Zaaplikowano follow-up flag

- **Outcome:** Cards in "Zaaplikowano" with no action for ≥ 7 calendar days display "Czas na follow-up z rekruterem" on the board face. The user acts by writing a note (via S-06) — saving a note does NOT auto-change status. The flag clears when lastActionAt resets.
- **Change ID:** zaaplikowano-followup-flag
- **PRD refs:** US-02, FR-011
- **Prerequisites:** S-06
- **Parallel with:** S-07, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Reuses S-07's computation pattern with a different threshold. Independent of S-07 — could be planned in parallel by a separate agent run once S-06 lands.
- **Status:** proposed

### S-09: Rozmowa follow-up flag

- **Outcome:** Cards in "Rozmowa" with no action for ≥ 4 business days (Mon–Fri, weekends excluded; public holidays NOT excluded in MVP per PRD) display "Czas na follow-up po rozmowie" on the board face. The user acts by writing a note (via S-06) or changing status (via S-05).
- **Change ID:** rozmowa-followup-flag
- **PRD refs:** US-04, FR-012
- **Prerequisites:** S-06
- **Parallel with:** S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Business-day arithmetic is the one computation deviation from S-07 / S-08. PRD locks the rule (Mon–Fri, no holidays in MVP) so there is no design ambiguity; the risk is purely implementation correctness around weekend boundaries.
- **Status:** proposed

### S-10: Reject to archive

- **Outcome:** User marks an application in Zaaplikowano or Rozmowa as rejected; the card moves off the main kanban into an archive state. Interesujące is not in scope here — those cards are deleted, not archived (per FR-016 / S-03).
- **Change ID:** reject-to-archive
- **PRD refs:** FR-009
- **Prerequisites:** S-05
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Introduces a new card lifecycle state (archived) that the board query must exclude and the archive page (S-11) must include. The schema work belongs in F-01; this slice is the user-visible toggle plus the board-filter change.
- **Status:** proposed

### S-11: Archive view

- **Outcome:** User clicks the "Archiwum" nav link (placed in S-01) and sees a chronological list of archived applications. Clicking an entry opens a full read-only card view showing every field plus the complete note history; no editing controls anywhere on the archive page.
- **Change ID:** archive-view
- **PRD refs:** FR-010 (page), FR-017
- **Prerequisites:** S-10, S-06
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Final must-have slice. Read-only is non-negotiable per FR-017 — leaking edit affordances into archive risks the durability guardrail in subtle ways (e.g., accidental status changes on an archived card). The S-06 dependency is for the note-history renderer; reuse, don't reimplement.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                          | Suggested issue title                                              | Ready for `/10x-plan` | Notes                                       |
| ---------- | ---------------------------------- | ------------------------------------------------------------------ | --------------------- | ------------------------------------------- |
| F-01       | applications-schema-and-rls        | Foundation: applications schema, RLS, and lastActionAt enforcement | yes                   | No Prerequisites — auth is in baseline      |
| S-01       | kanban-shell-and-nav               | Kanban shell with three columns + top nav (Tablica / Archiwum)     | no                    | Needs F-01                                  |
| S-02       | manual-add-application             | Manual add-application form (source required, free text)           | yes                   | Shipped 2026-05-29 (impl_reviewed); awaiting archive          |
| S-04       | parser-driven-add                  | "Pobierz dane oferty" — LinkedIn + JustJoinIT URL parser           | yes                   | **North star.** S-02 shipped 2026-05-29     |
| S-05       | kanban-status-transitions          | Bi-directional kanban transitions with lastActionAt reset          | yes                   | S-02 shipped 2026-05-29; parallel with S-04, S-03 |
| S-03       | edit-and-delete-application        | Edit any field + delete card (with warning dialogs)                | yes                   | S-02 shipped 2026-05-29; parallel with S-04, S-05 |
| S-06       | notes-and-card-detail              | Card detail view + follow-up notes (write + history)               | yes                   | S-02 shipped 2026-05-29; parallel with S-04, S-05, S-03 |
| S-07       | interesujace-decision-prompt       | "Zdecyduj — aplikujesz?" decision prompt (1-day threshold)         | no                    | Needs S-05, S-03                            |
| S-08       | zaaplikowano-followup-flag         | "Czas na follow-up z rekruterem" flag (7-day threshold)            | no                    | Needs S-06; parallel with S-07, S-09        |
| S-09       | rozmowa-followup-flag              | "Czas na follow-up po rozmowie" flag (4-business-day threshold)    | no                    | Needs S-06; parallel with S-07, S-08        |
| S-10       | reject-to-archive                  | Mark application as rejected; move to archive state                | no                    | Needs S-05                                  |
| S-11       | archive-view                       | Archive list page + read-only full card view                       | no                    | Needs S-10, S-06                            |

## Open Roadmap Questions

None at roadmap level. The PRD declared zero open questions in shaping (`quality_check_status: accepted`); the one cross-cutting question surfaced during roadmap generation (PRD vs auth-model decision) was resolved in the same session by amending PRD FR-001, Access Control, and Non-Goals. The single per-slice unknown (S-04: URL parsing strategy — scrape vs third-party service vs vendor API) is held inside S-04 and resolved at `/10x-plan` time; it does not block planning.

## Parked

- **Google OAuth (and other OAuth providers)** — Why parked: deferred to v2 per user decision 2026-05-25. Existing email+password auth in the 10x Astro Starter is sufficient for the 4-week MVP; Google OAuth has no functional unlock (provider-agnostic `auth.uid()` already serves RLS) and adds setup work that doesn't fit the time budget. PRD FR-001 / Access Control to be amended to match.
- **AI-generated follow-up email drafts** — Why parked: PRD §Non-Goals (deferred to v2). Adds LLM API dependency and cost for unproven marginal value at MVP stage.
- **Browser extension for one-click capture from portal pages** — Why parked: PRD §Non-Goals (out of MVP scope). Users paste URLs manually in MVP.
- **Email or push notifications for follow-up flags** — Why parked: PRD §Non-Goals. Recommendations surface in-app only; no external alerts.
- **Calendar integration (Google Calendar sync of interview dates)** — Why parked: PRD §Non-Goals. Interview dates are notes; no external sync.
- **Candidate profile and job-match scoring** — Why parked: PRD §Non-Goals. The tool tracks applications, not the candidate.
- **Analytics, charts, or pattern detection across applications** — Why parked: PRD §Non-Goals. Raw tracking only in MVP.
- **Search, filter, or sort in the archive view** — Why parked: PRD §Non-Goals. Archive is a simple chronological list.
- **Public-holiday awareness in the Rozmowa business-day threshold** — Why parked: PRD §Business Logic (locale-specific, changes yearly, dependency cost not justified for MVP).
- **Mobile-specific UI / responsive layout work** — Why parked: PRD §NFR (only desktop Chrome / Firefox / Edge in MVP).

## Done

(Empty on first generation. `/10x-archive` appends entries here as roadmap items close.)
