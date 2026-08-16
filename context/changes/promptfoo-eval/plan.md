# Promptfoo prompt eval for the CI/CD code reviewer — Implementation Plan

## Overview

Build a **durable but decoupled** promptfoo evaluation rig beside the CI/CD code reviewer, and
use it to tune `REVIEWER_APPEND` (`packages/code-reviewer/src/prompt.ts:21-96`) — specifically
the FAIL⇔BLOCKING consistency rule at `:85-90`.

The rig scores prompt variants on **output validity and precision**, not catch rate. The frame
established that catch rate is saturated: 40/40 violation runs caught across every model cell,
zero misses, zero false positives. The only signal that has ever varied in 48 runs is output
discipline — 3 runs where the model marked a criterion `FAIL` without a `BLOCKING` finding, each
of which discards the entire review in production (`index.ts:310-322`).

Measurement headroom comes from a new corpus of **multi-issue fixtures with deliberate decoys**,
where a run scores 0–N rather than pass/fail.

## Current State Analysis

`packages/code-reviewer/src/eval/` is a working, shipped eval harness:

| Module                              | Role                                                                        | Reusable here?                                |
| ----------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| `fixtures.ts`                       | Loads `fixtures/<id>/{fixture.json,change.patch}`                           | Yes — needs an additive expectation shape     |
| `worktree.ts`                       | Detached worktree at a pinned SHA, patch/commit/remove, signal-safe cleanup | Yes — unchanged                               |
| `score.ts`                          | Pure categorical scorer, one outcome per run                                | Yes — needs its `errored` bucket split        |
| `cells.ts` / `run.ts` / `report.ts` | The **model**-axis sweep                                                    | Untouched — different question, stays working |
| `check.ts`                          | `--check` mode: applies every patch, no model call                          | Yes — extended with corpus validation         |

What is missing or wrong:

- **`score.ts:64` conflates three failure modes into one `errored` bucket** — `output === null`,
  a consistency violation, and a non-`success` subtype all collapse together. The scorer
  literally cannot express the only signal that has ever varied. `checkConsistency`
  (`schema.ts:168-219`) already produces distinct, human-readable violation strings; the scorer
  throws that resolution away.
- **The corpus is saturated.** All six fixtures carry exactly one planted defect in a 13–75 line
  diff. `model-eval`'s own `results.md` Caveat 1 concedes there is "no competing signal and no
  ambiguity about which file to look at."
- **There is no seam for a prompt variant.** `REVIEWER_APPEND` is a module-level const consumed
  directly at `index.ts:222`; `runReview()` accepts `model` and `effort` but not a prompt override.
- **`score.ts` scores one expectation per run**, so it cannot express per-defect recall or
  precision against a decoy list.

## Desired End State

`packages/code-reviewer/promptfoo/` holds a self-contained prompt-eval rig that can be re-run at
any time with `npm run eval:prompt`. It is **not wired into the review flow**: no CI job,
`ai-code-review.yml` untouched, and the production review path behaves identically whether the
rig exists or not. `REVIEWER_APPEND` carries the winning variant's consistency-rule wording, and
`context/changes/promptfoo-eval/results.md` records the sweep that chose it.

Verify by: `npm run eval:prompt -- --repeat 2` reproduces a 24-run grid; `git log -p` shows no
change to `.github/workflows/ai-code-review.yml` or `.github/actions/ai-code-review/`; and a real
PR review still runs and posts a comment.

### Key Discoveries:

- **Promptfoo's built-in `anthropic:claude-agent-sdk` provider cannot host this rig.** It exposes
  every option `index.ts:217-237` sets, but `working_dir` is documented only as a provider-level
  constant ("relative values resolved from the directory containing the config file"), and the
  coding-agent guide explicitly recommends "provider-level defaults… without per-test
  setup/teardown." This rig needs a _distinct_ worktree per fixture per run
  (`worktree.ts:57`, `randomUUID()`).
- **Custom TS providers are first-class.** `file://./provider.ts`, `callApi(prompt, context)` →
  `ProviderResponse { output, error, cost, tokenUsage, metadata }`. Promptfoo's Node loader
  compiles `.ts` directly, no build step.
- **Promptfoo's prompt axis maps exactly onto the prompt override.** Multiple `prompts:` entries
  compared across identical tests is promptfoo's core grid; `callApi`'s `prompt` argument becomes
  `reviewerAppend`. No custom sweeping logic is needed.
