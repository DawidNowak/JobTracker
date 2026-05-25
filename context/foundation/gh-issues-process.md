---
project: "JobTracker"
version: 2
created: 2026-05-25
updated: 2026-05-25
status: active
---

# GitHub Issues — Process & Convention

> Companion to `context/foundation/roadmap.md`. Describes how roadmap items map to GitHub issues on `DawidNowak/JobTracker` so post-MVP slices can be added with the same shape.

## Source-of-truth split

| Artifact | Role |
| --- | --- |
| `context/foundation/roadmap.md` | **Shaping artifact.** Records the decomposition and the reasoning behind each slice. Edit only when re-shaping (new slice, scope change, status change). |
| GitHub issues on `DawidNowak/JobTracker` | **Working surface.** Day-to-day execution, PR cross-refs, dependency tracking. |
| This file | **Convention doc.** How the two stay aligned. |

Rule of thumb: write the roadmap entry **first**, then mirror it to a new issue using the template below. Do not edit issues to "update the roadmap" or vice versa — re-shape the roadmap, then re-mirror.

## MVP v1 mapping (created 2026-05-25)

| Roadmap ID | Issue # | Title |
| --- | --- | --- |
| F-01 | [#1](https://github.com/DawidNowak/JobTracker/issues/1) | [F-01] Foundation: applications schema, RLS, and lastActionAt enforcement |
| S-01 | [#2](https://github.com/DawidNowak/JobTracker/issues/2) | [S-01] Kanban shell with three columns + top nav (Tablica / Archiwum) |
| S-02 | [#3](https://github.com/DawidNowak/JobTracker/issues/3) | [S-02] Manual add-application form (source required, free text) |
| S-04 | [#4](https://github.com/DawidNowak/JobTracker/issues/4) | [S-04] Pobierz dane oferty — LinkedIn + JustJoinIT URL parser *(north star)* |
| S-05 | [#5](https://github.com/DawidNowak/JobTracker/issues/5) | [S-05] Bi-directional kanban transitions with lastActionAt reset |
| S-03 | [#6](https://github.com/DawidNowak/JobTracker/issues/6) | [S-03] Edit any field + delete card (with warning dialogs) |
| S-06 | [#7](https://github.com/DawidNowak/JobTracker/issues/7) | [S-06] Card detail view + follow-up notes (write + history) |
| S-07 | [#8](https://github.com/DawidNowak/JobTracker/issues/8) | [S-07] Zdecyduj — aplikujesz? decision prompt (1-day threshold) |
| S-08 | [#9](https://github.com/DawidNowak/JobTracker/issues/9) | [S-08] Czas na follow-up z rekruterem flag (7-day threshold) |
| S-09 | [#10](https://github.com/DawidNowak/JobTracker/issues/10) | [S-09] Czas na follow-up po rozmowie flag (4-business-day threshold) |
| S-10 | [#11](https://github.com/DawidNowak/JobTracker/issues/11) | [S-10] Mark application as rejected; move to archive state |
| S-11 | [#12](https://github.com/DawidNowak/JobTracker/issues/12) | [S-11] Archive list page + read-only full card view |

Issue numbers happen to align (F-01 = #1, etc.) because the repo had no prior issues. Future slices will not align — always use this mapping table, not arithmetic.

## Convention

### Title format

```
[<ID>] <suggested-title-from-Backlog-Handoff>
```

- The slice ID (`F-01`, `S-04`, etc.) lives in the title, not in labels — searchable, sortable, and visible in any list view.
- The remainder of the title is the "Suggested issue title" column from the roadmap's Backlog Handoff table.

### Labels

Two labels, both **maintained by the `/blocker-resolved` skill** — do not edit them manually unless you know the skill will not be re-run for the affected issue:

| Label | Color | Meaning |
| --- | --- | --- |
| `ready` | `#1A7F37` (green) | No open blockers; pick this next |
| `blocked` | `#B35900` (orange) | Waiting on one or more open blockers |

Invariant: every open MVP issue has exactly one of `ready` or `blocked`. The pickup filter is `gh issue list --repo DawidNowak/JobTracker --label ready --state open`.

The labels duplicate information that's already in the Issue Dependencies graph (`blockedBy`). They exist purely as a cheap, scannable filter. The skill keeps them in sync — see `.claude/skills/blocker-resolved/SKILL.md`.

Still considered and rejected (2026-05-25):

| Candidate | Why not |
| --- | --- |
| `type:foundation` / `type:slice` | Title prefix already says this. (Initially created, then removed.) |
| Per-stream (`stream:A`…`stream:E`) | Stream membership is in the body; never queried during execution. |
| Per-slice-ID (`F-01`, `S-04`, …) | ID is in the title; duplicating adds bookkeeping with no payoff. |
| `north-star` | One-issue category = a tag, not a filter. Already noted in S-04's body. |
| `area:db` / `area:ui` / `area:api` | Most slices are full-stack; would tag 10 of 12 the same way. |
| `needs-decision` | Only S-04 has an Unknown today, and it's already in-body. |
| `in-progress` | Assignee + linked PR already signal this. Keeping labels focused on the pickup filter. |
| `p0` / `p1` | Everything in MVP v1 is p0 by virtue of being in MVP. |

**Reconsider when:** the backlog passes ~25 open issues, or work spans more than one owner, or post-MVP slices start accumulating open Unknowns (then `needs-decision` becomes worth a label).

### Milestone

One milestone per MVP increment. The first is `MVP v1` (12 issues, all listed above). Future post-MVP work lands in a new milestone (`v2` or feature-named) — do not append post-MVP slices to `MVP v1`.

### Body template

Every issue body must have these sections, in this order:

```markdown
**Roadmap ID:** <ID>
**Change ID:** <change-id>
**Status:** <ready|proposed>
**Stream:** <A|B|C|D|E>

### Outcome
<verbatim from roadmap>

### PRD refs
<verbatim>

### Prerequisites
- #<N> — [<prereq-ID>] <prereq-title>
(or "_None — foundation slice._" if empty)

### Parallel with
<verbatim, or "—">

### Unknowns
<verbatim, or "—">

### Risk / context
<verbatim Risk paragraph>

---
Source: `context/foundation/roadmap.md` (v<N>, <date>).
Process: `context/foundation/gh-issues-process.md`.
```

- "Outcome", "PRD refs", "Parallel with", "Unknowns", "Risk / context" are copied **verbatim** from the roadmap entry. If you need to change them, change the roadmap first.
- "Prerequisites" is a plain-prose bullet list pointing at GitHub issue numbers. It is **informational only**; the source of truth for what blocks what is the Issue Dependencies graph (see next section).

### Dependency tracking

- **Source of truth:** GitHub's native **Issue Dependencies** feature, registered via the `addBlockedBy` GraphQL mutation. Query with `issue.blockedBy` / `issue.blocking`.
- The body's `Prerequisites` section is informational — do **not** use it for programmatic checks. If body and graph disagree, the graph wins.
- Labels (`ready` / `blocked`) are derived state, maintained by the `/blocker-resolved` skill (see below). Do not maintain them manually.
- "Parallel with" is informational (siblings of the same prereq) — never represent as a dependency edge.

### Skill: `/blocker-resolved`

Lives at `.claude/skills/blocker-resolved/SKILL.md` (project-local, committed to the repo).

- **Trigger:** user types `/blocker-resolved <issue-number>` after finishing work, e.g. `/blocker-resolved 5`.
- **Action:** closes the issue if still open, then queries the just-closed issue's dependents (one GraphQL call), and flips `blocked` → `ready` on any child whose last open blocker just closed. Reports newly-ready and still-blocked children.
- **Idempotent:** safe to re-run on an already-closed issue. If the user closes via web UI without invoking the skill, downstream labels drift until the next `/blocker-resolved <#>` against that issue.
- **Out of scope:** the skill does NOT sweep the whole repo for drift. It only reconciles the children of the issue passed in.

See the SKILL.md for full step-by-step logic and edge cases.

## Adding a post-MVP slice

When the roadmap grows beyond MVP v1 (e.g., new milestone `v2`):

1. Add the slice to `context/foundation/roadmap.md` first (At-a-glance row + full entry + Backlog Handoff row).
2. Pick the next `S-NN` ID (continue numbering past `S-11`).
3. Resolve prereqs to issue numbers via this file's mapping table (extend the table after step 5).
4. Compose the issue body from the template above using the new roadmap entry verbatim.
5. Create the issue:
   ```powershell
   gh issue create --repo DawidNowak/JobTracker `
     --title "[S-12] <title>" `
     --body-file "<path>.md" `
     --milestone "v2"
   ```
6. Register dependency edges for each prereq via `addBlockedBy`:
   ```powershell
   # Look up node IDs first (one GraphQL call covers the new issue + all prereqs)
   gh api graphql -f query='{ repository(owner:"DawidNowak", name:"JobTracker") { issues(first:50, states:OPEN) { nodes { number id } } } }'
   # Then per prereq:
   gh api graphql -f query='mutation { addBlockedBy(input: { issueId: "<newId>", blockingIssueId: "<prereqId>" }) { issue { number } } }'
   ```
7. Apply the initial label: `gh issue edit <newN> --repo DawidNowak/JobTracker --add-label blocked` (or `ready` if the new issue has no prereqs).
8. Append a row to the mapping table in this file with the returned issue number and URL.
9. If the new slice unlocks something in a prior milestone, register the reverse edge from the prior issue too (the prior issue becomes blocked-by the new one only if it actually waits on it — usually it does not).

## Why no GitHub Project board

A Project (kanban) was considered and rejected for MVP. Reasons:

- The product itself is a kanban; the user already has a mental kanban for the work.
- Projects require an extra OAuth scope (`read:project`) that the current `gh` token lacks.
- For 12 issues on a 4-week solo MVP, the milestone progress bar plus task-list checkboxes already give the signal a Project board would.

If post-MVP growth pushes the surface past ~25–30 open issues, reconsider — at that point a Project's grouping and views start to pay off.

## Changelog

- **v1 (2026-05-25):** initial migration; markdown task-list checkboxes for prereqs; no labels.
- **v2 (2026-05-25):** switched dependency source of truth to GitHub Issue Dependencies (`addBlockedBy`). Added `ready` / `blocked` labels maintained by the `/blocker-resolved` skill. Body `Prerequisites` section is now informational prose (no checkboxes).
