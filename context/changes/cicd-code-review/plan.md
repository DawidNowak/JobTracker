# AI Code Review — Composite Action, Structured Verdict & PR Labels — Implementation Plan

## Overview

Turn the one-off `ai-code-review.yml` into a thin workflow that delegates to a reusable composite
action, and make the reviewer emit a machine-readable verdict that drives `ai-cr:passed` /
`ai-cr:failed` labels on the PR. Along the way, fix the two defects the first production run exposed:
the reviewer reviews a commit GitHub authored rather than the PR head, and it never opens a single
file before judging.

## Current State Analysis

`.github/workflows/ai-code-review.yml` is 37 lines with every step inline: checkout, setup-node,
`npm ci`, `npm run review`. It runs on `pull_request` to `master` with the default event types and
no concurrency control, no fork guard, and no labels.

`packages/code-reviewer` is a self-contained Node package (own `package.json`, `tsconfig.json`,
`node_modules`, lockfile) held outside the app's gates by `eslint.config.js:100`
(`ignores: ["…", "packages/**"]`) and `tsconfig.json:4` (`"exclude": ["dist", "packages"]`).
Five source files: `index.ts` (SDK orchestration), `git.ts` (diff computation), `prompt.ts`
(system-prompt append + task prompt), `output.ts` (report formatting + delivery),
`github.ts` (marker-based comment upsert).

The reviewer already posts its own PR comment via the GitHub API (`output.ts:57-68`,
`github.ts:38-53`), resolving repo and PR number from `GITHUB_EVENT_PATH`
(`output.ts:36-51`). Nothing about the report needs to leave the process through the runner.

What is missing: any structured verdict, any label wiring, any composite action, a fork guard, a
correct checkout ref, and any actual investigation by the agent.

## Desired End State

Opening or pushing to a PR against `master` runs a review that:

