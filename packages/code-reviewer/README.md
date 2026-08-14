# @jobtracker/code-reviewer

A code-review agent built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).
It reviews the current branch's diff against `master` — committed, staged and unstaged changes — and
writes a markdown report.

This package is **self-contained**: it has its own `package.json`, `tsconfig.json` and `node_modules`,
and is excluded from the root `tsconfig.json` and `eslint.config.js`. The app's `npm run typecheck`,
`npm run lint` and `npm test` do not see it — the one exception is `prettier --write .` at the repo
root, which formats this package's files like any other.

In CI, the review is driven by `.github/actions/ai-code-review` (see
`.github/workflows/ai-code-review.yml`), a composite action that installs this package and runs
`npm run review` against the checked-out PR head. The action's `verdict` output is read from the
`verdict=<value>` line this package writes to `$GITHUB_OUTPUT` — see [How it is
wired](#how-it-is-wired) — so the JSON Schema in `src/schema.ts` is a CI-affecting contract: a field
rename or an added required field changes what the action can parse out of a run.

## Setup

```bash
cd packages/code-reviewer
npm install
```

### Credentials

The SDK resolves credentials in this order, first match wins:

| Source                    | Billing                      | How to get it                                       |
| ------------------------- | ---------------------------- | --------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | Anthropic Console, per token | [platform.claude.com](https://platform.claude.com/) |
| `CLAUDE_CODE_OAUTH_TOKEN` | Your Claude subscription     | `claude setup-token`                                |
| Local Claude Code login   | Your Claude subscription     | Already done if you use the Claude Code CLI         |

**If you already use Claude Code, nothing to do** — the agent picks up that login automatically and
runs on your subscription. Set one of the env vars only to override it; the run prints which source
it used.

To override, set it in your shell or in `packages/code-reviewer/.env` (git-ignored — covered by the
root `.gitignore`'s `.env` rule):

```
CLAUDE_CODE_OAUTH_TOKEN=...
```

Do not set both env vars — `ANTHROPIC_API_KEY` wins and the other is silently ignored.

## Usage

```bash
cd packages/code-reviewer
npm run review
```

The agent streams its reasoning and tool calls to the terminal, then delivers the final review:

- **Locally**: prints the formatted review to the console.
- **In CI, on a `pull_request` run** (see `.github/workflows/ai-code-review.yml`): posts it as a
  comment on the PR instead, using `GITHUB_TOKEN`. A later run on the same PR updates that comment
  in place rather than adding a new one each time.

On a branch with no changes against `master` it exits early without calling the API.

### Environment variables

All of the following are set by the CI action and optional everywhere else — a local run behaves
identically without any of them:

| Variable        | Set by                           | Purpose                                                                                              |
| --------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PR_TITLE`      | `.github/actions/ai-code-review` | PR title, given to the agent as author-supplied intent, not instructions                             |
| `PR_BODY`       | `.github/actions/ai-code-review` | PR body, same treatment as `PR_TITLE`                                                                |
| `PR_HEAD_REF`   | `.github/actions/ai-code-review` | Real branch name; falls back to `getCurrentBranch()`, which returns `HEAD` on a detached CI checkout |
| `GITHUB_OUTPUT` | The GitHub Actions runner        | Step-output file `emitVerdict()` appends `verdict=<value>` to; a no-op when unset                    |

```bash
npm run typecheck   # tsc --noEmit
```

## How it is wired

| Option            | Value                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemPrompt`    | `claude_code` preset + `REVIEWER_APPEND`                                                            | Keeps Claude Code's tool guidance and safety rules; layers the reviewer role on top                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `settingSources`  | `["project"]`                                                                                       | Loads the repo's `CLAUDE.md` → `AGENTS.md`, so project conventions are not duplicated here                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `skills`          | `[]`                                                                                                | The repo ships 33 skills; none are review inputs, and advertising them costs context every run                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `allowedTools`    | `Read`, `Grep`, `Glob`                                                                              | Auto-approved without prompting — the diff is embedded in the task prompt, so no git tool is needed                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `disallowedTools` | `Bash`, `Edit`, `Write`, `NotebookEdit`, plus `Read` rules for `.env*` / `.dev.vars*` / `auth.json` | Bare-name deny rules **remove** the tool from the model's context, so read-only is structural rather than resting on `permissionMode` alone                                                                                                                                                                                                                                                                                                                                                                                            |
| `permissionMode`  | `dontAsk`                                                                                           | Anything outside `allowedTools` is denied outright; a headless run has nobody to answer a prompt                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `model`           | `claude-sonnet-5`                                                                                   | Kept as the incumbent after the model-eval sweep (see [`results.md`](../../context/changes/model-eval/results.md)): the automated decision rule ranked `claude-opus-5 @ high` and `claude-sonnet-5 @ xhigh` narrowly ahead on raw catch rate (10/10 vs. this cell's 9/10 violation runs caught), but shipping stayed on the incumbent — a human override, since the sweep runs on flat subscription billing (no real cost differentiator between cells) and this cell has the best turns/latency in the matrix (11 turns / 71s median) |
| `effort`          | `high`                                                                                              | Same sweep. `claude-sonnet-5 @ xhigh` caught one more violation run (10/10 vs. this cell's 9/10) but cost 47s more median latency (118s vs. 71s) for it; the one-run gap sits inside the decision rule's own single-flaky-miss margin, not a systematic one, so it did not move the human override off the incumbent's `high` setting                                                                                                                                                                                                  |
| `outputFormat`    | `json_schema` (`src/schema.ts`)                                                                     | Forces a per-criterion status, rationale and a structured findings array — the model never authors a verdict; `src/index.ts` calls `deriveVerdict()` to compute `PASS`/`FAIL` from the five statuses                                                                                                                                                                                                                                                                                                                                   |
| `maxTurns`        | `20`                                                                                                | Down from 40 now that the diff no longer needs a turn to fetch; kept above the diff-fetch-free minimum of 10 because a real run at 10 exhausted its turns before producing valid structured output                                                                                                                                                                                                                                                                                                                                     |
| `maxBudgetUsd`    | `2.00`                                                                                              | Hard cost ceiling — a run that hits it ends as an error subtype rather than spending silently                                                                                                                                                                                                                                                                                                                                                                                                                                          |

`allowedTools` only _approves_ tools — it does not remove them. The read-only property comes from
`disallowedTools`, which is why the write tools are listed there explicitly rather than merely
omitted above. The report is written by `src/index.ts` from the final `result` message, not by the
agent.

### Diff size cap

The task prompt embeds the full diff (`src/git.ts`'s `getDiff()`), generated-file exclusions
(`package-lock.json`, `database.types.ts`) and the `context/**` exclusion (below) already applied.
`truncateDiff()` caps that text at the
first **3000 lines**, cutting wherever that falls rather than aligning to file boundaries. When a
diff is truncated, both the task prompt and the delivered report carry a deterministic "truncated to
N of M lines — review is partial" note — decided in Node from the actual line count, not left to the
model to notice or caveat.

Cost per review is expected at roughly **$0.30-1.00** (Sonnet, reading files after an embedded diff)
and wall-clock runs a couple of minutes. The job now goes red on `FAIL` (see [Gate
rule](#gate-rule)), so that latency sits on the critical path to merge, not just on patience.

`context/**` (active and archived planning artifacts alike) is invisible to the reviewer entirely —
excluded from the changed-files list, the diffstat and the diff body by `OUT_OF_SCOPE_EXCLUDES` in
`src/git.ts`, not just diff-body-excluded the way lockfiles are. None of the five criteria below can
act on "a plan changed"; comparing implementation to plan is `/10x-impl-review`'s job, not this
reviewer's.

## Review criteria

`src/criteria.ts` is the single source of truth for what the reviewer checks — the JSON schema's
enum, the prompt's "what to look for" section and the report's table labels all derive from it. Each
of the five always comes back with a status, never skipped:

| id                            | Anchored in                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correctness`                 | Generic but indispensable — wrong results, crashes, silent no-ops, missing `await`, unhandled rejection, swallowed errors                                                                |
| `security_and_data_isolation` | `AGENTS.md` 🚫/✅ — RLS with **separate** SELECT/INSERT/UPDATE/DELETE policies per role, never `USING (true)`, `SUPABASE_URL`/`SUPABASE_KEY` server-only, IDOR                           |
| `api_and_validation_contract` | `AGENTS.md` ✅ + Code Style — `prerender = false` on every API route, zod on all input, `@/lib/http` helpers, uppercase handler names, Polish error copy                                 |
| `architecture_boundaries`     | `AGENTS.md` ✅/⚠️/🚫 — strict island architecture, `src/lib` purity vs `src/lib/services`, `@/*` alias, `cn()` only, no `class:list`, no Next directives, `src/components/ui/` untouched |
| `test_discipline`             | `tests/README.md` Hard rules — risk-proportional coverage, no mocking Supabase, never assert through `src/lib/services/`, correct vitest pool                                            |

Each criterion resolves to one status:

| Status           | Meaning                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `PASS`           | Nothing in the diff violates this criterion's rules.                                                                     |
| `CONCERN`        | A real issue was found, but not one that should block the merge.                                                         |
| `FAIL`           | A rule was violated seriously enough to block — always backed by a `BLOCKING` finding.                                   |
| `NOT_APPLICABLE` | Nothing in the diff touches this criterion's surface at all (e.g. a docs-only change and `security_and_data_isolation`). |

Every finding cites a `file:line`, a severity (`BLOCKING` / `ADVISORY`), a confidence (`CERTAIN` /
`POSSIBLE`), and what/why/fix — `POSSIBLE` findings state what would settle them and can never be
`BLOCKING`.

## Gate rule

The verdict is not model-authored — `deriveVerdict()` in `src/schema.ts` computes it in Node:
**`FAIL` iff any of the five criteria is `FAIL`**; `CONCERN` and `NOT_APPLICABLE` never block.

That's backed by a biconditional `checkConsistency()` enforces on every run: a criterion is `FAIL`
**if and only if** it carries at least one `BLOCKING` finding (which is always `CERTAIN` confidence
with a non-empty `file`). Either direction failing — an evidence-free `FAIL`, or a `BLOCKING` finding
filed under a criterion marked anything else — means the run is inconsistent. `src/index.ts` treats
that the same as a schema parse failure: it logs the violations, emits no verdict, posts no comment,
and exits non-zero. A half-trusted gate is worse than a visibly broken one.

On a `FAIL` verdict, `.github/workflows/ai-code-review.yml`'s `Enforce verdict` step (the job's last
step, after labelling and retry-label cleanup both complete) prints an `::error::` annotation and
exits 1, turning the job red. **Requiring that check in branch protection is a separate, manual
switch** — this change makes the job fail; it does not by itself block merging.

## Model eval

`model` and `effort` above are not a guess — they come from a repeatable harness under `src/eval/`
that runs the candidate `(model, effort)` cells against a committed fixture corpus of seeded
violations and scores the structured output mechanically. Re-run it whenever a new model ships:

```bash
cd packages/code-reviewer
npm run eval
```

By default this runs the full matrix (every cell in `src/eval/cells.ts` × every fixture in
`src/eval/fixtures/` × 2 runs each). Flags narrow that:

| Flag         | Example                         | Effect                                                                        |
| ------------ | ------------------------------- | ----------------------------------------------------------------------------- |
| `--max-runs` | `--max-runs 12`                 | Stops before starting any cell that would push the run count over the ceiling |
| `--cells`    | `--cells sonnet-high,opus-high` | Only runs the named cell ids (comma-separated)                                |
| `--fixtures` | `--fixtures clean-control`      | Only runs the named fixture ids (comma-separated)                             |

Each completed run is appended to `eval-results/runs.jsonl` (git-ignored) as it finishes, so a
killed or rate-limited sweep never loses already-paid-for work — re-run with a narrower `--cells` /
`--fixtures` to fill in what didn't complete. `npm run eval:report` renders the accumulated JSONL
into the scored matrix; `npm run eval:check` applies and discards every fixture patch to prove the
corpus still applies cleanly, without calling the model.

**Adding a fixture**: create `src/eval/fixtures/<id>/fixture.json` plus `change.patch`, pinned to a
`baseSha` on `master`. `fixture.json` declares `expect: { kind: "violation", criterion, files }` for
a seeded rule break, or `expect: { kind: "clean" }` for a control that must come back `PASS`. The
seeded violation should read as a plausible, unlabelled change — no filename or comment should
announce the planted defect, or the fixture measures nothing.

**Fixture rot**: each patch is pinned to a specific base SHA. If that region of the tree changes
materially, the patch may stop applying (`npm run eval:check` catches this) or stop testing the rule
it was written for — re-pin the `baseSha` and regenerate the patch when that happens.

The full sweep, its scoring rules, the decision-rule caveats, and the result of the first run are
recorded in [`context/changes/model-eval/results.md`](../../context/changes/model-eval/results.md).

## Layout

- `src/index.ts` — entry point: credentials, diff collection, `query()`, streaming, verdict, report
- `src/git.ts` — merge-base and diff helpers over `git`
- `src/criteria.ts` — the five review criteria, as data; single source for the schema, prompt and report
- `src/schema.ts` — the structured output contract, `deriveVerdict()` and `checkConsistency()`
- `src/prompt.ts` — the reviewer instructions and the per-run task prompt
- `src/output.ts` — renders the criteria table and findings into the report
- `src/eval/` — the model-eval harness: fixture rig (`worktree.ts`, `fixtures.ts`), candidate matrix
  (`cells.ts`), scorer (`score.ts`), sweep driver (`run.ts`), report renderer (`report.ts`)

To change what the reviewer looks for, edit `src/criteria.ts`. Project-specific conventions belong in
the repo's `AGENTS.md`, not here.
