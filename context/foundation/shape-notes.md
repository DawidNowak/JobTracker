---
project: "JobTracker"
context_type: greenfield
created: 2026-05-18
updated: 2026-05-19
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 4
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "auth model"
      decision: "Google OAuth only in MVP; no email+password; no LinkedIn OAuth (approval too slow)"
    - topic: "user roles"
      decision: "flat model; every account sees only their own data"
    - topic: "MVP scope"
      decision: "kanban + URL parsing + follow-up recommendations; AI draft generation deferred to v2"
    - topic: "primary success criterion"
      decision: "80%+ applications added via URL paste (JJIT, LinkedIn)"
    - topic: "guardrails"
      decision: "user data isolation (primary); kanban state durability"
    - topic: "rejected applications"
      decision: "separate archive view, not a fourth kanban column"
    - topic: "follow-up timing thresholds"
      decision: "fixed, not user-configurable in MVP: 1 calendar day in Interesujące, 7 calendar days in Zaaplikowano, 4 business days (Mon–Fri) in Rozmowa; Rozmowa uses business days because recruiters work Mon–Fri and a Friday interview with a 4-calendar-day threshold would fire on Tuesday (only 2 business days later)"
    - topic: "recommendation clearance"
      decision: "lastActionAt resets on note save OR status change (not on field edits); requiresAction computed on-the-fly at dashboard load, not stored"
    - topic: "follow-up for Interesujące column"
      decision: "1-day threshold added; nature is a decision prompt (apply or skip), not a recruiter follow-up; internal flag named requiresAction (neutral across all columns); UI label differs per column: 'Zdecyduj — aplikujesz?' / 'Czas na follow-up z rekruterem' / 'Czas na follow-up po rozmowie'"
    - topic: "archive navigation"
      decision: "permanent nav link 'Archiwum' in the top navbar alongside 'Tablica'; leads to /archive route; single unified archive (no differentiation by close reason)"
    - topic: "closure from Interesujące"
      decision: "closing/skipping a card from 'Interesujące' is a permanent delete, not an archive; the user was never in a recruitment process, there is nothing to preserve; archive = records where recruiter contact occurred (Zaaplikowano or Rozmowa only)"
    - topic: "add column scope"
      decision: "new applications can be added to Interesujące or Zaaplikowano only; Rozmowa has no add button — it is populated exclusively by status changes from Zaaplikowano; column is determined by which column's '+' button the user clicked"
    - topic: "add form URL requirement"
      decision: "source field is required in the add-application form (free text — no URL format validation); the 'Pobierz dane oferty' button activates only when the entered text is a valid URL matching a supported portal (LinkedIn or JustJoinIT) and auto-fills fields; user can edit all fields before saving; no separate URL paste flow — one unified form"
    - topic: "delete behavior for Zaaplikowano/Rozmowa"
      decision: "direct delete is available from all columns; for Zaaplikowano and Rozmowa a warning dialog is shown: 'Rekord nie zostanie zachowany w archiwum. Tej akcji nie można cofnąć.' — on confirm, permanent delete with no archive entry; for Interesujące the delete flow is defined by FR-016"
    - topic: "status transition model"
      decision: "transitions between active columns are unrestricted in both directions (Interesujące ↔ Zaaplikowano ↔ Rozmowa); backward transitions are allowed (e.g. Rozmowa → Zaaplikowano); every transition resets lastActionAt and is recorded with a timestamp"
    - topic: "lastActionAt initialization"
      decision: "when a new application is added, lastActionAt is set to the creation timestamp; the follow-up threshold begins counting immediately from the moment the card is created"
    - topic: "note deferral in Interesujące"
      decision: "writing a note on an Interesujące card resets the 24-hour lastActionAt clock — this is intentional; a note represents a conscious deferral of the apply/skip decision; the user takes responsibility for the postponement"
    - topic: "URL field validation"
      decision: "the source field is free text — no URL format validation; any content is accepted (URL, job fair name, recruiter note, etc.); the 'Pobierz dane oferty' button activates conditionally when the entered text is a valid URL matching a supported portal (LinkedIn or JustJoinIT); the field is required but unconstrained in format"
    - topic: "archive search/filter/sort"
      decision: "no search, filter, or sort in the archive view in MVP — archive is a simple chronological list with read-only card views; explicit non-goal"
    - topic: "recruiter contact field"
      decision: "optional free-text field 'Kontakt do rekrutera' in the add/edit form; accepts any content (email, LinkedIn profile URL, contact name); supports the follow-up action workflow (FR-011, FR-012, FR-015)"
    - topic: "source link display on card"
      decision: "when the source field contains a valid URL, the kanban card shows a clickable 'Link do oferty' that opens in a new tab; when the source field is plain text (not a valid URL), no link element is shown on the card face — no disabled state, no badge"
  frs_drafted: 19
  quality_check_status: accepted
