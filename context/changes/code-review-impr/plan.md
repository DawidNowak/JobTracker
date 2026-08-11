# Review Criteria & Mechanical Gate Implementation Plan

## Overview

Rebuild the CI reviewer's five review criteria around JobTracker's own written rules — the ones that
existed long before the agent — and replace the fuzzy 1–10 scorecard with a per-criterion status
enum plus structured findings, so the overall verdict is **computed in Node** from those results
rather than authored by the model, and the workflow can mechanically stop a change on it.

Also stop `context/**` bodies (plans, research, briefs) from being embedded in the reviewed diff, so
writing full planning artifacts no longer costs tokens on every review.

## Current State Analysis

`packages/code-reviewer` already has five dimensions and already uses structured output — so this is
a rework of existing machinery, not a greenfield build. What it does not have is anything the
pipeline can gate on.

**The five criteria are ecosystem-generic, not internal.** `src/schema.ts:7` declares
`SCORE_DIMENSIONS = ["correctness", "idiomatic_style", "complexity", "test_coverage", "security"]` —
the universal software-review set. JobTracker's own rules reach the agent only indirectly:
`src/prompt.ts:34-39` says "Follow the project's own instructions (CLAUDE.md / AGENTS.md, loaded into
your context) as the authority on conventions" and `src/index.ts:153` sets
`settingSources: ["project"]`. The model is left to discover, prioritize and weigh those rules
itself, with "do not invent house rules of your own" as the only guardrail.

**The scores are decorative.** `scores` is five integers 1–10 (`src/schema.ts:20-22`). Nothing reads
them except `src/output.ts:23`'s `formatScoresTable()`, which renders them into the PR comment. No
threshold, no gate, no consumer.

**The verdict is a single fuzzy token.** `verdict` is a model-authored `"PASS" | "FAIL"` field
(`src/schema.ts:27`). `src/prompt.ts:78-82` tells the model when to choose each, but nothing checks
the verdict against the scores or the findings — it can already contradict both.

**Findings are one free-text blob.** `report_markdown` carries all findings with prose conventions
for `file:line` and Certain/Possible marking (`src/prompt.ts:55-71`). `src/output.ts:35` even has a
`stripLeadingFindingsHeading()` workaround because "the model … sometimes writes one anyway … rather
than trust prompt compliance". Nothing downstream can verify a verdict is backed by a located
finding.

**The gate does not gate.** `.github/workflows/ai-code-review.yml:44-58` maps the verdict to
`ai-cr:passed` / `ai-cr:failed` labels. The job never fails. The README states it outright: "Since
the verdict is not a merge gate, the latency costs patience, not CI throughput."

**Planning artifacts are embedded in the reviewed diff.** `src/git.ts:70`'s
`GENERATED_FILE_EXCLUDES` drops only `**/package-lock.json` and `**/database.types.ts`. Every
`context/changes/**` markdown file a PR touches has its full body embedded in the prompt — which is
why the predecessor change skipped writing a `plan.md` at all.

**No test runner exists in the package.** `package.json` has `review` and `typecheck` scripts only,
and the root `vitest.config.ts` includes only `tests/**`. The package is deliberately isolated from
the app's typecheck/lint/test.

### Key Discoveries:

- `src/schema.ts:1-5` — the file's header comment states its own design intent: schema, type and
  runtime guard are "kept adjacent so the three cannot drift". Deriving everything from one criteria
  array extends that intent rather than fighting it.
- `src/output.ts:44-48` — `formatReport` is documented as assembling the comment "from the structured
  fields rather than pasting one blob of model markdown, so the verdict, summary and scorecard have a
  fixed shape the model cannot reformat or duplicate". Structured findings are the missing half of
  that design.
- `README.md:15-18` — `src/schema.ts` is called out as "a CI-affecting contract: a field rename or an
  added required field changes what the action can parse out of a run". This change renames most of
  it, so the action and workflow must move in the same commit range.
- `.github/workflows/ai-code-review.yml:44-58` — neither label step carries `if: always()`. A review
  step that exits non-zero would skip both, leaving a failing PR unlabelled.