- **Named metrics are the graded-scoring mechanism.** Per-assertion `metric:` labels aggregate
  into `namedScores`; several `type: javascript` assertions over one shared grade module give
  recall/precision/validity side by side.
- **Promptfoo has no concept of excluding a run from scoring.** `EvaluateStats` tracks
  `successes`/`failures`/`errors` separately, but an error still counts against the run. The
  `rate_limited` exclusion `run.ts:88-101` provides has no native equivalent — it must be
  surfaced as an error and excluded by hand when reading the report.
- **`matchesExpectedFile` (`score.ts:42-46`) matches on normalized path _suffix_, not equality** —
  deliberately, because `finding.file` may be an absolute path into an OS temp worktree. Any new
  matching logic must reuse it.
- `MAX_DIFF_LINES = 3000` (`git.ts:96`). A 300–600 line fixture sits comfortably under it.
- `promptfoo@0.122.0` is current, and supports `--repeat N` for repeats.

## What We're NOT Doing

- **No regression gate against the existing six fixtures.** Explicitly cut: 24 runs decide the
  winner. The six fixtures stay in the repo as the model sweep's corpus but do not gate this
  decision. (See Open Risks in `plan-brief.md`.)
- **No CI integration.** No workflow, no required check, no job. The rig is run by hand.
- **Not touching `criteria.ts`.** The frame settled that `REVIEWER_APPEND` is the lever; the
  criteria wording and the severity semantics they imply stay as they are.
- **Not replacing the model sweep.** `cells.ts` / `run.ts` / `report.ts` keep working.
- **Not exercising the `truncateDiff` cap.** A defect past the cut line is invisible to the model,
  so the score would measure where the cut fell rather than prompt quality.
- **Not building line-range defect matching.** Designed out via the one-planted-item-per-file rule.
- **No LLM-as-judge assertions.** The scorer stays deterministic and model-call-free.

## Implementation Approach

Promptfoo owns the **grid and the reporting**; the existing harness owns **worktrees, fixtures,
and scoring**. A custom TS provider is the seam between them: it calls the real `runReview()`
inside the real `withFixtureWorktree()`, so what is measured is the production path — promptfoo's
own "test the system, not the model" guidance — rather than a reimplementation that can drift.

Scoring is a **superset**, not a replacement. `gradeRun()` handles the new `multi` expectation and
also degrades cleanly to the existing `violation` (one defect, no decoys) and `clean` (no defects)
shapes. That is what lets Phase 2 smoke-test the whole rig against an existing single-defect
fixture _before_ any expensive fixture authoring.

**Scoring formula.** Per run:

- `valid` — `output !== null`, `resultSubtype === "success"`, and `consistencyViolations` empty.
- `caught` — a planted defect counts caught iff some `BLOCKING` finding cites its criterion **and**
  matches its file.
- `falsePositives` — any `BLOCKING` finding on a file carrying **no** planted defect. Declared
  decoys are the deliberately tempting subset, reported separately as `decoyHits`. Penalising only
  declared decoys would let a variant spray BLOCKINGs across ordinary files for free.
- `score` = `valid ? max(0, (caught − falsePositives) / planted) : 0`.

The penalty weight is 1 and justifies itself: one wrongly-blocked PR costs exactly one missed
defect. Zeroing an invalid run mirrors production, where an inconsistent review is discarded
outright (`index.ts:313-315`).

## Critical Implementation Details

**Fixture authoring: one planted item per file.** Every defect and every decoy lives in its own
distinct file. 4–6 defects plus 3–4 decoys across 300–600 lines gives 7–10 files at ~40–85 lines
each — realistic for a feature PR — and makes `matchesExpectedFile`'s existing file-suffix match
sufficient. Line-range matching against a model's approximate line numbers would be a ground-truth
stability problem, and this rule designs it out. Enforced mechanically at fixture load.

**Single-axis variant construction.** The variants must differ _only_ in the consistency-rule
paragraph. Build each from a shared `buildReviewerAppend(consistencyBlock)` helper rather than
maintaining four full copies of the prompt — four hand-maintained copies will drift on some other
line and silently turn a single-axis sweep into a multi-axis one.