---

## Vision & Problem Statement

Job seekers applying to multiple positions simultaneously lose control of their pipeline. When the application list exceeds ~10 entries spread across LinkedIn, Pracuj.pl, and Indeed, there is no single source of truth for what's in progress, what needs a follow-up, and what has silently died. The cost is real: missed follow-up windows, wasted cognitive overhead, and lost opportunities not from lack of qualification but from lack of timely action.

The insight: job seekers already think in kanban stages (Interested → Applied → Interview → Rejected). They've internalized this mental model. What spreadsheets and Notion cannot provide is the proactive intelligence layer on top — a system that detects "this application has been silent for 7 days and it's time to follow up" and surfaces that signal at the right moment. That layer is the product.

## User & Persona

**Primary persona**: Active job-hunter, any seniority level. Currently in active search mode — applying to 5 or more positions per week, across at least two portals (typically LinkedIn + Pracuj.pl or Indeed). They are not a passive candidate idly browsing. They are managing a real pipeline with real deadlines and real cognitive load. The tool is for this person at peak search intensity.

## User Stories

### US-01: User adds a job application from a portal URL

- **Given** a logged-in user on the kanban board
- **When** they click the "+" button in either "Interesujące" or "Zaaplikowano" column, enter a LinkedIn or JustJoinIT URL, and click "Pobierz dane oferty"
- **Then** the form is pre-filled with position, company, description, skills, salary range, and work mode — the user can edit fields and confirms; the card appears in the column whose "+" button was clicked

#### Acceptance Criteria

- "+" add buttons appear only in "Interesujące" and "Zaaplikowano" columns — "Rozmowa" has no add button
- Source field is required (free text — no URL validation); the "Pobierz dane oferty" button activates only when the entered text is a valid URL from a supported portal (LinkedIn or JustJoinIT)
- Parser must handle both LinkedIn job URLs and JustJoinIT job URLs
- If parsing fails (network error, field missing) or URL is from an unsupported portal, fields remain empty and user fills manually — no silent failure
- Card is added to the column whose "+" button was clicked, with creation timestamp

### US-02: User acts on a follow-up recommendation

- **Given** an application in "Zaaplikowano" that has had no status change for 7 or more days
- **When** the user opens the kanban board
- **Then** the application card is visually flagged as needing follow-up, and the user can write and save a follow-up note on that card

#### Acceptance Criteria

- Flagging is visible without opening the card detail
- Saving a follow-up note does NOT automatically change the application status
- Follow-up notes are appended to a history list (most recent first) visible in the card detail

### US-03: User acts on a decision prompt for an application in "Interesujące"

- **Given** an application in "Interesujące" that has had no action (status change or note save) for 1 calendar day
- **When** the user opens the kanban board
- **Then** the application card is visually flagged with a decision prompt ("Zdecyduj — aplikujesz?") and the user can choose to apply or skip

#### Acceptance Criteria

- Flagging is visible on the kanban board without opening the card detail
- Clicking "Aplikuj" changes status to Zaaplikowano immediately in a single click — no confirmation dialog, no additional form
- Clicking "Pomiń" shows a confirmation dialog: "Usunąć tę aplikację? Tej akcji nie można cofnąć." — on confirm, the card is permanently deleted and not recoverable; on cancel, nothing changes
- No archive entry is created for a skipped card — deletion is permanent

### US-04: User acts on a follow-up recommendation for an application in "Rozmowa"

- **Given** an application in "Rozmowa" that has had no action (status change or note save) for 4 or more business days (Monday–Friday; weekends excluded)
- **When** the user opens the kanban board
- **Then** the application card is visually flagged as needing follow-up ("Czas na follow-up po rozmowie"), and the user can write a note or change the application's status

#### Acceptance Criteria