- `context/archive/2026-08-11-cicd-review-impr/plan-brief.md:45` — a real run at `maxTurns: 10` hit
  `error_max_structured_output_retries` and needed 20. `maxTurns: 20` was tuned against the _current,
  simpler_ output shape.
- `src/git.ts:70` — `GENERATED_FILE_EXCLUDES` is documented as covering files whose "diff body is
  noise for a review", where "a change to one of these still shows up in `getChangedFiles` and
  `getDiffStat` — the model sees _that_ it changed". `context/**` fits that description exactly.
- `AGENTS.md` Boundaries — ⚠️ marks `.github/workflows/` changes and dependency additions as
  ask-first. Both came up; the workflow edit was approved, the test runner was declined.

## Desired End State

`src/criteria.ts` is the single source of truth for five criteria, each citing the written rules it
enforces. The agent returns exactly five criterion results (`PASS` | `CONCERN` | `FAIL` |
`NOT_APPLICABLE`, each with a rationale) plus a structured findings array — and **no verdict field at
all**. `src/index.ts` derives the verdict: `FAIL` iff any criterion is `FAIL`, guarded by a validated
biconditional that a `FAIL` criterion carries at least one `BLOCKING` / `CERTAIN` finding with a
`file`. The PR comment renders a criteria table and findings from those structured fields. On `FAIL`,
an `Enforce verdict` workflow step turns the job red — leaving branch protection a switch the user
flips separately. `context/**` bodies no longer reach the prompt.

**How to verify:** run `npm run review` on a branch containing a deliberate rule violation (an API
route missing `prerender = false`); the report shows `api_and_validation_contract` as `FAIL` with a
`file:line` BLOCKING finding, and `emitVerdict` writes `verdict=FAIL`. On a clean branch, all five
are `PASS` or `NOT_APPLICABLE` and the verdict is `PASS`.

## What We're NOT Doing

- Not documenting the criteria in `AGENTS.md` or `context/foundation/` — package README only.
- Not adding a test runner to `packages/code-reviewer`, and not wiring one into `ci.yml`.
- Not changing branch protection or required status checks — that stays a manual, user-owned switch.
- Not touching `model`, `effort`, `maxBudgetUsd`, the 3000-line diff cap, or `action.yml`'s inputs.
- Not implementing per-PR criteria selection (e.g. skipping the RLS criterion when no migration
  changed) — all five always come back, using `NOT_APPLICABLE` instead.
- Not keeping a `complexity` dimension. Its reuse-catching value partly moves into
  `architecture_boundaries`; five criteria that gate beat six that don't.