**Ordering inside `scoreRun`'s new branch.** `rate_limited` must stay first (it is checked on the
synthetic subtype before anything else), then `errored` for a null output or non-`success`
subtype, then `inconsistent`. Checking `inconsistent` first would misclassify a run that both
failed and produced no output.

## Phase 1: Shared eval core — split the errored bucket, add the graded scorer

### Overview

Make the existing harness able to express the signal the sweep depends on, and add a pure graded
scorer. No model calls anywhere in this phase; every change is verifiable by replaying the 48
records already in `eval-results/runs.jsonl`.

### Changes Required:

#### 1. Split the conflated failure bucket

**File**: `packages/code-reviewer/src/eval/score.ts`

**Intent**: A consistency violation is the only signal that has ever varied across 48 runs, and it
is currently indistinguishable from an SDK crash. Separate the two so both the model sweep and the
new grader can see it.

**Contract**: `RunOutcome` gains `"inconsistent"`. The single conditional at `:64` becomes two,
in the order stated under Critical Implementation Details. `RATE_LIMITED_SUBTYPE` and the
`matchesExpectedFile` / `hasBlockingFindingOnExpectedFile` helpers are unchanged and stay exported
for `grade.ts` to reuse.

#### 2. Surface the new bucket in the model-sweep report

**File**: `packages/code-reviewer/src/eval/report.ts`

**Intent**: `summarizeCell` counts `errored` and the tier-2 ranking sorts on it. Both must account
for the new outcome or three runs silently vanish from the matrix.

**Contract**: `CellSummary` gains `inconsistent: number`; the matrix gains an "Inconsistent"
column; `rankCells`' tier-2 comparator sorts on `errored + inconsistent` so existing ranking
semantics are preserved while the breakdown becomes visible.

#### 3. Additive multi-defect expectation shape

**File**: `packages/code-reviewer/src/eval/fixtures.ts`

**Intent**: Express N planted defects and M decoys per fixture, without disturbing the six
existing fixtures whose `violation` / `clean` shapes must keep loading unchanged.

**Contract**: `FixtureExpectation` gains a third member. Each defect carries the `AGENTS.md` /
`tests/README.md` rule it breaks, so ground truth stays contestable-proof at multi-issue scale:

```ts
export interface PlantedDefect {
  id: string;
  criterion: CriterionId;
  file: string; // exactly one file per defect
  rule: string; // the written rule it breaks, e.g. "AGENTS.md 🚫 — never USING (true)"
}
export interface Decoy {
  id: string;
  file: string; // exactly one file per decoy
  note: string; // why this is innocent despite looking guilty
}
export type FixtureExpectation =
  | { kind: "violation"; criterion: CriterionId; files: string[] }
  | { kind: "clean" }
  | { kind: "multi"; defects: PlantedDefect[]; decoys: Decoy[] };
```

`loadFixtures()` gains validation that throws on load: ids unique within a fixture, every `file`
across defects **and** decoys distinct, `rule` and `note` non-empty.

#### 4. The graded scorer

**File**: `packages/code-reviewer/src/eval/grade.ts` (new)

**Intent**: Produce per-run recall, precision, validity and a composite score, as a pure function
of a stored run plus its fixture — model-call-free and therefore replayable, exactly as `score.ts`
is today.

**Contract**: `gradeRun(fixture, run): RunGrade`, handling all three expectation kinds
(`violation` → one defect, no decoys; `clean` → no defects, so `score` is 1 when there are no
BLOCKING findings at all and 0 otherwise). Reuses `matchesExpectedFile`.

```ts
export interface RunGrade {
  valid: boolean;
  planted: number;
  caught: number;
  falsePositives: number; // BLOCKING on a file with no planted defect
  decoyHits: number; // the subset landing on declared decoy files
  misattributed: number; // BLOCKING on a defect's file under the wrong criterion
  advisoryOnNonDefect: number; // tracked, never scored
  score: number; // valid ? max(0,(caught-falsePositives)/planted) : 0
  violations: string[]; // consistency violation messages, surfaced not swallowed
}
```

`misattributed` counts as neither `caught` nor a false positive — the model did find something
real at that location — but is reported so a variant that shuffles criteria is visible.

#### 5. Replay verification

**File**: `packages/code-reviewer/src/eval/replay.ts` (new)