- checks out the PR head commit (not GitHub's synthetic merge commit) with full history;
- gives the agent the changed-file list, diffstat, PR title and PR body, and makes it fetch diffs
  and open surrounding files itself;
- returns a validated JSON object carrying `verdict`, five dimension scores, a summary and the
  findings markdown;
- posts/updates one PR comment assembled from that structured data;
- applies exactly one of `ai-cr:passed` / `ai-cr:failed`, removing the other;
- leaves labels untouched and turns the job red if the agent errored or no verdict came back;
- is skipped entirely on fork PRs;
- can be re-run on demand by adding the `ai-cr:review` label, which the workflow removes when done.

Verify by opening a PR from a branch in this repo and observing: one comment, one verdict label,
green job, and a workflow log showing `[tool] Read` / `[tool] Grep` calls.

### Key Discoveries

- **`result: string` is non-optional on `SDKResultSuccess`** (`sdk.d.ts:3322`), but
  **`structured_output?: unknown` is optional even on success** (`sdk.d.ts:3328`). The absence case
  must be handled explicitly, and the value must be validated at runtime — it is `unknown`, not typed.
- **`maxBudgetUsd?: number` exists** (`sdk.d.ts:1444`) and `error_max_budget_usd` is a result subtype
  (`sdk.d.ts:3294`) — a real cost guard, which matters once the model changes and turns go up.
- **`effort?: EffortLevel`** (`sdk.d.ts:1425`) is currently dead config: unsupported models are
  silently downgraded, so `effort: "high"` on `claude-haiku-4-5` does nothing today.
- **Composite actions have no `secrets` context and no `defaults:` key.** Both tokens become inputs;
  every `run` step needs its own `shell:` (a parse-time requirement) and its own `working-directory`.
- **Composite actions do not get `INPUT_<NAME>` env vars** the way JS actions do — every input must be
  wired through `env:` by hand.
- **`required: true` on an action input is not enforced by the runner** — a missing token surfaces as
  a confusing downstream failure unless a step validates it.
- **`working-directory` in a composite step resolves relative to `GITHUB_WORKSPACE`**, which is why
  keeping the package at `packages/code-reviewer` works without any path juggling.
- **Specifying `types:` on `pull_request` replaces the default set** (`opened`, `synchronize`,
  `reopened`) — they must be relisted alongside `labeled`.
- **Label events caused by the built-in `GITHUB_TOKEN` do not start new workflow runs.** This is what
  makes the workflow labelling its own PR safe; it would not hold for a PAT or GitHub App token.
- **Adding an already-present label fires no `labeled` event**, which is why `ai-cr:review` must be
  removed at the end of each run or the second retry click silently does nothing.
- `getCurrentBranch()` (`git.ts:22-24`) returns the literal string `HEAD` on the detached checkout a
  `pull_request` run produces — the source of the ``Code review — `HEAD` `` comment title.
- `getMergeBase()` (`git.ts:36-39`) already prefers `origin/master`, but that only resolves if
  `fetch-depth: 0` is set; with a raw SHA ref and default depth, checkout creates zero
  remote-tracking refs and the merge base fails outright.
- The reviewer's `.env` is git-ignored by the root `.gitignore`'s bare `.env` rule (matches at any
  depth) — verified with `git check-ignore -v`.

## What We're NOT Doing

- **Not moving `packages/code-reviewer`.** The action holds `action.yml` only and runs the package in
  place. Consequence: `eslint.config.js` and `tsconfig.json` need no changes, and the action is
  in-repo only — extracting it to its own repo later is a separate change.
- **Not making `{{CR_CRITERIA}}` an action input.** The rubric stays hardcoded in `prompt.ts`.
- **Not passing the diff as an action input.** It is computed in-process; passing it through
  `$GITHUB_OUTPUT` or an env var hits an undocumented size ceiling and the heredoc
  delimiter-injection problem.
- **Not making the verdict a merge gate.** A FAIL labels and comments; the job stays green.
- **Not using `pull_request_target`.** Fork PRs are skipped rather than reviewed with write creds.
- **Not creating labels from the workflow.** You create the three labels manually (Phase 5 names them).
- **Not adding dependencies.** Runtime validation of the structured output is a hand-written type
  guard, not zod — the reviewer package does not depend on zod and `AGENTS.md` requires asking first.
- **Not touching `ci.yml`.**

## Implementation Approach

Two halves, in order.

**Reviewer first (Phases 1-2).** Everything in `packages/code-reviewer` is verifiable locally with
`npm run review` on a real branch — it prints to the console when not in a PR context. Getting the
schema and the prompt right before any CI wiring exists means the CI phases only have to debug CI.

**CI second (Phases 3-4).** The composite action is built against a reviewer whose output contract is
already fixed, then the workflow is rewritten to call it. Neither is meaningfully testable without
the other, but keeping them as separate phases means a failure on the first test PR is attributable:
action mechanics (bad `shell:`, unwired `env:`) versus event wiring (wrong `if:`, wrong permissions).

**Phase boundaries follow the data, not the file.** Phase 1 owns the reviewer's _output_ shape —
including the "How to report" section of `REVIEWER_APPEND`, which must describe the schema it is
filling. Phase 2 owns the reviewer's _input_ and investigation behaviour — the "How to investigate"
section and `buildTaskPrompt`. Both touch `prompt.ts`; they do not touch the same sections.

## Critical Implementation Details

**Structured data must be load-bearing, not decorative.** The verdict, summary and five scores live
only in the JSON object; `report_markdown` carries the findings section alone. `output.ts` assembles
the final comment from both. If the model were asked to write the scorecard into the markdown _and_
report the scores structurally, the two would drift and the comment would contain the same table
twice.

**Never interpolate a PR title or body into a `run:` body.** `${{ inputs.pr-title }}` written inside a
`run:` script is a shell-injection hole regardless of how the value arrived; `${{ env.X }}` inline is
equally unsafe. Bind through `env:` and read `"$PR_TITLE"`. Passing untrusted context _as an action
input_ is the safe pattern — expression evaluation is a single pass over parsed YAML, so a PR titled
`${{ secrets.FOO }}` arrives as a literal 22-character string.

**Label steps must not run on failure, and the retry-label cleanup must.** The error-state contract
(job red, labels untouched) falls out of GitHub's default step behaviour: the label steps carry no
`if: always()`, so a non-zero exit from the review step skips them. The `ai-cr:review` removal is the
one step that does need `if: always()`.

**Ordering: raise the turn budget in the same phase that removes the embedded diff.** Phase 2 makes
every review multi-turn by construction. Shipping it against `maxTurns: 15` would produce
`error_max_turns` results on larger PRs, which under the Phase 1 contract is an errored run with no
report at all.

## Phase 1: Reviewer — Structured Report & Verdict

### Overview

Give the agent a JSON schema to fill, validate what comes back, assemble the comment from it, and
expose the verdict as a step output. Switch the model and add a cost guard.

### Changes Required

#### 1. Output schema and its type guard

**File**: `packages/code-reviewer/src/schema.ts` (new)

**Intent**: One place that owns the shape of the agent's structured output — the JSON Schema handed to
the SDK, the TypeScript type it corresponds to, and the runtime guard that narrows `unknown` to it.
Keeping all three adjacent is what stops them drifting.

**Contract**: Exports the JSON Schema object, a `ReviewOutput` interface, and
`parseReviewOutput(value: unknown): ReviewOutput | null`. Schema fields, all required:

- `verdict` — string enum `"PASS" | "FAIL"`
- `summary` — string, 2-3 sentences
- `scores` — object with integer 1-10 properties `correctness`, `idiomatic_style`, `complexity`,
  `test_coverage`, `security` (the five dimensions already named in `REVIEWER_APPEND`)
- `report_markdown` — string, the findings section only (may be empty when there are no findings)

The guard checks every field's presence and type, and that `verdict` is one of the two literals — it
returns `null` on anything else rather than throwing, so the caller owns the exit path.

#### 2. SDK call, model, and budget

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Pass the schema to the SDK, switch to a model that actually investigates, and cap spend
now that the run is no longer single-turn.

**Contract**: `MODEL` becomes `"claude-sonnet-5"`. The `query()` options at `index.ts:84-103` gain
`outputFormat: { type: "json_schema", schema: REVIEW_SCHEMA }` and `maxBudgetUsd` (2.00 — roughly
20-30x the current per-run cost, so it only fires on a runaway). `maxTurns` stays at 15 in this phase
and is raised in Phase 2, where the change that needs it lands. `effort: "high"` stays and becomes
live config on Sonnet.

#### 3. Result handling and exit contract

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Replace the `finalReport = message.result` assignment with structured-output handling that
distinguishes the three non-verdict outcomes, per the agreed contract.

**Contract**: On `subtype === "success"`, run `message.structured_output` through
`parseReviewOutput`. Outcomes:

| Outcome                                                                                                          | Console                                         | Comment | Verdict output   | Exit |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------- | ---------------- | ---- |
| Valid `ReviewOutput`                                                                                             | report                                          | posted  | `PASS` or `FAIL` | 0    |
| No changed files (early return at `index.ts:71-74`)                                                              | "nothing to review"                             | none    | none             | 0    |
| `structured_output` absent or fails the guard                                                                    | error + **raw `message.result` dumped in full** | none    | none             | 1    |
| `subtype !== "success"` (incl. `error_max_turns`, `error_max_budget_usd`, `error_max_structured_output_retries`) | error naming the subtype                        | none    | none             | 1    |

The raw-`result` dump is what makes a schema failure diagnosable — without it the run produces
nothing at all.

#### 4. Step output emission

**File**: `packages/code-reviewer/src/output.ts`

**Intent**: Write the verdict to the runner's step-output file so the composite action can map it to
an action output. Only ever the four/five-character verdict — never the report.

**Contract**: A new exported `emitVerdict(verdict: "PASS" | "FAIL"): void` that appends
`verdict=<value>\n` to `process.env.GITHUB_OUTPUT` when that variable is set, and does nothing
otherwise (local runs). No heredoc is needed — the value contains no newline and no `=`.

#### 5. Comment assembly from structured data

**File**: `packages/code-reviewer/src/output.ts`

**Intent**: Build the comment body from the structured fields rather than pasting one blob of model
markdown, so the verdict, summary and scorecard have a fixed shape the model cannot reformat.

**Contract**: `formatReport` takes `ReviewOutput` alongside the existing `ReportMeta`. The assembled
body, in order: the existing metadata header (branch / merge-base / changed files / generated
timestamp) plus a verdict line, then the summary, then a Dimension | Score | Why-free table rendered
from `scores`, then `report_markdown` under a Findings heading (or an explicit "no findings" line when
it is empty). `deliverReport`'s signature changes to match; its comment-vs-console branching and
`upsertPrComment` call are unchanged.

#### 6. Report-format instructions

**File**: `packages/code-reviewer/src/prompt.ts`

**Intent**: Rewrite the "How to report" section of `REVIEWER_APPEND` (`prompt.ts:52-86`) so it
describes filling the schema instead of writing four markdown sections. The other sections are
untouched in this phase.

**Contract**: The section instructs: findings markdown (location / what is wrong / why it matters /
suggested fix, Certain-vs-Possible marking, most severe first) goes in `report_markdown` and nothing
else does; `verdict`, `summary` and the five `scores` are separate fields. The existing FAIL
definition — a Certain finding severe enough that merging ships a bug or a security hole — carries
over verbatim, as does the instruction that an empty findings section is a valid result.

### Success Criteria

#### Automated Verification

- Package typechecks: `cd packages/code-reviewer && npm run typecheck`
- Root gates stay green: `npm run typecheck && npm run lint && npm test`
- A local review on a branch with changes produces a verdict and exits 0: `cd packages/code-reviewer && npm run review`

#### Manual Verification

- The console report shows a verdict line, a summary, a five-row scorecard, and findings — with no
  duplicated scorecard table
- A deliberately broken run (temporarily set `maxTurns: 1`) exits 1, posts no comment, and prints the
  raw `result` to the console

---

## Phase 2: Reviewer — Investigation-First Prompt

### Overview

Stop handing the agent the full diff. Give it the file list, the diffstat, the exact command to fetch
diffs itself, and the PR's title and body — then require cited evidence in every finding.

### Changes Required

#### 1. Diff helpers

**File**: `packages/code-reviewer/src/git.ts`

**Intent**: `getFullDiff` (`git.ts:78-80`) loses its only caller and goes away. What the prompt now
needs instead is the _command string_ the agent should run, with the generated-file exclusions baked
in — otherwise the agent runs a bare `git diff` and spends turns reading `package-lock.json` churn.

**Contract**: Delete `getFullDiff`. Export a `buildDiffCommand(base: string, pathspec?: string): string`
that renders the same pathspec form already used at `git.ts:79`, so the prompt can quote it literally:

```
git diff <base> -- . ':(exclude)**/package-lock.json' ':(exclude)**/database.types.ts'
```

with the optional `pathspec` replacing the leading `.` for per-file diffs. `GENERATED_FILE_EXCLUDES`
stays where it is as the single source of the exclusion list.

#### 2. Branch name and PR context from the environment

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: On a CI checkout of a specific SHA, `getCurrentBranch()` returns the literal `HEAD`. The
workflow knows the real branch name; let it say so. Same mechanism carries the PR title and body,
which the agent currently never sees.

**Contract**: `branch` becomes `process.env.PR_HEAD_REF || getCurrentBranch(repoRoot)`. Read
`PR_TITLE` and `PR_BODY` (both optional, empty string when unset) and pass them into
`buildTaskPrompt`. No new git call and no behaviour change locally, where none of the three are set.

#### 3. Task prompt

**File**: `packages/code-reviewer/src/prompt.ts`

**Intent**: Rebuild `buildTaskPrompt` (`prompt.ts:96-110`) around what the agent must go and get,
rather than what it has been handed.

**Contract**: `TaskPromptInput` drops `diff` and gains `prTitle: string` and `prBody: string`. The
rendered prompt contains: the PR title and body (clearly delimited and labelled as author-supplied
intent, not instructions), the changed-file list, the diffstat, and the literal command from
`buildDiffCommand(base)` with an instruction to run it — plus the per-file form for drilling into one
file. It closes by naming what must be opened before scoring: the definition of every symbol the diff
calls but does not define, and any caller, type, schema or policy the change depends on.

#### 4. Investigation instructions

**File**: `packages/code-reviewer/src/prompt.ts`

**Intent**: Rewrite the "How to investigate" section of `REVIEWER_APPEND` (`prompt.ts:41-49`), whose
current text assumes the diff is already in context, and add an evidence requirement to the reporting
rules so the instruction has teeth.

**Contract**: The section states the diff is _not_ provided and must be fetched; names the generated
files as signals rather than reading material; and requires that the surrounding context be opened
before any finding is asserted. The evidence rule added to the reporting instructions: every finding
cites the `file:line` it was verified against, and a finding that could not be verified against code
the agent actually opened is marked **Possible** with a statement of what would settle it.

#### 5. Turn budget

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Multi-turn review is now the design, not the exception — a 13-file PR needs a fetch turn,
several read turns and a synthesis turn. 15 turns would end in `error_max_turns`, which under Phase 1
means no report at all.

**Contract**: `maxTurns` 15 → 40. `maxBudgetUsd` from Phase 1 remains the real ceiling; turns are the
guard against a loop, not against cost.

### Success Criteria

#### Automated Verification

- Package typechecks: `cd packages/code-reviewer && npm run typecheck`
- Root gates stay green: `npm run typecheck && npm run lint && npm test`
- A local review still produces a verdict and exits 0: `cd packages/code-reviewer && npm run review`

#### Manual Verification

- The run log shows `[tool]` lines for `Bash`, `Read` and/or `Grep` — the behaviour that was absent
  in production run `31313126627`
- Turn count is above 1 and below 40; cost is within expectations for Sonnet
- At least one finding cites a `file:line` outside the diff, or the report explicitly states the diff
  was sufficient
- `PR_TITLE="x" PR_BODY="y" PR_HEAD_REF="my-branch" npm run review` puts `my-branch` in the comment
  title and visibly reflects the title/body in the summary

---

## Phase 3: Composite Action

### Overview

Move the four inline workflow steps into `.github/actions/ai-code-review/action.yml`, add the guards
composite actions need, and expose the verdict as an action output.

### Changes Required

#### 1. Action definition

**File**: `.github/actions/ai-code-review/action.yml` (new)

**Intent**: A self-contained review step the workflow calls in one line. All the composite-action
constraints — no `secrets` context, no `defaults:`, mandatory `shell:`, manual `env:` wiring,
unenforced `required:` — are handled here so the workflow stays readable.

**Contract**:

- `name`, `description`, `runs.using: composite`
- **Inputs**: `claude-code-oauth-token` (required), `github-token` (required), `pr-title`,
  `pr-body`, `pr-head-ref`
- **Outputs**: `verdict` — mapped from the review step's `verdict` output
- **Steps**, each with `shell: bash`:
  1. **Guard** — fails with a clear message if either token input is empty. `required: true` is not
     enforced by the runner, and a missing `CLAUDE_CODE_OAUTH_TOKEN` otherwise surfaces as an
     unrelated SDK auth error deep in the log.
  2. `actions/setup-node@v4` — `node-version-file: .nvmrc`, `cache: npm`,
     `cache-dependency-path: packages/code-reviewer/package-lock.json`. Keeping the package inside
     `GITHUB_WORKSPACE` is what makes this simple form work.
  3. `npm ci` — `working-directory: packages/code-reviewer`. **Not** `--omit=dev`: `tsx` is a
     devDependency and `npm run review` is `tsx src/index.ts`.
  4. `npm run review` — `id: review`, `working-directory: packages/code-reviewer`, with
     `CLAUDE_CODE_OAUTH_TOKEN`, `GITHUB_TOKEN`, `PR_TITLE`, `PR_BODY`, `PR_HEAD_REF` bound under
     `env:` from the inputs.

Every input reaches the process through `env:` only. No `${{ inputs.* }}` appears inside any `run:`
body — that is the injection boundary, and `pr-title`/`pr-body` are attacker-controlled.

### Success Criteria

#### Automated Verification

- YAML parses: `npx js-yaml .github/actions/ai-code-review/action.yml` (or any YAML parse of the file)
- Root gates stay green: `npm run typecheck && npm run lint && npm test`
- No `${{` appears inside any `run:` block: `grep -n 'run:' -A3 .github/actions/ai-code-review/action.yml`

#### Manual Verification

- Every `run` step has an explicit `shell:` and, where it touches the package, a `working-directory:`
- The guard step's message names which token is missing
- Reading `action.yml` top to bottom explains the whole review procedure without opening another file

---

## Phase 4: Workflow Rewrite

### Overview

Rewrite `.github/workflows/ai-code-review.yml` around the action: correct triggers, fork guard,
retry-label guard, correct checkout ref, concurrency, and the label state machine.

`AGENTS.md` lists `.github/workflows/` under "Ask first" — this change is explicitly requested, and
this phase is the approval boundary.

### Changes Required

#### 1. Triggers, permissions, concurrency

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: Run on the three default PR events plus `labeled`, restrict who may run, and stop paying
for reviews of commits that have already been superseded.

**Contract**:

- `on.pull_request.types: [opened, synchronize, reopened, labeled]` — the three defaults must be
  listed explicitly because `types:` replaces the default set rather than extending it.
  `branches: [master]` stays. `workflow_dispatch` is dropped: it carries no PR context, so
  `resolvePullRequestContext()` (`output.ts:36-51`) returns null and the review would only reach the
  log.
- `permissions: contents: read`, `pull-requests: write`, `issues: write`. Labels are an _issues_ API
  resource even on a PR; granting both avoids a 403 that would only appear on the label step.
- `concurrency: { group: ai-code-review-${{ github.event.pull_request.number }}, cancel-in-progress: true }`.

#### 2. Job guard

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: Skip fork PRs entirely — they get no secrets and a read-only token, so the reviewer cannot
authenticate, comment, or label. And on a `labeled` event, run only for the retry label, not for every
label anyone adds.

**Contract**: A job-level `if:` combining two conditions: the head repo equals this repository, AND
(the event action is not `labeled` OR `github.event.label.name == 'ai-cr:review'`). A skipped job
shows as a neutral check, never a red X. Add a comment above it saying fork PRs are deliberately not
reviewed, so the absence is not read as a broken job.

#### 3. Checkout and action call

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: Review the commits the author actually wrote. The default `pull_request` checkout lands on
`refs/pull/N/merge` — a synthetic commit GitHub authored — which is what produced the
``Code review — `HEAD` `` comment and a review of the wrong tree.

**Contract**:

```yaml
- uses: actions/checkout@v4
  with:
    ref: ${{ github.event.pull_request.head.sha }}
    fetch-depth: 0
```

`fetch-depth: 0` is mandatory, not defensive: with a raw SHA and the default depth, checkout's
refspec builder creates zero remote-tracking refs, `origin/master` does not resolve, and
`getMergeBase()` (`git.ts:36-39`) fails outright.

Then `- id: review / uses: ./.github/actions/ai-code-review` with `claude-code-oauth-token`,
`github-token`, `pr-title` (`github.event.pull_request.title`), `pr-body`
(`github.event.pull_request.body`) and `pr-head-ref` (`github.event.pull_request.head.ref`). The local
`./` path requires the checkout step to run first. The job-level `defaults.run.working-directory` from
the old file is deleted — the action owns that now.

#### 4. Label state machine

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: Exactly one verdict label on the PR at a time, and no label at all when there was no
verdict.

**Contract**: Two steps gated on `steps.review.outputs.verdict`:

- `== 'PASS'` → add `ai-cr:passed`, remove `ai-cr:failed`
- `== 'FAIL'` → add `ai-cr:failed`, remove `ai-cr:passed`

Both use the `gh` CLI with `GH_TOKEN` from `secrets.GITHUB_TOKEN`. The removal is a
`DELETE /repos/{repo}/issues/{number}/labels/{name}` call, which returns 404 when the label is not
applied — suppress that with `|| true` rather than letting a clean PR's first PASS fail the job.

Neither step carries `if: always()`. That is deliberate and is what implements the error contract: if
the review step exits non-zero (agent error, or no valid structured output), both label steps are
skipped and the PR keeps whatever label it had. The "no changed files" case exits 0 with an empty
verdict output, so neither condition matches and no label is touched either.

Loop safety: these label writes use the built-in `GITHUB_TOKEN`, and events it triggers do not start
new workflow runs. Swapping in a PAT or App token would make this workflow self-trigger indefinitely.

#### 5. Retry-label cleanup

**File**: `.github/workflows/ai-code-review.yml`

**Intent**: Re-adding a label that is already applied fires no event. Without removal, the first
`ai-cr:review` click works and every one after it silently does nothing.

**Contract**: A final step with `if: always()` removing `ai-cr:review` via the same `gh api` DELETE
with `|| true`. `always()` here means the cleanup survives an errored review — otherwise a failed run
would leave the label stuck and unretryable.

### Success Criteria

#### Automated Verification

- YAML parses: `npx js-yaml .github/workflows/ai-code-review.yml`
- Both `opened`/`synchronize`/`reopened` and `labeled` appear under `types:`
- Root gates stay green: `npm run typecheck && npm run lint && npm test`

#### Manual Verification

- Open a test PR from a branch in this repo: the job runs, posts one comment, applies exactly one of
  `ai-cr:passed` / `ai-cr:failed`, and finishes green
- The comment title shows the real branch name, not `HEAD`
- Push a second commit: the first run is cancelled, the second replaces the comment and the label
- Add `ai-cr:review`: a new run starts, and the label is gone when it finishes — then add it again and
  confirm it triggers a second time
- Adding an unrelated label starts no run
- Force an error (revoke or blank the token in a scratch branch): the job goes red, no comment is
  posted, and the existing verdict label is untouched

---

## Phase 5: Labels & Documentation

### Overview

Name the labels for you to create, and correct the README claims the earlier phases invalidate.

### Changes Required

#### 1. Labels to create manually in GitHub

**Not a file change** — create these three at
`https://github.com/DawidNowak/JobTracker/labels`. The workflow never creates labels; it assumes they
exist. A missing label makes the `gh api` POST fail and turns the job red.

| Name           | Color     | Description                                              |
| -------------- | --------- | -------------------------------------------------------- |
| `ai-cr:passed` | `#0E8A16` | AI code review verdict: PASS                             |
| `ai-cr:failed` | `#B60205` | AI code review verdict: FAIL                             |
| `ai-cr:review` | `#1D76DB` | Add to re-run the AI code review (removed automatically) |

`#0E8A16` is deliberately distinct from the existing `ready` (`#1A7F37`), and `#B60205` from the
built-in `bug` (`#d73a4a`), so the AI labels are not mistaken for either at a glance.

#### 2. README corrections

**File**: `packages/code-reviewer/README.md`

**Intent**: Three claims stop being true after this change and one was never true.

**Contract**: Fix, in the existing prose:

- "The app's `npm run typecheck`, `npm run lint` and `npm test` do not see it" — accurate for those
  three, but `prettier --write .` has always formatted this package. State the exception.
- Document the environment variables the CI path sets: `PR_TITLE`, `PR_BODY`, `PR_HEAD_REF`,
  `GITHUB_OUTPUT` — including that all are optional and a local run behaves identically without them.
- Note that the review is driven in CI by `.github/actions/ai-code-review`, and that the package's
  output contract (the JSON schema in `src/schema.ts`) is what the action's `verdict` output depends
  on — so changing the schema is a CI-affecting change.
- Update the model and cost expectations from the haiku-era figures.

### Success Criteria

#### Automated Verification

- Prettier is clean: `npx prettier --check packages/code-reviewer/README.md`
- Root gates stay green: `npm run typecheck && npm run lint && npm test`

#### Manual Verification

- All three labels exist in GitHub with the names above (exact strings — the workflow matches on them)
- The README's env-var table matches what `action.yml` actually binds

---

## Testing Strategy

### Unit Tests

The reviewer package has no test suite and this change does not add one — it is a CI tool with no
consumers, and its behaviour is dominated by a non-deterministic model call. The one piece that is
worth pure-function testing is `parseReviewOutput`; it is exercised in practice by every local run,
and a formal test would need the root Vitest config to cover `packages/**`, which it deliberately does
not.

### Integration Tests

Not applicable — nothing here touches the app, Supabase, or RLS. The root `npm test` suite must stay
green as a regression check, not as coverage of this change.

### Manual Testing Steps

1. **Local reviewer (after Phase 1)** — `cd packages/code-reviewer && npm run review` on this branch.
   Confirm a verdict, a summary, a scorecard and findings print, and the exit code is 0.
2. **Local failure path (after Phase 1)** — temporarily set `maxTurns: 1`, re-run, confirm exit 1, no
   comment, and the raw `result` in the console. Revert.
3. **Local investigation (after Phase 2)** — re-run and confirm `[tool]` lines appear for `Bash`,
   `Read` or `Grep`, and turn count is above 1.
4. **Local env overrides (after Phase 2)** — run with `PR_TITLE`, `PR_BODY`, `PR_HEAD_REF` set;
   confirm the branch name in the title and the PR context reflected in the summary.
5. **First live PR (after Phase 4)** — open a PR from this branch to `master`. Confirm one comment,
   one label, green job.
6. **Push-during-run** — push a second commit while the review runs; confirm the first run is
   cancelled and the comment/label reflect the second commit.
7. **Retry label** — add `ai-cr:review`, confirm a run starts and the label is removed at the end.
   Add it a second time and confirm it triggers again.
8. **Unrelated label** — add any other label; confirm no run starts.
9. **Error path** — on a scratch branch, blank the token input; confirm the job is red, no comment is
   posted, and the pre-existing verdict label is untouched.

## Performance Considerations

Cost per review rises from ~$0.07 (haiku, 1 turn, no tools) to an expected $0.30-1.00 (Sonnet,
multi-turn, reading files). `maxBudgetUsd: 2.00` is the hard ceiling and `maxTurns: 40` the loop guard;
a run that hits either ends as an error subtype, which under the Phase 1 contract means a red job with
no report — loud rather than silent. `cancel-in-progress: true` is the main lever against paying for
superseded commits.

Wall-clock per run goes up correspondingly: expect several minutes rather than under one. Since the
verdict is not a merge gate, that latency costs nothing but patience.

npm install is cached via `setup-node`'s `cache-dependency-path` on the reviewer's own lockfile — a
form only available because the package stays inside `GITHUB_WORKSPACE`.

## Migration Notes

No data, no schema, no rollback complexity. The change is a workflow rewrite plus edits to a package
nothing else imports.

Rollback is `git revert` of the phase commits plus deleting the three labels. There is one ordering
constraint in the other direction: **create the three labels before merging Phase 4**, or the first
run's label step fails with a 404 and turns the job red.

## References

- Research: `context/changes/cicd-code-review/research.md`
- Requirements: `context/changes/cicd-code-review/requirements.md`
- Current workflow: `.github/workflows/ai-code-review.yml`
- Prior CI-shaped change: `context/archive/2026-07-21-ci-e2e-tests/`
- Prior scar on the same class of bug: commit `0d9469c` — merge base fixed, checked-out ref was not
- SDK types: `packages/code-reviewer/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1425,1444,1487,3294,3322,3328`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reviewer — Structured Report & Verdict

#### Automated

- [x] 1.1 Package typechecks: `cd packages/code-reviewer && npm run typecheck` — ef3d06b
- [x] 1.2 Root gates stay green: `npm run typecheck && npm run lint && npm test` — ef3d06b
- [x] 1.3 A local review produces a verdict and exits 0: `npm run review` — ef3d06b

#### Manual

- [x] 1.4 Console report shows verdict, summary, five-row scorecard, findings — no duplicated table — ef3d06b
- [x] 1.5 Deliberately broken run (`maxTurns: 1`) exits 1, posts no comment, prints raw `result` — ef3d06b

### Phase 2: Reviewer — Investigation-First Prompt

#### Automated

- [x] 2.1 Package typechecks: `cd packages/code-reviewer && npm run typecheck` — 0614d5c
- [x] 2.2 Root gates stay green: `npm run typecheck && npm run lint && npm test` — 0614d5c
- [x] 2.3 A local review still produces a verdict and exits 0: `npm run review` — 0614d5c

#### Manual

- [x] 2.4 Run log shows `[tool]` lines for `Bash`, `Read` and/or `Grep` — 0614d5c
- [x] 2.5 Turn count is above 1 and below 40; cost within Sonnet expectations — 0614d5c
- [x] 2.6 At least one finding cites a `file:line` outside the diff, or the report says the diff sufficed — 0614d5c
- [x] 2.7 `PR_TITLE` / `PR_BODY` / `PR_HEAD_REF` overrides are reflected in the report — 0614d5c

### Phase 3: Composite Action

#### Automated

- [x] 3.1 `action.yml` parses as YAML — 66ec5c9
- [x] 3.2 Root gates stay green: `npm run typecheck && npm run lint && npm test` — 66ec5c9
- [x] 3.3 No `${{` appears inside any `run:` block — 66ec5c9

#### Manual

- [x] 3.4 Every `run` step has explicit `shell:` and, where needed, `working-directory:` — 66ec5c9
- [x] 3.5 Guard step message names the missing token — 66ec5c9
- [x] 3.6 `action.yml` reads top-to-bottom as the whole review procedure — 66ec5c9

### Phase 4: Workflow Rewrite

#### Automated

- [x] 4.1 `ai-code-review.yml` parses as YAML — 453a8fe
- [x] 4.2 All four event types appear under `types:` — 453a8fe
- [x] 4.3 Root gates stay green: `npm run typecheck && npm run lint && npm test` — 453a8fe

#### Manual

- [x] 4.4 Test PR: job runs, one comment, exactly one verdict label, green job
- [x] 4.5 Comment title shows the real branch name, not `HEAD`
- [x] 4.6 Second commit cancels the first run; comment and label reflect the second commit
- [x] 4.7 `ai-cr:review` triggers a run and is removed at the end; re-adding triggers again
- [x] 4.8 An unrelated label starts no run
- [x] 4.9 Forced error: job red, no comment, existing verdict label untouched

### Phase 5: Labels & Documentation

#### Automated

- [ ] 5.1 Prettier is clean: `npx prettier --check packages/code-reviewer/README.md`
- [ ] 5.2 Root gates stay green: `npm run typecheck && npm run lint && npm test`

#### Manual

- [ ] 5.3 All three labels exist in GitHub with the exact names, colors and descriptions
- [ ] 5.4 README env-var table matches what `action.yml` binds
