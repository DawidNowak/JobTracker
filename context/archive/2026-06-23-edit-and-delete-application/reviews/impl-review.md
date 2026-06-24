<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Edit and Delete Application

- **Plan**: context/changes/edit-and-delete-application/plan.md
- **Scope**: All 3 phases (full plan)
- **Date**: 2026-06-24
- **Verdict**: APPROVED
- **Findings**: 0 critical  2 warnings  3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — PATCH skips the localized source-error message that POST uses

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/applications/[id].ts:32
- **Detail**: POST localizes empty `source` to "Źródło jest wymagane." via formatApplicationErrors (index.ts:9-17). The PATCH handler used bare formatZodErrors, so the Edit dialog showed a raw Zod message for the same field. Fix: extract to @/lib/http and share between both routes.
- **Fix**: Extracted formatApplicationErrors to src/lib/http.ts; both index.ts and [id].ts import and call it.
- **Decision**: FIXED — commit 24ac232

### F2 — DeleteApplicationDialog doesn't reset its banner/pending state on close

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Reliability
- **Location**: src/components/board/DeleteApplicationDialog.tsx:51
- **Detail**: onOpenChange was wired straight to the parent setter, so after a failed delete the stale red banner persisted on reopen. Edit/Add dialogs both clear error state in a local handleOpenChange; Delete diverged.
- **Fix**: Added local handleOpenChange that clears bannerError/deleting when next === false, matching siblings.
- **Decision**: FIXED — commit 24ac232

### F3 — Unplanned regen of src/components/ui/button.tsx

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/ui/button.tsx
- **Detail**: shadcn regen side-effect of `npx shadcn add dropdown-menu alert-dialog`. New size variants, radix-ui meta-package import, default props. Tracks radix-ui ^1.4.3→^1.6.0 bump. No consumer depends on new variants; falls under plan's "keep generated ui/ files as upstream ships them" + AGENTS exemption.
- **Decision**: SKIPPED — expected and exempt

### F4 — PATCH accepts an empty body as a no-op 200

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/validation/applications.ts:23 + [id].ts:30
- **Detail**: All fields in applicationUpdateSchema were optional, so PATCH {} validated and ran .update({}), returning the unchanged row with 200 — a no-op reported as success.
- **Fix**: Added .refine((obj) => Object.keys(obj).length > 0, { message: "Brak pól do aktualizacji." }) to applicationUpdateSchema.
- **Decision**: FIXED — commit 24ac232

### F5 — EditApplicationDialog form state not re-synced on prop drift

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Reliability
- **Location**: src/components/board/EditApplicationDialog.tsx:40
- **Detail**: Form state seeded once via useState(() => rowToForm(application)) and only reset on close. Low risk given per-card mounting + reload-on-success.
- **Decision**: SKIPPED — low risk under per-card mount + reload