**Intent**: Prove the scorer changes are correct against evidence that already exists, with no
quota spend. The frame derived the exact expected numbers, so this is a real assertion rather than
a smoke test.

**Contract**: Reads `RESULTS_PATH`, re-scores every record through `scoreRun` and `gradeRun`,
prints the outcome tally, and exits non-zero unless: totals are `caught: 37, clean_pass: 8,
inconsistent: 3, errored: 0, missed: 0, misattributed: 0, false_positive: 0, rate_limited: 0`; and
the three `inconsistent` records are exactly `haiku-high × rls-using-true`, `haiku-high ×
service-layer-assert`, `sonnet-high × rls-using-true`. Wired as `npm run eval:replay`.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Fixture corpus still applies cleanly: `npm run eval:check`
- Replay reproduces the expected tally and names the 3 inconsistent runs: `npm run eval:replay`
- Model-sweep report still renders with the new column: `npm run eval:report`
- Repo-wide gates pass: `npm run typecheck && npm run lint && npm test`

#### Manual Verification:

- `npm run eval:report` output reads correctly — the three runs formerly counted as `errored` now
  appear under "Inconsistent", and the ranking is unchanged from `model-eval`'s published result

**Implementation Note**: After completing this phase and all automated verification passes, pause
for manual confirmation before proceeding.

---

## Phase 2: Promptfoo rig — provider, assertions, variants

### Overview

Stand up the complete rig and prove it end-to-end against an **existing** single-defect fixture.
Discovering a provider problem after hand-authoring three 500-line fixtures is the expensive
ordering; this phase exists to make that impossible.

### Changes Required:

#### 1. The prompt-override seam

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: `REVIEWER_APPEND` is baked in at `:222`, so there is no way to run a variant. This is
the single unavoidable edit to a production file.

**Contract**: `RunReviewOptions` gains `reviewerAppend?: string`, defaulting to `REVIEWER_APPEND`
and passed to `systemPrompt.append`. Backwards-compatible: every existing caller is unaffected.

#### 2. Package wiring

**File**: `packages/code-reviewer/package.json`

**Intent**: Add promptfoo as a dev-only dependency and a script to run the rig. Per `AGENTS.md`'s
"⚠️ Ask first" rule on dependencies — promptfoo adoption was explicitly approved as the goal of
this change.

**Contract**: `devDependencies` gains `promptfoo@^0.122.0`. Scripts gain
`eval:prompt` → `promptfoo eval -c promptfoo/promptfooconfig.yaml` and `eval:replay`
→ `tsx src/eval/replay.ts`. No change to the `review` script — the production entrypoint is
untouched.

#### 3. Custom provider

**File**: `packages/code-reviewer/promptfoo/provider.ts` (new)

**Intent**: Bridge promptfoo's grid to the real reviewer — one worktree per test case, the real
`runReview()`, the real SDK options — so what is measured is the production path.

**Contract**: Default-exports a class implementing `ApiProvider`. `callApi(prompt, context)` reads
`context.vars.fixtureId`, loads that fixture, and runs
`withFixtureWorktree(fixture, (wt) => runReview({ repoRoot: wt, base: fixture.baseSha, branch,
prTitle, prBody, model, effort, reviewerAppend: prompt }))`. Model and effort come from provider
`config`, defaulting to the production `claude-sonnet-5` @ `high`.

Returns `{ output: <the ReviewRun>, cost: run.costUsd, metadata: { resultSubtype,
consistencyViolations, numTurns, durationMs } }`. A thrown call is classified with `run.ts`'s
existing `classifyThrownError`; a rate-limited one returns `{ error: "rate_limited: …" }` so it
lands in promptfoo's `errors` bucket and stays visible. **Promptfoo cannot exclude it from
scoring** — that must be done by hand when reading the report, and is documented in the rig's
README.

#### 4. Graded assertions

**File**: `packages/code-reviewer/promptfoo/grade-assert.ts` (new)

**Intent**: Expose `gradeRun`'s components as separate promptfoo named metrics, so the report shows
_which_ component moved rather than only the composite.

**Contract**: Exports one function per metric (`composite`, `recall`, `precision`, `validity`),
each with promptfoo's assertion signature and each returning `{ pass, score, reason }`. Referenced
from the config as `type: javascript`, `value: file://./grade-assert.ts:<name>`, each carrying its
own `metric:` label. `reason` includes the consistency-violation text when validity fails, so a
zeroed run is legible in the UI rather than an unexplained 0.