- Flagging is visible on the kanban board without opening the card detail
- Business day count excludes weekends (Saturday, Sunday); public holidays are NOT excluded in MVP
- Saving a follow-up note or changing the status clears the flag (resets lastActionAt)
- The flag label is "Czas na follow-up po rozmowie" (distinct from "Czas na follow-up z rekruterem" used in Zaaplikowano)

## Functional Requirements

### Authentication

- FR-001: User can register and log in via Google OAuth. Priority: must-have
  > Socrates: Counter-argument considered: "email+password is more self-contained, no provider dependency." Resolution: Google OAuth only in MVP — eliminates credential storage, password reset flow, and session hardening. LinkedIn OAuth restricted and slow to approve. Add email+password in v2 if users request it.
- FR-002: User can log out. Priority: must-have
  > Socrates: No counter-argument; it stands as written.

### Application management

- FR-003: User can add a job application via the add-application form — the source field is required (free text; any content accepted; no URL format validation); other fields: position, company, description, skills, salary range, work mode; recruiter contact (optional free text). The target column (Interesujące or Zaaplikowano) is determined by which column's "+" button the user clicked. Priority: must-have
  > Socrates: Counter-argument considered: "requiring a URL blocks adding applications from job fairs, networking contacts, or positions discovered verbally." Resolution: field is still required (source tracking is core product value) but free-text — no URL format validation. A user who learned about a position from a recruiter's LinkedIn DM can enter any identifying text. The 'Pobierz dane oferty' button activates conditionally on URL recognition (FR-004), not via field format validation.
- FR-004: When the source field in the add-application form contains a valid URL from a supported portal (LinkedIn or JustJoinIT), the "Pobierz dane oferty" button activates; clicking it pre-fills position, company, description, skills, salary range, and work mode. The user can edit any pre-filled field before saving. Priority: must-have
  > Socrates: Counter-argument considered: "parsers break silently when portals change HTML." Resolution: kept with explicit graceful fallback — if parsing fails or returns low-confidence data, fields remain empty and user fills manually. No silent garbage pre-fill.
- FR-005: User can edit an existing application's fields after adding it. Priority: must-have
  > Socrates: No counter-argument; it stands as written. Editing is required for parser corrections and data updates.
- FR-006: User can delete an application. Priority: must-have
  > Socrates: Decision: delete is available from all columns. For Zaaplikowano and Rozmowa, a warning dialog is shown: "Rekord nie zostanie zachowany w archiwum. Tej akcji nie można cofnąć." — on confirm, card is permanently deleted with no archive entry. For Interesujące, the delete flow is defined by FR-016 (the close/skip action).
- FR-016: User can close (permanently delete) a card from "Interesujące" when they decide not to apply — the card is removed and not recoverable. Priority: must-have
  > Socrates: Counter-argument considered: "permanent delete loses history of listings the user considered." Resolution: kept as delete — no recruiter contact occurred, so there is nothing meaningful to preserve. History value is marginal; operational simplicity outweighs it.

### Kanban & status tracking

- FR-007: User can view all active applications on a kanban board with three columns: Interesujące, Zaaplikowano, Rozmowa. New applications can be added only to Interesujące and Zaaplikowano — Rozmowa has no add button; it is populated exclusively by status changes from Zaaplikowano. Priority: must-have
  > Socrates: Counter-argument considered: "original spec had four columns including Odrzucony — why remove it?" Resolution: rejected applications moved to a separate archive view to prevent visual dead-weight on the main board. Three active columns, one archive. Rozmowa has no add button because it represents a recruiter-initiated stage — no one "enters" an interview without first applying.
- FR-008: User can change an application's status — each status change is recorded with a timestamp automatically. Priority: must-have
  > Socrates: Status transitions between active columns are unrestricted in both directions — any active-column → any active-column is allowed, including backward moves (e.g. Rozmowa → Zaaplikowano). Every transition resets lastActionAt and is recorded with a timestamp.
- FR-009: User can mark an application as rejected when it is in "Zaaplikowano" or "Rozmowa" — the card moves to the archive view, off the main kanban. Priority: must-have
  > Socrates: No counter-argument; archive is the direct consequence of the rejected-column decision. Scope is Zaaplikowano + Rozmowa only — cards in "Interesujące" are deleted, not archived (no recruiter contact occurred).
- FR-010: User can navigate to a dedicated archive view via a permanent "Archiwum" link in the top navigation bar (alongside "Tablica"); the archive lists all applications that were rejected from "Zaaplikowano" or "Rozmowa". Priority: must-have
  > Socrates: No counter-argument; without a nav link, the archive is functionally hidden. Permanent nav placement is preferred over a toggle or footer link — the user should always know where archived records live.
