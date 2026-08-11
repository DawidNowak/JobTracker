# AI Code Review — Composite Action, Structured Verdict & PR Labels — Plan Brief

> Full plan: `context/changes/cicd-code-review/plan.md`
> Research: `context/changes/cicd-code-review/research.md`
> Requirements: `context/changes/cicd-code-review/requirements.md`

## What & Why

The AI code reviewer works, but its CI wiring is a 37-line inline workflow with no reusable shape and
no machine-readable outcome — the verdict exists only as prose inside a PR comment. This change moves
the review procedure into a composite action under `.github/actions/`, makes the agent return a
validated JSON verdict, and uses that verdict to label the PR `ai-cr:passed` or `ai-cr:failed`. It
also fixes two defects the first production run exposed: the reviewer reads a commit GitHub authored
rather than the one you wrote, and it never opens a file before judging.

## Starting Point

`.github/workflows/ai-code-review.yml` inlines four steps and runs on the default `pull_request`
event types. `packages/code-reviewer` is a self-contained Node package held outside the app's gates by
`eslint.config.js:100` and `tsconfig.json:4`. It already posts and updates its own PR comment through
the GitHub API (`output.ts:57-68`, `github.ts:38-53`), so nothing about the report needs to travel
through the runner. Production run `31313126627` logged `Turns: 1  Cost: $0.0703` across a 13-file
diff, with zero `Read`/`Grep`/`Glob` calls, and titled its comment ``Code review — `HEAD` ``.

## Desired End State

A PR against `master` gets one comment and exactly one verdict label, from a review that fetched its
own diffs and opened the surrounding code before scoring. Pushing a new commit cancels the in-flight
review and replaces both. Adding `ai-cr:review` re-runs it and the label disappears when it finishes.
Fork PRs are skipped cleanly. A broken run is red and touches no labels, rather than quietly leaving a
stale green one.

## Key Decisions Made

| Decision                 | Choice                                                                  | Why                                                                                                 | Source   |
| ------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- |
| Package location         | Stays at `packages/code-reviewer`; action holds `action.yml` only       | No ESLint/tsconfig churn and no risk of breaking the required lint gate; accepts in-repo-only reuse | Plan     |
| Verdict transport        | Whole report inside the SDK JSON schema                                 | One source of truth, no fallback branch to maintain                                                 | Plan     |
| FAIL semantics           | Label + comment, job stays green                                        | An LLM verdict is advisory; a false FAIL must not block your own merge                              | Plan     |
| Error states             | Job red, labels untouched                                               | A label should only ever mean "the AI actually judged this commit"                                  | Plan     |
| Triggers                 | `[opened, synchronize, reopened, labeled]`, `ai-cr:review` auto-removed | `types:` replaces the defaults; re-adding a present label fires no event                            | Plan     |
| Fork PRs                 | Skipped by a job-level `if:`                                            | No secrets and a read-only token there; `pull_request_target` is not worth the escalation risk      | Plan     |
| Investigation fix        | Stop embedding the diff — agent fetches it itself                       | Structurally forces tool use rather than merely asking for it                                       | Plan     |
| Model                    | `claude-haiku-4-5` → `claude-sonnet-5`                                  | Multi-step investigation is where the jump pays; also makes `effort: "high"` live config            | Plan     |
| Concurrency              | Per-PR group, `cancel-in-progress: true`                                | Never pay to review a commit already replaced                                                       | Plan     |
| Diff as an action input  | Rejected — computed in-process                                          | Undocumented size ceiling and heredoc delimiter injection                                           | Research |
| `{{CR_CRITERIA}}` rubric | Stays hardcoded in `prompt.ts`                                          | Not an action input                                                                                 | Research |
| Label creation           | Manual, by you                                                          | Keeps `issues: write` scoped to labelling, not label management                                     | Plan     |

## Scope

**In scope**: composite action at `.github/actions/ai-code-review/`; workflow rewrite (triggers, fork
guard, permissions, concurrency, checkout ref, label state machine, retry cleanup); SDK structured
output with a runtime-validated schema; model and budget change; investigation-first prompt;
`getFullDiff` removal; PR title/body/branch threaded in via env; README corrections.