#### 5. Prompt variants

**File**: `packages/code-reviewer/promptfoo/variants/index.ts` (new)

**Intent**: Four whole-prompt texts that differ **only** in the FAIL⇔BLOCKING paragraph
(`prompt.ts:85-90`), constructed mechanically so drift on any other line is impossible.

**Contract**: `buildReviewerAppend(consistencyBlock: string): string` returns the full
`REVIEWER_APPEND` text with that one block substituted; the module exports four named variants
built through it:

- `incumbent` — the current `:85-90` wording verbatim (the control)
- `restated` — the biconditional split into two explicit one-directional rules
- `worked-example` — the rule plus a short concrete example of a correct and an incorrect pairing
- `checklist` — the rule recast as a pre-submit check to perform before emitting the output

Sourcing the surrounding text from `prompt.ts` rather than copying it keeps the control genuinely
identical to production.

#### 6. Config

**File**: `packages/code-reviewer/promptfoo/promptfooconfig.yaml` (new)

**Intent**: The grid definition — four prompts × the multi-issue fixtures, one provider.

**Contract**: `prompts:` references the four variants; `providers:` is
`file://./provider.ts` with `config: { model: claude-sonnet-5, effort: high }`; `tests:` is one
entry per multi-issue fixture with `vars: { fixtureId }` and the four metric assertions.
`defaultTest` carries the assertions so each test entry stays to its `vars`.

#### 7. Rig documentation

**File**: `packages/code-reviewer/promptfoo/README.md` (new)

**Intent**: State the decoupling contract explicitly, so a future reader does not wire this into
CI by mistake, and record the rate-limit caveat.

**Contract**: Covers how to run it, the scoring formula and why the penalty weight is 1, the
one-planted-item-per-file authoring rule, the manual rate-limited-run exclusion, and a plain
statement that this rig is **not** part of the review flow and has no CI job.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Promptfoo resolves the config and provider without error: `npx promptfoo validate -c promptfoo/promptfooconfig.yaml`
- Smoke run completes: one variant × one **existing** fixture × one run, via
  `npm run eval:prompt -- --filter-providers … --filter-pattern …`, producing a graded result
- Repo-wide gates pass: `npm run typecheck && npm run lint && npm test`

#### Manual Verification:

- The smoke run's worktree is created and removed — `git worktree list` is clean afterwards
- Provider `metadata` shows the SDK options actually used and they match `index.ts:217-237`
- The four variants differ **only** in the consistency paragraph (diff them pairwise)
- A deliberately broken run (temporarily force a consistency violation) scores 0 with the violation
  text in `reason`

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: The multi-issue fixture corpus

### Overview

Hand-author the three fixtures that supply the measurement headroom. This is the expensive,
judgement-heavy phase and the one that most determines whether the sweep measures anything.

### Changes Required:

#### 1. Three multi-issue fixtures

**Files**: `packages/code-reviewer/src/eval/fixtures/multi-*/{fixture.json,change.patch}` (new)

**Intent**: Diffs large enough that the model must budget `maxTurns: 20` across the surface rather
than performing a lookup, carrying both real defects and innocent-but-tempting decoys so precision
becomes measurable alongside recall.

**Contract**: Each is 300–600 diff lines, `kind: "multi"`, 4–6 defects and 3–4 decoys, **one
planted item per file**, every defect citing the written rule it breaks. All three pin `baseSha`
to the current `master` HEAD at authoring time and use an `eval/multi-*` branch name, matching the
existing fixtures' convention.

- **`multi-board-filters`** — a board filtering feature spanning an API route, a service function,
  a React island, a migration and a test.
  Defects: missing `prerender = false`; input reaching a query unvalidated by zod; a Supabase call
  placed in `src/lib/`; a swallowed `await`; a test asserting through `src/lib/services/`.
  Decoys: a React component that genuinely needs state (island rule satisfied); a `src/lib/` file
  that is genuinely pure; a `USING (true)` appearing **inside a SQL comment**.
- **`multi-followup-reminders`** — a reminders feature spanning a migration, an endpoint, a hook
  and a test.
  Defects: RLS missing its DELETE policy; English error copy where Polish is required; Tailwind
  classes concatenated instead of `cn()`; a missing `await`.
  Decoys: a migration whose four per-role RLS policies are all correct; a `class:list`-looking
  string inside a comment; a node-pool test that correctly belongs in the node pool.