- FR-017: User can open a full read-only view of any archived application — all fields and the complete note history are visible; no editing is possible. Priority: must-have
  > Socrates: No counter-argument; it stands as written. Access to the full note history from a rejected application is the primary value of the archive view — a list-only view would obscure it.
- FR-018: When the source field of an application contains a valid URL, the kanban card displays a "Link do oferty" link visible on the board that opens the URL in a new browser tab; if the source is plain text (not a valid URL), no link is shown on the card. Priority: must-have
  > Socrates: Counter-argument considered: "a visible link on the card face adds clutter." Resolution: kept as conditional display — link appears only when source is a valid URL; plain-text sources show nothing; no disabled state. Clutter is limited to cases where the link is genuinely useful.
- FR-019: User can optionally enter recruiter contact information (free text — e.g., email address, LinkedIn profile URL, or contact name) via a "Kontakt do rekrutera" field when creating or editing an application. Priority: must-have
  > Socrates: Counter-argument considered: "recruiter contact is redundant — the user can look it up in the original posting." Resolution: kept — the recruiter contact is the direct target of follow-up recommendations (FR-011, FR-012, FR-015); without it the user must hunt for contact info precisely when the app is prompting them to act.

### Follow-up recommendations

- FR-015: User sees an action prompt when an application in "Interesujące" has had no action (status change or note save) for 1 day (24 hours). The prompt nudges the user to decide: apply (move to Zaaplikowano) or skip (permanently delete). Threshold is fixed, not user-configurable. Priority: must-have
  > Socrates: Counter-argument considered: "24h is too aggressive — job seekers may browse dozens of listings and not process their pipeline daily." Resolution: kept — the intent is exactly pipeline hygiene, not pressure. The prompt is a decision nudge ("apply or skip"), not a recruiter action. A user who checks once per day sees it at their natural review moment. Threshold can be calibrated post-launch.
- FR-011: User sees a follow-up recommendation when an application in "Zaaplikowano" has had no action (status change or note save) for 7 days. Threshold is fixed, not user-configurable. Priority: must-have
  > Socrates: Counter-argument considered: "fixed threshold is a blunt instrument — different contexts have different cadences." Resolution: kept — blunt is acceptable for MVP. Calibrate from user feedback post-launch. Cost of wrong threshold is misplaced recommendations, not a broken product.
- FR-012: User sees a follow-up recommendation when an application in "Rozmowa" has had no action (status change or note save) for 4 business days (Monday–Friday; weekends excluded). Threshold is fixed, not user-configurable. Priority: must-have
  > Socrates: Counter-argument considered: "business-day counting adds implementation complexity for a minor edge case." Resolution: kept — the edge case is not minor. A Friday interview with a 4-calendar-day threshold fires on Tuesday (2 business days later), which is premature and undermines the rule's intent. Business days (skip Sat/Sun only, no public holidays in MVP) is a small computation cost for a meaningful accuracy improvement. Public holidays excluded from MVP scope — locale-specific, changes yearly, adds dependency.

### Follow-up history

- FR-013: User can write and save a follow-up note (plain text) on any application. Priority: must-have
  > Socrates: Counter-argument considered: "notes need type labels to have meaning." Resolution: kept as plain text — user provides context in the note content. No type taxonomy in MVP. User responsibility model is correct.
- FR-014: User can view the full history of follow-up notes for an application, ordered most recent first, with timestamps. Priority: must-have
  > Socrates: No counter-argument; it stands as written.

## Business Logic

The app detects which applications require action by computing time elapsed since `lastActionAt` — the timestamp of the most recent user action on the application — and applying stage-specific thresholds.

The rule consumes two inputs: the application's current status and `lastActionAt`. `lastActionAt` resets under exactly two conditions: (1) the user saves a follow-up note, or (2) the user changes the application's status. General field edits (position, company, description, skills, salary, work mode) do NOT reset it.

The flag (`requiresAction`) is not stored as a persistent field. It is computed on-the-fly each time the user navigates to the dashboard: for every application in any active column, the app evaluates `now - lastActionAt` against the stage threshold. If the threshold is crossed, the card is flagged. Thresholds are fixed per status: 1 calendar day in "Interesujące", 7 calendar days in "Zaaplikowano", 4 business days (Mon–Fri, weekends excluded) in "Rozmowa". The Rozmowa threshold uses business days because recruiters operate on a working-week cadence — a 4-calendar-day threshold applied after a Friday interview fires on Tuesday (2 business days elapsed), which is premature. Public holidays are not excluded in MVP.