**Out of scope**: moving the reviewer package; making the rubric an input; passing the diff as an
input; a merge-gating required check; `pull_request_target`; creating labels from the workflow; new
dependencies (the output guard is hand-written, not zod); `ci.yml`; a test suite for the reviewer.

## Architecture / Approach

```
pull_request event
  └─ workflow: guards (fork, retry label) → checkout head.sha, depth 0
       └─ composite action: token guard → setup-node (cached) → npm ci → npm run review
            └─ reviewer: git.ts (file list, diffstat, diff command)
                 → SDK query (Sonnet 5, json_schema) → agent fetches diff, opens files
                 → structured output {verdict, summary, scores, report_markdown}
                      ├─ output.ts → PR comment (direct GitHub API call)
                      └─ $GITHUB_OUTPUT: verdict=PASS|FAIL  →  action output
       └─ workflow: label state machine (PASS/FAIL) → remove ai-cr:review
```

The load-bearing simplification: the report never transits the runner. It leaves the Node process by
API call, so the only thing crossing the action boundary is a five-character string — no heredoc, no
1 MB output cap, no delimiter injection.

## Phases at a Glance

| Phase                          | What it delivers                                                                                                  | Key risk                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1. Structured report & verdict | JSON schema + runtime guard, Sonnet 5, budget cap, verdict as step output, comment assembled from structured data | `structured_output` is optional even on success; a schema-retry failure yields no report at all           |
| 2. Investigation-first prompt  | Diff no longer embedded; agent fetches it and opens surrounding code; PR title/body/branch threaded in            | Turn count and cost become unpredictable; the agent may still assert without opening anything             |
| 3. Composite action            | `.github/actions/ai-code-review/action.yml` with token guard, npm cache, verdict output                           | Composite-action footguns: no `secrets` context, no `defaults:`, mandatory `shell:`, manual `env:` wiring |
| 4. Workflow rewrite            | Triggers, fork guard, permissions, concurrency, correct checkout ref, label state machine                         | Only testable on a live PR; a wrong `if:` either self-triggers or never fires                             |
| 5. Labels & docs               | Three label definitions for manual creation, README corrections                                                   | Labels must exist before Phase 4 merges, or the first run 404s and goes red                               |

**Prerequisites**: `CLAUDE_CODE_OAUTH_TOKEN` already configured as a repo secret (it is — the current
workflow uses it); the three labels created in GitHub before Phase 4 merges; a test PR to verify
against.

**Estimated effort**: ~2-3 sessions. Phases 1-3 are mechanical and locally verifiable; Phase 4 is
short to write but needs several live PR runs to confirm; Phase 5 is minutes.

## Open Risks & Assumptions

- **Putting the full report inside the JSON schema is the riskier of the two output designs.** A
  validation-retry loop ends the run as `error_max_structured_output_retries` with no report at all,
  where a verdict-only schema would have degraded to markdown. Mitigated, not eliminated, by dumping
  the raw `result` to the log on failure — which makes the failure diagnosable rather than silent.
- **Removing the embedded diff may cost more than it buys.** The agent now spends turns re-fetching
  information it was being handed for free. If tool-call counts stay at zero after Phase 2, the model
  was never the constraint and neither was the prompt — the fallback is to re-embed the diff and treat
  investigation as a separate experiment.
- **Loop prevention rests on one GitHub rule**: events triggered by the built-in `GITHUB_TOKEN` do not
  start new workflow runs. It holds for `GITHUB_TOKEN` and not for a PAT or App token. If that token
  is ever swapped, this workflow self-triggers indefinitely.
- **Sonnet 5 cost is an estimate**, extrapolated from a single haiku run with different behaviour.
  `maxBudgetUsd: 2.00` bounds the damage; the real figure lands on the first live run.
- **`cancel-in-progress: true` can strand a label** from a previous commit for the duration of the
  cancelled run. Judged harmless: the run that cancelled it is about to overwrite it.

## Success Criteria (Summary)

- Opening a PR produces one comment and exactly one of `ai-cr:passed` / `ai-cr:failed`, with a green
  job and the real branch name in the comment title.
- The run log shows the agent actually reading code — `[tool]` lines for `Bash`, `Read` or `Grep` —
  and at least one finding citing a `file:line` outside the diff.
- Adding `ai-cr:review` re-runs the review and the label clears; adding it again works a second time.
- A failed run is visibly red and leaves the PR's labels exactly as they were.