- **`multi-scraper-parser`** — parser work spanning a parser, its test, and a route.
  Defects: an `HTMLRewriter` test placed in the node pool instead of workers; a relative deep
  import bypassing `@/*`; `SUPABASE_KEY` reaching a response body.
  Decoys: a parser test correctly placed in the workers pool; a legitimate server-only
  `SUPABASE_URL` reference; a `src/components/ui/` file left exactly as upstream ships it.

The `rls-using-true` fixture produced 2 of the 3 known consistency violations by over-`FAIL`ing
`correctness` and `test_discipline` on a migration diff, so **every** fixture should include a
migration-adjacent surface — it is an empirically confirmed over-flag magnet and therefore the
most valuable precision probe available.

#### 2. Corpus validation in `--check`

**File**: `packages/code-reviewer/src/eval/check.ts`

**Intent**: The one-item-per-file rule and the rule citations are load-bearing for ground truth;
enforce them rather than trusting authoring discipline.

**Contract**: After applying each patch, assert that every declared defect and decoy file actually
exists in the worktree and is present in the fixture's diff. Combined with `loadFixtures()`'
uniqueness validation, a fixture that drifts from its declared ground truth fails `eval:check`
rather than silently mis-scoring a sweep.

### Success Criteria:

#### Automated Verification:

- All nine fixtures apply cleanly and validate: `npm run eval:check`
- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Each new fixture's diff is within 300–600 lines and under `MAX_DIFF_LINES`
- One 1-variant × 3-fixture × 1-run pass produces a non-degenerate composite score (strictly
  between 0 and 1 on at least one fixture — proving the corpus is neither saturated nor impossible)

#### Manual Verification:

- Every planted defect is genuinely a defect, and its cited `AGENTS.md` / `tests/README.md` rule
  really says what the citation claims
- Every decoy is genuinely innocent — a careful human reviewer would not flag it
- Each diff reads as a plausible feature PR, not as an obstacle course
- Defect and decoy files are disjoint, and each holds exactly one planted item

**Implementation Note**: Pause for manual confirmation before proceeding — this phase's ground
truth is what every later number depends on.

---

## Phase 4: Run the sweep and decide

### Overview

Spend the quota: 4 variants × 3 fixtures × 2 repeats = 24 runs. Rank, pick a winner, and record
the reasoning.

### Changes Required:

#### 1. The sweep

**Command**: `npm run eval:prompt -- --repeat 2`

**Intent**: Produce the grid that decides the winner.

**Contract**: 24 runs. Rate-limited runs are excluded by hand from every denominator and the
exclusion is stated in the writeup. If the subscription quota stops the sweep partway, the
completed variants are still comparable _only_ if each ran the full 3 fixtures × 2 repeats —
partial variants are re-run rather than compared.

#### 2. Results writeup

**File**: `context/changes/promptfoo-eval/results.md` (new)

**Intent**: Record what was measured and why the winner won, in enough detail that the decision is
auditable later without re-running anything — the role `model-eval/results.md` plays for the model
axis.

**Contract**: Per-variant table of mean composite, recall, precision, validity rate, decoy hits,
and misattribution count; the raw per-run grid; the ranking rule applied (mean composite, tied on
validity rate, then mean recall); any excluded runs with reasons; and an explicit **caveats**
section carrying forward the two known limitations — no regression floor was run, and the sample
is 6 runs per variant.

### Success Criteria:

#### Automated Verification:

- 24 runs recorded, with every variant having completed all 3 fixtures × 2 repeats
- `npx promptfoo view` renders the grid with all four named metrics populated
- No worktrees leaked: `git worktree list` shows only real worktrees

#### Manual Verification:

- The grid is **not** flat — variants are separated by more than run-to-run noise. If it is flat,
  stop and record that as the finding rather than picking a winner from noise
- The winner's advantage is attributable to a named metric, not only the composite
- Spot-check two runs' raw `ReviewOutput` against their grades to confirm the scorer agrees with
  human judgement
- Human approves the winner before Phase 5 applies it

**Implementation Note**: Pause for explicit human approval of the winner before proceeding.

---

## Phase 5: Apply the outcome and confirm the decoupling