The semantic nature of the prompt differs by column. For "Interesujące" the flag is a **decision prompt** — the user has been sitting on the listing and must choose: apply (move to Zaaplikowano) or skip (permanently delete — no archive; no recruiter contact occurred). For "Zaaplikowano" and "Rozmowa" the flag is a **follow-up prompt** — the user should reach out to the recruiter. The UI label reflects this distinction per column; the underlying computation rule is identical.

The flag surfaces passively on the main kanban board — the user does not run a report or request a check. Cards meeting the threshold are flagged without any explicit user action.

When a new application is added, `lastActionAt` is initialized to the creation timestamp. The follow-up threshold begins counting immediately — a card added to "Interesujące" will be flagged after 24 hours of inactivity starting from the moment of creation.

Writing a follow-up note on a card in the "Interesujące" column resets `lastActionAt` — this is intentional. A note in "Interesujące" represents a conscious deferral of the apply/skip decision; the user takes responsibility for the postponement. The 24-hour clock restarts from the moment the note is saved.

Status transitions between active columns are unrestricted in both directions (Interesujące ↔ Zaaplikowano ↔ Rozmowa). A user may move a card backward (e.g., Rozmowa → Zaaplikowano) if the situation warrants it. Each transition resets `lastActionAt` and is recorded with a timestamp per FR-008.

## Non-Functional Requirements

- Any user-visible action (status change, note save, kanban load) completes within 500ms as perceived by the user under normal conditions.
- If a write operation fails (note save, status change), the user receives an explicit error notification — no silent data loss.
- The product is usable on the latest two major versions of Chrome, Firefox, and Edge on desktop. No mobile-specific requirement in MVP.
- The URL parser must never silently fill a field with low-confidence data. If a field cannot be parsed with reasonable confidence, it is left empty rather than pre-filled with a guess.

## Success Criteria

### Primary

- At least 80% of job applications are added using "Pobierz dane oferty" auto-fill (supported portal URL), not by typing all fields manually. This verifies the parser delivers real value — if users prefer auto-fill, the integration is worth the build cost.

### Secondary

- Users actively track applications beyond the initial add — the majority change status at least once.
- Follow-up recommendations are acted on — the majority of flagged cards receive a note or status change.

### Guardrails

- **User data isolation**: no user sees another user's applications under any circumstance. An auth failure here is not a P2 bug — it's an incident.
- **Kanban state durability**: status changes, note saves, and the `lastActionAt` timestamp they produce must persist reliably. Silent loss of any of these corrupts the follow-up timing rule downstream.

## Non-Goals

- **No AI-generated follow-up email drafts**: deferred to v2. The timing rule and manual notes are the MVP. AI drafts add LLM API dependency and cost for unproven marginal value at this stage.
- **No browser extension**: users paste URLs manually. One-click capture from portal pages requires a browser extension — out of MVP scope.
- **No email or push notifications**: follow-up recommendations surface in-app only. No external alerts of any kind.
- **No calendar integration**: interview dates can be noted in the application data, but no sync to Google Calendar or any external calendar service.
- **No candidate profile or job-match scoring**: no profile page, no skills-to-job-requirements matching, no scoring. The tool tracks applications, not the candidate.
- **No analytics or pattern detection**: no charts, no aggregation views, no "you get rejected most often at stage X" insights. Raw tracking only.
- **No search, filter, or sort in the archive view**: the archive is a simple chronological list with read-only card views; no search bar, no date filtering, no sorting controls in MVP.

## Timeline acknowledgment

Acknowledged on 2026-05-18: 4-week MVP requires sustained after-hours dedication; user accepted. Original scope (with AI draft generation) was estimated at 4–6 weeks. User chose "Scope down differently — keep URL parsing, drop AI" during Phase 3, reducing the estimate to 3–4 weeks. mvp_weeks=4 recorded as the accepted commitment.

## Access Control

Multi-user web app. Each account is isolated — a user sees only their own applications. Auth model: Google OAuth only in MVP — no email+password, no other OAuth providers. No roles, no admin, no sharing — flat user model. Unauthenticated users see only the login screen; all application data is gated behind authentication.