- Not preserving backwards compatibility with the old output shape. There is one consumer (this
  package) and one contract surface (the action's `verdict` output, which is unchanged).

## Implementation Approach

One array in `src/criteria.ts` drives four consumers:

```
criteria.ts  ──►  schema.ts   (CRITERION_IDS → REVIEW_SCHEMA enum + required keys)
   │              deriveVerdict()  ·  checkConsistency()
   ├──────────►  prompt.ts    (renders criteria + their rules into REVIEWER_APPEND)
   └──────────►  output.ts    (titles → criteria table labels)
                     ▲
                  index.ts  ──► emitVerdict(derived) ──► $GITHUB_OUTPUT
                                                            ▲
                          ai-code-review.yml ── Enforce verdict (exit 1 on FAIL)
```

The division of labour is the point: the model fills only what it can observe from the diff
(criterion status, rationale, findings). The pass/block decision is arithmetic over that, performed
in Node, where it is readable and auditable.

**The five criteria:**

| id                            | Anchored in                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correctness`                 | Generic but indispensable — wrong results, crashes, silent no-ops, missing `await`, unhandled rejection, swallowed errors                                                                |
| `security_and_data_isolation` | `AGENTS.md` 🚫/✅ — RLS with **separate** SELECT/INSERT/UPDATE/DELETE policies per role, never `USING (true)`, `SUPABASE_URL`/`SUPABASE_KEY` server-only, IDOR                           |
| `api_and_validation_contract` | `AGENTS.md` ✅ + Code Style — `prerender = false` on every API route, zod on all input, `@/lib/http` helpers, uppercase handler names, Polish error copy                                 |
| `architecture_boundaries`     | `AGENTS.md` ✅/⚠️/🚫 — strict island architecture, `src/lib` purity vs `src/lib/services`, `@/*` alias, `cn()` only, no `class:list`, no Next directives, `src/components/ui/` untouched |
| `test_discipline`             | `tests/README.md` Hard rules — risk-proportional coverage, **no mocking Supabase**, never assert through `src/lib/services/`, correct vitest pool                                        |

## Critical Implementation Details

**Ordering in the workflow.** `Enforce verdict` must be the **last** step in the job, after
`Remove retry label`. Failing the job earlier would skip any non-`always()` step below it — and the
retry-label removal is what keeps a failed PR retryable. This is also why the gate lives in the
workflow rather than as a non-zero exit from `npm run review`: `ai-code-review.yml:44-58`'s label
steps have no `always()` guard, so a reviewer that exited 1 on `FAIL` would never apply the
`ai-cr:failed` label it just earned.

**Turn budget vs. schema complexity.** `maxTurns: 20` was raised from 10 during the predecessor
change specifically because a real run exhausted its turns before producing valid structured output.
The new shape (nested arrays of objects with four enums) is materially harder to fill. If
`error_max_structured_output_retries` reappears, **raise `maxTurns`, do not simplify the schema** —
the schema is the deliverable here.

**Phase 3 is atomic.** `ReviewOutput` is imported by both `src/output.ts` and `src/index.ts`.
Changing the type in `schema.ts` breaks their typecheck immediately, so schema, prompt, output and
index land as one commit. Splitting it would leave an intermediate state that typechecks but runs
badly (the SDK would force the new shape onto a model still reading the old instructions).

**Consistency violations are errored runs, not degraded reviews.** When `checkConsistency` returns
violations, do not emit a verdict and do not post a comment — log the messages and exit non-zero, the
same path `parseReviewOutput` returning `null` already takes at `src/index.ts:179-183`. A half-trusted
gate is worse than a visibly broken one.

## Phase 1: `src/git.ts` — exclude `context/**` from the embedded diff

### Overview

Stop planning artifacts from being embedded in the reviewed diff body, so full plans can be written
without paying tokens for them on every review. Independent of everything else in this plan.

### Changes Required:

#### 1. Generated-file excludes

**File**: `packages/code-reviewer/src/git.ts`

**Intent**: Add `context/**` to the existing exclude list so plan, brief and research markdown stop
being embedded in the prompt. The agent still sees _that_ these files changed via `getChangedFiles`
and `getDiffStat` — only the bodies are dropped, exactly as for `package-lock.json` today.

**Contract**: `GENERATED_FILE_EXCLUDES` (`src/git.ts:70`) gains one pathspec entry. Update the
adjacent doc comment: the list is no longer only "generated" files — it is files whose diff body is
noise for a review. Consider renaming to reflect that; `getDiff` consumes it unchanged either way.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`

#### Manual Verification:

- On a branch that touches `context/changes/**`, `npm run review` logs still list those files in the
  changed-files section, but the embedded diff contains none of their content
- A branch touching only `src/` produces an unchanged diff body versus before this phase

---

## Phase 2: `src/criteria.ts` — criteria as data

### Overview

Introduce the five internal-anchored criteria as one structured, exported array. Purely additive —
nothing imports it yet, so the package typechecks green on this phase alone.

### Changes Required:

#### 1. The criteria module

**File**: `packages/code-reviewer/src/criteria.ts` (new)

**Intent**: Hold the five criteria as data so the schema keys, the system prompt's "what to look for"
section and the report's table labels all derive from one place — extending the anti-drift intent
`src/schema.ts:1-5` already states for itself.

**Contract**: Exports `CRITERIA`, a readonly tuple of five entries, each
`{ id, title, description, rules, failsWhen }` where `rules` is a list of the written rules the
criterion enforces (phrased as the reviewer will read them, each traceable to `AGENTS.md` or
`tests/README.md`) and `failsWhen` states what separates `FAIL` from `CONCERN`. Also exports
`CRITERION_IDS` derived from `CRITERIA` and the `CriterionId` union type — this is the list
`schema.ts`, `prompt.ts` and `output.ts` consume.

The `as const` shape matters: `CriterionId` must be the literal union `"correctness" |
"security_and_data_isolation" | …`, not `string`, so the schema's enum and `output.ts`'s label lookup
stay type-checked against it.

Ids and anchors are fixed by the table in "Implementation Approach" above.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- `CriterionId` resolves to a five-member literal union, not `string`

#### Manual Verification:

- Every `rules` entry points at a rule that exists in `AGENTS.md` or `tests/README.md` today — no
  invented house rules, matching the existing prompt's "Flag a convention violation only when you can
  point at the rule it breaks"
- Each `failsWhen` describes something checkable against a diff, not a judgment call

**Implementation Note**: Pause for manual confirmation before Phase 3 — the criteria wording is the
substance of this change, and it is far cheaper to adjust here than after the schema and prompt
derive from it.

---

## Phase 3: Contract swap — `schema.ts` + `prompt.ts` + `output.ts` + `index.ts`

### Overview

Replace the scores/verdict/markdown output shape with per-criterion statuses and structured findings,
and move the verdict decision from the model into Node. Atomic — see Critical Implementation Details.

### Changes Required:

#### 1. The output contract

**File**: `packages/code-reviewer/src/schema.ts`

**Intent**: Express the review as data the pipeline can compute over, and remove the model's ability
to author the verdict at all.

**Contract**: `ReviewOutput` becomes `{ summary, criteria, findings }`; `verdict`, `scores`,
`report_markdown` and `SCORE_DIMENSIONS` are removed, while the `Verdict` type stays (it is now
produced, not parsed). Other phases depend on these exact field names:

```ts
type CriterionStatus = "PASS" | "CONCERN" | "FAIL" | "NOT_APPLICABLE";

interface CriterionResult {
  id: CriterionId;
  status: CriterionStatus;
  rationale: string;
}

interface Finding {
  criterion: CriterionId;
  severity: "BLOCKING" | "ADVISORY";
  confidence: "CERTAIN" | "POSSIBLE";
  file: string;
  line: number;
  what: string; // the defect, one sentence
  why: string; // the concrete failure it produces
  fix: string; // described, not patched
}
```

`REVIEW_SCHEMA` mirrors this: enums for the four closed vocabularies, `enum: CRITERION_IDS` for both
`id` and `criterion`, `minItems: 5` / `maxItems: 5` on `criteria`, `additionalProperties: false`
throughout (matching the file's existing style). `parseReviewOutput` narrows the new shape, returning
`null` on mismatch as today.

**File**: `packages/code-reviewer/src/schema.ts` (same file, new exports)

**Intent**: Make the gate rule a readable, pure function, and make the "a FAIL is always backed by
evidence" property enforced rather than hoped for.

**Contract**: Two new exports.

`deriveVerdict(output: ReviewOutput): Verdict` — pure; `"FAIL"` iff any criterion status is `"FAIL"`,
`"PASS"` otherwise. `CONCERN` and `NOT_APPLICABLE` never block.

`checkConsistency(output: ReviewOutput): string[]` — returns human-readable violation messages, empty
when clean. Rules:

- exactly five results, ids equal to `CRITERION_IDS` as a set, no duplicates
- every finding's `criterion` is a known id
- a `NOT_APPLICABLE` criterion carries no findings
- a `BLOCKING` finding is always `CERTAIN` and has a non-empty `file`
- the biconditional: a criterion has status `FAIL` **iff** it has ≥1 `BLOCKING` finding

The biconditional is enforced in both directions deliberately — a `BLOCKING` finding filed under a
criterion the model marked `PASS` is the same contradiction as an evidence-free `FAIL`.

#### 2. Reviewer instructions

**File**: `packages/code-reviewer/src/prompt.ts`

**Intent**: Teach the model the five internal criteria and the new reporting contract, and tell it
plainly that the overall verdict is computed by the pipeline and is not its to write.

**Contract**: `REVIEWER_APPEND` keeps its name and remains a `const string` (so `index.ts:16` needs no
import change), but is now built by rendering `CRITERIA` — id, title, description, rules, `failsWhen`
— into the "What to look for" section. The "How to report" section is rewritten for the three fields:

- `criteria` — all five, always, in `CRITERIA` order. Define `NOT_APPLICABLE` narrowly: nothing in
  the diff touches the criterion's surface. `CONCERN` is for a real but non-blocking issue.
- `findings` — the object fields above; every finding cites the `file:line` it was verified against,
  in the code actually opened. `POSSIBLE` findings must state what would settle them, and can never
  be `BLOCKING`.
- `summary` — 2–3 sentences: what the change does and what drove the criterion statuses.
- State the biconditional explicitly, and that a run whose statuses and findings disagree is rejected.

The existing "Project conventions", "How to investigate" and no-formatting-nits guidance stay. The
`verdict` and `scores` sections are deleted. `buildTaskPrompt` and `TaskPromptInput` are unchanged.

#### 3. Report rendering

**File**: `packages/code-reviewer/src/output.ts`

**Intent**: Render the comment from the new structured fields, completing the design the file's own
comment at `output.ts:44-48` already describes.

**Contract**: `formatScoresTable` → `formatCriteriaTable(criteria)`, emitting
`| Criterion | Status | Notes |` with labels read from `CRITERIA[].title` — which deletes the
duplicated `DIMENSION_LABELS` map at `output.ts:15-21`. `formatFindings(findings)` renders the array,
`BLOCKING` before `ADVISORY`, each entry carrying location, what / why / fix and a confidence badge;
an empty array still yields "No findings." `stripLeadingFindingsHeading` becomes dead — delete it.
`formatReport` and `deliverReport` take the verdict as an explicit parameter, since it is no longer
on `ReviewOutput`. `ReportMeta` and `emitVerdict` are otherwise unchanged.

#### 4. Wiring

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Validate the model's output, compute the verdict from it, and thread that verdict to both
the step output and the report.

**Contract**: After `parseReviewOutput` succeeds, run `checkConsistency`; a non-empty result logs the
violations, sets `failed = true`, and skips both `emitVerdict` and `deliverReport` — the same exit
path a `null` parse already takes. Otherwise `deriveVerdict(reviewOutput)` produces the verdict
passed to `emitVerdict()` and `deliverReport()`. `ALLOWED_TOOLS`, `DISALLOWED_TOOLS`, `maxTurns`,
`model`, `effort` and `maxBudgetUsd` are unchanged.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- No references remain to `SCORE_DIMENSIONS`, `scores`, `report_markdown`, `DIMENSION_LABELS` or
  `stripLeadingFindingsHeading`: `grep -rn "SCORE_DIMENSIONS\|report_markdown\|DIMENSION_LABELS\|stripLeadingFindingsHeading" packages/code-reviewer/src`

#### Manual Verification:

- `npm run review` on a real multi-file branch returns five criterion results and a structured
  findings array, with no `error_max_structured_output_retries`
- The rendered report shows the criteria table and findings; the printed verdict matches
  `deriveVerdict`'s rule (FAIL iff some criterion is FAIL)
- A deliberate rule violation (drop `export const prerender = false` from an API route) fails
  `api_and_validation_contract` with a `file:line` BLOCKING finding
- A deliberate RLS violation (`USING (true)` in a migration) fails `security_and_data_isolation`
- A docs-only diff marks the inapplicable criteria `NOT_APPLICABLE` rather than inventing a judgment
- Turn count and cost stay in the range the README documents ($0.30–1.00)

**Implementation Note**: Pause for manual confirmation before Phase 4 — the gate should not go live
until the criteria have produced sensible statuses on at least one real branch.

---

## Phase 4: `.github/workflows/ai-code-review.yml` — the gate

### Overview

Make the job go red on a `FAIL` verdict, without disturbing labelling or the retry escape hatch.
⚠️ Workflow change — approved during planning.

### Changes Required:

#### 1. Enforce step

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: Turn the verdict into a check the pipeline can be gated on, while leaving the decision to
require that check in branch protection to a separate human action.

**Contract**: A new final step, `Enforce verdict`, guarded by
`if: steps.review.outputs.verdict == 'FAIL'`, emitting a `::error::` annotation that points at the
review comment and exiting 1. It must sit **after** `Remove retry label` (`ai-code-review.yml:63-67`,
which is `if: always()`), so labelling and retry cleanup both complete before the job fails. No other
step changes; `action.yml` is untouched.

### Success Criteria:

#### Automated Verification:

- Workflow parses: `gh workflow view "AI Code Review"` (or an equivalent lint) reports no syntax error

#### Manual Verification:

- A PR whose review returns `FAIL` gets the `ai-cr:failed` label **and** a red job, and the
  `ai-cr:review` retry label is still removed
- A PR whose review returns `PASS` gets `ai-cr:passed` and a green job
- A run that errors before producing a verdict still fails the job (existing behavior) and the
  enforce step is skipped rather than erroring on an empty verdict
- Re-applying `ai-cr:review` to a failed PR re-runs the review

---

## Phase 5: `packages/code-reviewer/README.md` — docs

### Overview

Bring the package docs in line: the criteria, the gate rule, and the fact that the verdict now has
teeth.

### Changes Required:

#### 1. Documentation

**File**: `packages/code-reviewer/README.md`

**Intent**: Make the bar a PR will be judged against readable without opening the source, and remove
statements that this change falsifies.

**Contract**: Four edits.

- New "Review criteria" section — the five ids, their rule anchors, and the status enum including
  what `NOT_APPLICABLE` means.
- New "Gate rule" section — `FAIL` iff a criterion is `FAIL`; the evidence biconditional; that the
  job goes red but adding the check to branch protection is a separate manual switch.
- "How it is wired" table — update the `outputFormat` row to describe the new shape and note the
  verdict is computed in `index.ts`, not model-authored.
- Delete/rewrite the "Since the verdict is not a merge gate, the latency costs patience, not CI
  throughput" sentence (`README.md:111-112`) — no longer true. Update the "Diff size cap" section for
  the `context/**` exclusion, extend "Layout" with `src/criteria.ts`, `src/schema.ts` and
  `src/output.ts`, and repoint "To change what the reviewer looks for … edit `src/prompt.ts`" at
  `src/criteria.ts`.

### Success Criteria:

#### Manual Verification:

- README's criteria list, gate rule and wiring table match the implemented behavior
- No sentence in the README still describes the verdict as non-blocking
- A reader who has never seen the source can tell what will fail their PR

---

## Testing Strategy

This package has no test runner by decision (see "What We're NOT Doing"), so verification is
typecheck plus deliberate-break manual runs. `deriveVerdict` and `checkConsistency` are written as
pure exported functions specifically so a runner can be added later without rework.

### Deliberate-break scenarios (Phase 3):

Each targets one criterion, on a scratch branch, verified via `npm run review`:

1. API route with `export const prerender = false` removed → `api_and_validation_contract` FAIL
2. Migration policy using `USING (true)` → `security_and_data_isolation` FAIL
3. Static markup added as a React island with no events or state → `architecture_boundaries` CONCERN
   or FAIL
4. New service function with a risky branch and no test → `test_discipline` CONCERN
5. Docs-only diff → most criteria `NOT_APPLICABLE`, verdict PASS

### Consistency-check verification:

The biconditional cannot be triggered on demand from a real run. Verify it by temporarily mutating a
parsed `ReviewOutput` in `index.ts` (a criterion forced to `FAIL` with no findings) and confirming the
run logs the violation, emits no verdict, posts no comment, and exits 1. Revert before committing.

### Manual Testing Steps:

1. Phase 1: run on a branch touching `context/changes/**`; confirm those files appear in the file
   list but not in the embedded diff body.
2. Phase 3: run each deliberate-break scenario above; confirm the failing criterion, the `file:line`
   BLOCKING finding, and the derived verdict.
3. Phase 3: run on a clean branch; confirm PASS with no findings and no invented nits.
4. Phase 4: open a real PR with scenario 1 applied; confirm red job, `ai-cr:failed` label, retry
   label removed; then fix and confirm green with `ai-cr:passed`.

## Performance Considerations

Two forces pull in opposite directions. The `context/**` exclusion (Phase 1) removes what is often
the largest markdown body in a change's diff, cutting prompt size. The richer schema (Phase 3) costs
more output tokens and is harder to fill, which may raise turn count. Expect cost to stay inside the
README's documented $0.30–1.00 band; if it does not, the diagnosis is turn count, and the response is
`maxTurns`, not a simpler schema.

## Migration Notes

No data or schema migration. One contract break: `src/schema.ts`'s output shape changes wholesale.
The action's `verdict` output — the only surface outside this package — keeps its name, its values and
its `$GITHUB_OUTPUT` mechanism, so `action.yml` needs no change. The rollback is a revert of Phases
3–5; Phases 1 and 2 are independently safe to keep.

## References

- Predecessor change: `context/archive/2026-08-11-cicd-review-impr/plan-brief.md` (embedded diff,
  turn budget, the `maxTurns` 10→20 history)
- Original build: `context/archive/2026-08-09-cicd-code-review/plan.md`
- Two-pager for this plan: `context/changes/code-review-impr/plan-brief.md`
- Internal rules the criteria cite: `AGENTS.md` (Boundaries, Code Style), `tests/README.md`
  (Conventions, Hard rules)
- Contract warning: `packages/code-reviewer/README.md:15-18`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles.

### Phase 1: src/git.ts — exclude `context/**` from the embedded diff

#### Automated

- [x] 1.1 `npm run typecheck` passes

#### Manual

- [x] 1.2 A branch touching `context/changes/**` lists those files but embeds none of their bodies
- [x] 1.3 A branch touching only `src/` produces an unchanged diff body

### Phase 2: src/criteria.ts — criteria as data

#### Automated

- [ ] 2.1 `npm run typecheck` passes
- [ ] 2.2 `CriterionId` resolves to a five-member literal union, not `string`

#### Manual

- [ ] 2.3 Every `rules` entry traces to a rule in `AGENTS.md` or `tests/README.md` today
- [ ] 2.4 Every `failsWhen` is checkable against a diff, not a judgment call

### Phase 3: Contract swap — schema.ts + prompt.ts + output.ts + index.ts

#### Automated

- [ ] 3.1 `npm run typecheck` passes
- [ ] 3.2 No references remain to `SCORE_DIMENSIONS`, `report_markdown`, `DIMENSION_LABELS` or `stripLeadingFindingsHeading`

#### Manual

- [ ] 3.3 A real multi-file branch returns five criterion results and a findings array, no `error_max_structured_output_retries`
- [ ] 3.4 Report renders the criteria table and findings; verdict matches `deriveVerdict`'s rule
- [ ] 3.5 Deliberate break: missing `prerender = false` fails `api_and_validation_contract` with a `file:line` BLOCKING finding
- [ ] 3.6 Deliberate break: `USING (true)` fails `security_and_data_isolation`
- [ ] 3.7 A docs-only diff yields `NOT_APPLICABLE` rather than invented judgments
- [ ] 3.8 Consistency check verified via a temporary forced inconsistency: violations logged, no verdict, no comment, exit 1
- [ ] 3.9 Cost and turn count stay within the README's documented band

### Phase 4: ai-code-review.yml — the gate

#### Automated

- [ ] 4.1 Workflow parses with no syntax error

#### Manual

- [ ] 4.2 A FAIL PR gets `ai-cr:failed`, a red job, and its retry label removed
- [ ] 4.3 A PASS PR gets `ai-cr:passed` and a green job
- [ ] 4.4 An errored run still fails the job; the enforce step is skipped on an empty verdict
- [ ] 4.5 Re-applying `ai-cr:review` re-runs the review on a failed PR

### Phase 5: README.md — docs

#### Manual

- [ ] 5.1 Criteria list, gate rule and wiring table match the implemented behavior
- [ ] 5.2 No sentence still describes the verdict as non-blocking