### Overview

Land the winning wording in production, and prove the rig is genuinely disconnected from the
review flow.

### Changes Required:

#### 1. The winning wording

**File**: `packages/code-reviewer/src/prompt.ts`

**Intent**: Replace the consistency paragraph at `:85-90` with the winning variant's text. If the
incumbent wins, this is a no-op and the finding is "the current wording is already the best of the
four" — a legitimate outcome to record rather than a reason to change something.

**Contract**: Only the FAIL⇔BLOCKING block changes. `variants/index.ts` continues to source the
surrounding text from `prompt.ts`, so the `incumbent` variant automatically tracks the new
production wording for any future sweep.

#### 2. Close out the change

**Files**: `context/changes/promptfoo-eval/change.md`, `packages/code-reviewer/README.md`

**Intent**: Record status and point a future reader at the rig.

**Contract**: `change.md` moves to `status: implemented`. The package README gains a short
paragraph pointing at `promptfoo/README.md` and stating that the rig is run by hand and is not
part of CI.

### Success Criteria:

#### Automated Verification:

- Typecheck passes: `cd packages/code-reviewer && npm run typecheck`
- Repo-wide gates pass: `npm run typecheck && npm run lint && npm test`
- Fixtures and replay still pass: `npm run eval:check && npm run eval:replay`
- **The review flow is untouched**: `git diff master --stat -- .github/` is empty
- The rig still runs after the prompt change: a 1-variant × 1-fixture smoke run passes

#### Manual Verification:

- A real PR review runs end-to-end and posts its comment, with the new wording in play
- The verdict labels (`ai-cr:passed` / `ai-cr:failed`) still apply correctly
- `promptfoo/README.md` accurately describes how to re-run the rig from a cold start

---

## Testing Strategy

The rig is dev tooling in a private workspace package; it is not covered by the repo's Vitest
suites and adds no test files there. Its correctness rests on replay and validation instead:

### Deterministic (no model calls):

- `eval:replay` — re-scores all 48 stored runs through both scorers and asserts the exact expected
  tally, including that the 3 `inconsistent` records are the specific known ones
- `eval:check` — applies all nine patches in throwaway worktrees and validates every fixture's
  declared ground truth against the applied tree
- `typecheck` — the whole package

### Model-calling (quota-spending):

- Phase 2 smoke: 1 variant × 1 existing fixture × 1 run
- Phase 3 corpus probe: 1 variant × 3 new fixtures × 1 run, asserting a non-degenerate score
- Phase 4 sweep: 24 runs

### Manual Testing Steps:

1. Run `npm run eval:check` and confirm nine fixtures apply
2. Run `npm run eval:replay` and confirm the tally matches `change.md`'s recorded evidence
3. Read each new fixture's patch alongside its `fixture.json` and verify defects and decoys
4. Run the Phase 2 smoke test and confirm `git worktree list` is clean afterwards
5. After Phase 5, open a real PR and confirm the reviewer still comments and labels

## Performance Considerations

Runtime is dominated by model calls, not by the rig. 24 runs at the observed per-run duration is
the bulk of Phase 4; the deterministic checks are sub-second. The real constraint is **subscription
quota**, not wall-clock: the prior 48-run sweep is the known-feasible ceiling, and 24 runs sits
comfortably inside it with headroom for a re-run if the grid comes back flat or a variant is
disrupted partway.

Worktree churn is one `git worktree add` + `git apply` + `commit` + `remove` per run — 24 cycles.
`worktree.ts` already prunes stale entries on every call and cleans up on `SIGINT`/`SIGTERM`.

## Migration Notes

Nothing to migrate. `eval-results/runs.jsonl` stays valid: the record shape is unchanged and the
only difference is that re-scoring it now classifies 3 records as `inconsistent` rather than
`errored`. `model-eval`'s published `results.md` is **not** rewritten — Phase 1's replay output is
the correction, and `change.md` already records the contradiction.

## References

- Frame brief: `context/changes/promptfoo-eval/frame.md`
- Raw evidence and reproduce command: `context/changes/promptfoo-eval/change.md`
- Prompt under tuning: `packages/code-reviewer/src/prompt.ts:21-96` (rule at `:85-90`)
- Scorer to split: `packages/code-reviewer/src/eval/score.ts:61-87`
- SDK options the provider must reproduce: `packages/code-reviewer/src/index.ts:217-237`
- Review-discarding path: `packages/code-reviewer/src/index.ts:310-322`
- Worktree lifecycle: `packages/code-reviewer/src/eval/worktree.ts:52-71`
- Rate-limit classification: `packages/code-reviewer/src/eval/run.ts:88-101`
- Prior change: `context/changes/model-eval/results.md`
- Promptfoo: [Claude Agent SDK provider](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/) ·
  [JavaScript provider](https://www.promptfoo.dev/docs/providers/custom-api/) ·
  [Configuration reference](https://www.promptfoo.dev/docs/configuration/reference/) ·
  [Evaluate coding agents](https://www.promptfoo.dev/docs/guides/evaluate-coding-agents/)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared eval core — split the errored bucket, add the graded scorer

#### Automated

- [x] 1.1 Typecheck passes (`npm run typecheck` in the package) — ae23d1b
- [x] 1.2 Fixture corpus still applies cleanly (`npm run eval:check`) — ae23d1b
- [x] 1.3 Replay reproduces the expected tally and names the 3 inconsistent runs (`npm run eval:replay`) — ae23d1b
- [x] 1.4 Model-sweep report still renders with the new column (`npm run eval:report`) — ae23d1b
- [x] 1.5 Repo-wide gates pass (`npm run typecheck && npm run lint && npm test`) — ae23d1b

#### Manual

- [x] 1.6 Report output reads correctly and the model-eval ranking is unchanged — ae23d1b

### Phase 2: Promptfoo rig — provider, assertions, variants

#### Automated

- [x] 2.1 Typecheck passes — f754b58
- [x] 2.2 Promptfoo validates the config and provider — f754b58
- [x] 2.3 Smoke run completes: 1 variant × 1 existing fixture × 1 run, graded — f754b58
- [x] 2.4 Repo-wide gates pass — f754b58

#### Manual

- [x] 2.5 Worktree created and removed; `git worktree list` clean — f754b58
- [x] 2.6 Provider metadata matches the SDK options at `index.ts:217-237` — f754b58
- [x] 2.7 The four variants differ only in the consistency paragraph — f754b58
- [x] 2.8 A forced consistency violation scores 0 with the violation text in `reason` — f754b58

### Phase 3: The multi-issue fixture corpus

#### Automated

- [x] 3.1 All nine fixtures apply cleanly and validate (`npm run eval:check`) — e6024d4
- [x] 3.2 Typecheck passes — e6024d4
- [x] 3.3 Each new fixture's diff is 300–600 lines and under `MAX_DIFF_LINES` — e6024d4
- [x] 3.4 A 1-variant × 3-fixture × 1-run pass produces a non-degenerate composite score — e6024d4

#### Manual

- [x] 3.5 Every planted defect is real and its cited rule says what the citation claims — e6024d4
- [x] 3.6 Every decoy is genuinely innocent — e6024d4
- [x] 3.7 Each diff reads as a plausible feature PR — e6024d4
- [x] 3.8 Defect and decoy files are disjoint, one planted item each — e6024d4

### Phase 4: Run the sweep and decide

#### Automated

- [x] 4.1 24 runs recorded, every variant complete across 3 fixtures × 2 repeats — 0e95535
- [x] 4.2 `npx promptfoo view` renders the grid with all four named metrics populated — 0e95535
- [x] 4.3 No worktrees leaked — 0e95535

#### Manual

- [x] 4.4 The grid is not flat — variants separated by more than run-to-run noise
- [x] 4.5 The winner's advantage is attributable to a named metric
- [x] 4.6 Two runs spot-checked: scorer agrees with human judgement
- [x] 4.7 Human approves the winner

### Phase 5: Apply the outcome and confirm the decoupling

#### Automated

- [ ] 5.1 Typecheck passes
- [ ] 5.2 Repo-wide gates pass
- [ ] 5.3 Fixtures and replay still pass
- [ ] 5.4 Review flow untouched: `git diff master --stat -- .github/` is empty
- [ ] 5.5 Rig still runs after the prompt change (1×1 smoke)

#### Manual

- [ ] 5.6 A real PR review runs end-to-end and posts its comment
- [ ] 5.7 Verdict labels still apply correctly
- [ ] 5.8 `promptfoo/README.md` accurately describes a cold-start re-run
