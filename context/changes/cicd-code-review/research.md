---
date: 2026-08-09T15:05:24+02:00
researcher: Dawid Nowak
git_commit: a85f82f0a9d2335138a115ca23a17134194d6349
branch: cicd-code-review
repository: DawidNowak/JobTracker
topic: "Reusable AI code-review workflow: composite action, structured verdict, PR labels"
tags: [research, codebase, github-actions, composite-action, code-reviewer, claude-agent-sdk]
status: partial
last_updated: 2026-08-09
last_updated_by: Dawid Nowak
---

# Research: Reusable AI code-review workflow (composite action)

**Date**: 2026-08-09T15:05:24+02:00
**Researcher**: Dawid Nowak
**Git Commit**: `a85f82f`
**Branch**: `cicd-code-review`
**Repository**: DawidNowak/JobTracker

## Research Question

Given `context/changes/cicd-code-review/requirements.md` and the existing
`.github/workflows/ai-code-review.yml`, what has to change to make the code-review
workflow reusable as a **composite action**?

## Scope decisions (made by the user during research)

| Decision                 | Choice                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Reuse scope              | In-repo, **portability-ready**: reviewer package vendored under the action dir so it can later be extracted to its own repo without rework |
| Verdict plumbing         | Agent emits a **structured JSON envelope**; entrypoint parses it and sets a composite-action output that drives the label step             |
| `{{CR_CRITERIA}}` rubric | **Stays hardcoded** in `src/prompt.ts` — not an action input                                                                               |

## Summary

The change is larger than "wrap the existing steps in an `action.yml`". Five findings
carry the work:

1. **Moving the package under `.github/` breaks a required CI gate.** ESLint's
   `ignores: ["packages/**"]` does not cover the new path, and flat config does not skip
   dot-directories. Verified empirically. One-line fix, but it must land in the same commit.
2. **The Agent SDK has native structured output** (`outputFormat` + `structured_output`),
   verified in the installed type definitions. No prompt-and-parse needed.
3. **The markdown report should never transit `$GITHUB_OUTPUT`.** The Node process already
   posts the PR comment itself; only the short verdict needs to become an action output.
   This sidesteps the 1 MB output cap and the heredoc delimiter-injection problem entirely.
4. **`getRepoRoot()` blocks extraction.** It infers the repo from `process.cwd()`, which
   stops being inside the checkout the moment the action is consumed remotely.
5. **The reviewer currently reviews the wrong commit and does no investigation.** Default
   `pull_request` checkout lands on GitHub's synthetic merge ref, and the one production run
   completed in a single turn without opening a single file.

Area 5 of the original plan — PR event triggers and label wiring — **was not completed**
(see [Open Questions](#open-questions)).

## Detailed Findings

### 1. Moving `packages/code-reviewer` → `.github/actions/ai-code-review`

Verified with the ESLint Node API against the real config:

```
packages/code-reviewer/src/index.ts          ignored: true
.github/actions/ai-code-review/src/index.ts  ignored: false   ← the problem
```

`eslint.config.js:100` — `{ ignores: ["src/lib/database.types.ts", "packages/**"] }`.
ESLint flat config's only default ignores are `**/node_modules/` and `.git/`; unlike legacy
`.eslintrc`, it does **not** ignore dot-directories. After the move, `npm run lint`
(`eslint .`, a required gate per `.github/workflows/ci.yml:21` and `AGENTS.md`) lints the
five reviewer sources with `strictTypeChecked` + type-aware rules. The root `npm ci` never
installs that package's `node_modules`, so its imports are unresolvable → **CI red on the
very PR that performs the move**, while passing locally because that `node_modules` exists
on disk.

**Fix**: add `".github/actions/**"` to the `ignores` array in the same commit.

Knock-on effects:

- **Pre-commit**: `lint-staged`'s `"*.{ts,tsx}"` has no slash, so it basename-matches at any
  depth — reviewer sources already reach `eslint --fix` today and only survive because
  ESLint reports them ignored (exit 0).
- **Agent edits**: `.claude/settings.json` runs a `PostToolUse` hook (`lint-edited.sh`) on
  Write/Edit that exits 2 on lint failure. Without the ignore fix, editing these files is
  blocked for both human and agent.
- **`tsconfig.json:4`** — `"exclude": ["dist", "packages"]` becomes dead. The new location
  stays out of the program only because TypeScript's `**/*` wildcards never match path
  segments starting with `.`. That is implicit, undocumented behaviour, and `astro check`
  runs the Astro language server rather than raw `tsc`. Make it explicit.
- **Prettier**: `prettier --write .` already formats `packages/code-reviewer/**` today and
  will equally format the new path. Unchanged — but the package README's claim that the
  app's gates "do not see it" was already false for Prettier.

Otherwise the move is clean. Exactly **one** non-self file references the package
(`.github/workflows/ai-code-review.yml:17`). Root `README.md`, `AGENTS.md`, `CLAUDE.md`,
`tests/README.md` and all of `context/**` mention the reviewer **nowhere**. `vitest`,
`stryker`, `playwright`, `astro.config.mjs`, `.gitattributes`, `.npmrc`, `.nvmrc` have no
path-scoped rules touching either location. Root `.gitignore`'s bare `.env` (line 17)
matches at any depth, so the credentials rule still holds — verified with
`git check-ignore -v`.

Ten tracked files move (`git ls-files packages/code-reviewer`), `package-lock.json` among
them. `.claude/settings.local.json` and `.env` are untracked and must be moved by hand;
`git mv` will not carry them.

`.github/` currently contains only `workflows/` — no CODEOWNERS, no dependabot, no existing
actions. Creating `.github/actions/` is a clean addition.

### 2. Claude Agent SDK — native structured output

Installed version is **0.2.141** (`package.json` declares `^0.2.98`; the caret floated up).
Verified in `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

- `outputFormat?: OutputFormat` — `sdk.d.ts:1487`
- `OutputFormat = JsonSchemaOutputFormat = { type: 'json_schema'; schema: Record<string, unknown> }` — `sdk.d.ts:861,1809,1811`
- `structured_output?: unknown` on `SDKResultSuccess` — `sdk.d.ts:3328` (**optional even on
  success** — absence must be handled explicitly)
- `SDKResultError.subtype` gains `'error_max_structured_output_retries'` and
  `'error_max_budget_usd'` — `sdk.d.ts:3294`

`result` (the markdown) and `structured_output` are **separate fields on the same message**.
That enables the split in finding 3: markdown stays in `result`, only the verdict + scores go
in the schema. No markdown ever transits a JSON string.

**Correction to a sub-agent claim**: it reported that `effort: "high"` is invalid for
`claude-haiku-4-5` and causes a 400, citing an unrelated project's issue tracker. That is
wrong. `effort?: EffortLevel` is a valid option (`sdk.d.ts:1425`), `'high'` is documented as
the **default**, and unsupported models get a **silent downgrade** rather than a rejection
(`sdk.d.ts:141`). Production run `31313126627` succeeded with exactly this config. The
accurate finding is milder: on haiku the line is dead config.

### 3. Composite action mechanics

- **`secrets` context is unavailable to composite actions** (docs explicit). Both
  `CLAUDE_CODE_OAUTH_TOKEN` and `GITHUB_TOKEN` become **inputs**, forwarded to the process
  via `env:`.
- **No `defaults:` key exists in `action.yml`.** The current workflow's
  `defaults.run.working-directory` has no equivalent — every `run` step repeats
  `working-directory: ${{ github.action_path }}`.
- **`shell:` is required on every `run` step.** Omitting it is a parse-time validation
  failure, not a runtime one. (Unlike job-level steps, which default to bash on Linux.)
- **Composite actions do not get `INPUT_<NAME>` env vars** automatically, unlike JS actions.
  Every input must be wired through `env:` by hand.
- **`required: true` is not enforced** by the runner. A missing token surfaces as a
  confusing downstream failure unless a guard step validates it.
- **Output caps: 1 MB per job, 50 MB per run.** Combined with the heredoc delimiter problem
  (below), this is why the markdown must not become an output.
- **`npm ci` at runtime is the right install strategy.** Committing `node_modules` is a
  non-starter: the SDK fans out into eight platform-specific native packages plus the full
  `@esbuild/*` matrix. An ncc-bundled JS action can't bundle native artifacts or the SDK's
  spawned CLI subprocess. **`--omit=dev` would break the run** — `tsx` is a devDependency
  and `npm run review` is `tsx src/index.ts`.
- **Caching gets awkward once remote**: `hashFiles()` "can only include files inside of the
  `GITHUB_WORKSPACE`", so `setup-node`'s `cache-dependency-path` cannot key on the action's
  own lockfile. Portable form is `sha256sum` in bash feeding `actions/cache`, which does
  accept absolute paths.
- **`github.action_path` is outside `GITHUB_WORKSPACE` for remote actions** —
  `/home/runner/work/_actions/<owner>/<repo>/<ref>`. This is the single most important
  portability fact, and it drives finding 4.

### 4. `getRepoRoot()` blocks extraction

`src/git.ts:18-20`:

```ts
export function getRepoRoot(): string {
  return git(["rev-parse", "--show-toplevel"]); // no cwd → inherits process.cwd()
}
```

Works today, and keeps working for a **local** action (whose `action_path` is inside the
workspace). Breaks for a **remote** action: cwd becomes `_actions/...`, outside any git
repo, so `git rev-parse --show-toplevel` fails or resolves the wrong root, taking
`getMergeBase()` and `getFullDiff()` with it.

It also weakens security. `src/index.ts:36` notes the path-scoped `Read` deny rules "anchor
at the session cwd (the repo root)" — a wrong cwd unanchors the `Read(/.env*)` guards.

**Fix before extraction**: pass the workspace in explicitly (`GITHUB_WORKSPACE` /
a `workspace` input) and thread it through `getRepoRoot()` **and** the SDK `cwd` option
rather than deriving it from `process.cwd()`.

Pre-existing and unchanged by the move: `DISALLOWED_TOOLS` uses `Read(/.env*)` anchored at
the repo root, which never covered the reviewer's own nested `.env` in either location.

### 5. Input plumbing — what the three requirement inputs should actually do

Requirements name three inputs: PR title, PR description, git diff.

**Title and body — pass as inputs; `with:` is safe.** GitHub's script-injection page lists
both `title` and `body` suffixes as attacker-controlled, but expression evaluation is a
single pass over parsed YAML — the runner evaluates the step template into a plain string,
then writes the script file verbatim (`ScriptHandler.cs`). There is **no second expression
pass**, so a PR titled literally `${{ secrets.FOO }}` arrives as a 22-character string, not
an expansion. GitHub's hardening doc names passing untrusted context as an action input the
injection-proof pattern.

The obligation sits **inside** the action: never write `${{ inputs.pr-title }}` in a `run:`
body; bind via `env:` and read `"$PR_TITLE"`. Note `${{ env.TITLE }}` inline in a `run:` is
just as vulnerable — it is interpolation into script text that is fatal, not the source.

**Diff — do not pass as an input.** Three reasons:

1. The naive `echo "value=$(git diff ...)" >> "$GITHUB_OUTPUT"` is broken: `GITHUB_OUTPUT`
   parses line-by-line as `name=value`, so a multiline diff either fails with
   `Invalid format` or has diff lines containing `=` parsed as further assignments.
2. Even with the correct heredoc form, the delimiter must not appear on a line of its own
   inside the value. The runner's parser resumes normal `NAME=VALUE` parsing after a line
   matching the delimiter exactly — so a fixed delimiter like `EOF` lets a PR author add a
   file containing a bare `EOF` line and forge arbitrary outputs. Use
   `DELIM="ghadelim_$(openssl rand -hex 16)"` wherever a heredoc is unavoidable.
3. **Size**: `$GITHUB_OUTPUT`, `$GITHUB_ENV` and action input sizes are **entirely
   undocumented** — GitHub's limits page covers only time, matrix, rate and storage. Anything
   reaching a process environment is capped by `execve`'s `MAX_ARG_STRLEN` at **~128 KiB per
   variable**, surfacing as `Argument list too long` in an unrelated post-step. A diff has no
   upper bound.

`src/git.ts` already computes the diff in-process with merge-base resolution, generated-file
exclusion, untracked-file handling and a 64 MB buffer. Keeping it there is the only path with
neither a size ceiling nor a documentation gap. **Pass `base-ref`, not the diff.**

### 6. The reviewer reviews the wrong commit, and does not investigate

**Wrong commit.** On `pull_request`, `actions/checkout` defaults to the merge ref
`refs/pull/N/merge` — GitHub's synthetic merge of the PR into master — leaving a detached
HEAD. Confirmed empirically in production run `31313126627`:

```
Reviewing 13 changed file(s) on `HEAD` against `23ec27885cd3b6141767337c4f89682029c55706`...
```

`getCurrentBranch()` returns the literal `HEAD` because that is what
`git rev-parse --abbrev-ref HEAD` reports on a detached head — so every posted comment is
titled ``Code review — `HEAD` ``, and the reviewed commit is authored by GitHub, not by the
PR author.

For a reviewer, PR head is correct: `HEAD` then equals `head.sha` (required for line-anchored
review comments), it is immutable across runs, `git log`/blame show real authorship, and it
works on conflicted PRs — the merge ref does not exist for those.

```yaml
- uses: actions/checkout@v4
  with:
    ref: ${{ github.event.pull_request.head.sha }}
    fetch-depth: 0
```

`fetch-depth: 0` becomes **mandatory**: with a raw SHA and the default depth, checkout's
refspec builder takes its "no destination ref" branch and creates **zero** remote-tracking
refs, so `origin/master` would not resolve and `getMergeBase()` would fail outright. The
merge-result view remains correct for `ci.yml`'s test jobs — it is specifically wrong for
review.

**No investigation.** The same run logged `Turns: 1  Cost: $0.0703` on a 13-file diff. The
agent never called `Read`, `Grep` or `Glob` — it answered straight from the embedded diff.
The entire `allowedTools` apparatus and the prompt's instruction to "open whatever
surrounding context you need" went unused, and `maxTurns: 15` budgets for behaviour that is
not happening. This is the reviewer's real quality ceiling, independent of the CI wiring.

### 7. Repo state relevant to labels

`gh label list` — **none of `ai-cr:passed`, `ai-cr:failed`, `ai-cr:review` exist.** Present
labels are the GitHub defaults plus `ready` (`#1A7F37`) and `blocked` (`#B35900`) from the
issues process. `bug` is already `#d73a4a`, so `ai-cr:failed` should pick a distinct red.

`gh api repos/DawidNowak/JobTracker` — **`private: false`**, default branch `master`. The
repo being public makes fork PRs a real case: secrets are withheld from fork-triggered
`pull_request` runs and `GITHUB_TOKEN` is read-only, so the reviewer would fail on auth and
could not comment or label regardless. The workflow needs to **skip cleanly** on fork PRs
rather than show a red X on every outside contribution.

## Code References

- `.github/workflows/ai-code-review.yml:17` — `working-directory: packages/code-reviewer`, the only non-self reference to the package
- `.github/workflows/ci.yml:21` — `npm run lint`, the required gate that the move would break
- `eslint.config.js:100` — `{ ignores: ["src/lib/database.types.ts", "packages/**"] }`
- `tsconfig.json:4` — `"exclude": ["dist", "packages"]`, dead after the move
- `package.json:81-91` — `lint-staged` basename-matching patterns
- `.claude/settings.json:3-16` — `PostToolUse` hook running `lint-edited.sh`
- `packages/code-reviewer/src/git.ts:18-20` — `getRepoRoot()`, the extraction blocker
- `packages/code-reviewer/src/git.ts:36-39` — `getMergeBase()`, already prefers `origin/master`
- `packages/code-reviewer/src/index.ts:22-45` — `ALLOWED_TOOLS` / `DISALLOWED_TOOLS`
- `packages/code-reviewer/src/index.ts:84-103` — the `query()` call to gain `outputFormat`
- `packages/code-reviewer/src/output.ts:36-51` — `resolvePullRequestContext()`, already reads `GITHUB_EVENT_PATH`
- `packages/code-reviewer/src/output.ts:57-68` — `deliverReport()`, already posts the comment itself
- `packages/code-reviewer/src/github.ts:38-53` — `upsertPrComment()`, the marker-based upsert

## Architecture Insights

**The comment already leaves the process by API, so the report never needs to be an action
output.** This is the load-bearing simplification. The composite action's only output is the
verdict — a five-character string. No heredoc, no 1 MB ceiling, no delimiter injection, no
truncation logic.

**Portability is mostly about cwd, not about YAML.** The action's shape is
straightforward; what actually breaks on extraction is the implicit assumption that
`process.cwd()` is inside the repo under review. Making the workspace explicit fixes the
diff, the SDK's `cwd`, and the anchoring of the `Read` deny rules in one change.

**The repo's existing "self-contained package" convention was doing real work.** The
`packages/**` ESLint ignore, the `tsconfig` exclude, and the absence of `workspaces` in the
root `package.json` together keep a second dependency tree out of the app's gates. Moving the
package under `.github/` preserves the intent but requires restating every one of those
exclusions against the new path — none of them transfer automatically.

## Historical Context (from prior changes)

- `context/archive/2026-07-21-ci-e2e-tests/` — the most recent CI-shaped change; `ci.yml`'s
  three-job structure and the local-Supabase provisioning pattern come from there.
- Commit `0d9469c` (`fix(code-reviewer): resolve merge-base against origin/master in CI`) —
  the detached-HEAD/`origin/master` problem has already bitten once. `getMergeBase()`'s
  `refExists("origin/master")` fallback is the scar. The finding in §6 is the other half of
  the same issue: the merge base was fixed, the _checked-out ref_ was not.
- `AGENTS.md` — "Ask first: changing CI config (`.github/workflows/`)". The literal glob is
  `workflows/`, so `.github/actions/` does not technically trip it, but this change also
  touches `eslint.config.js` and `tsconfig.json`. Treat as an explicit approval gate.

## Related Research

None — this is the first research artifact for `cicd-code-review`. No prior change in
`context/archive/**` covers GitHub Actions authoring.

## Open Questions

**Area 5 (PR event triggers and label wiring) was not researched.** The first sub-agent died
on an API stall; the relaunched one was stopped when web research was called off. Nothing
below is verified — settle each before implementation:

1. Does specifying `types:` on `pull_request` **replace** the default set
   (`opened, synchronize, reopened`), requiring them to be relisted alongside `labeled`?
2. Exact `if:` shape for "unconditional on opened/synchronize/reopened, but on `labeled`
   only when the label is `ai-cr:review`".
3. **Loop prevention** — the workflow adds `ai-cr:passed`/`ai-cr:failed`, which is itself a
   `labeled` event. Confirm GitHub's rule that events triggered by the default
   `GITHUB_TOKEN` do not create new workflow runs, and its PAT/App-token exception. This is
   load-bearing: if the rule does not hold as understood, the workflow self-triggers forever.
4. **Permissions** — labels are an _issues_ API resource. Settle definitively whether
   `pull-requests: write` alone suffices to label a PR, or whether `issues: write` is also
   required, and what creating a brand-new repo label needs.
5. `gh label create --force` semantics when the label exists; `gh pr edit --remove-label`
   exit code when the label is not applied.
6. Whether the workflow should remove `ai-cr:review` at the end so it can be re-added to
   re-trigger (re-adding an already-present label fires no event).
7. `concurrency` group shape, and whether `cancel-in-progress: true` can strand a stale
   label mid-run.

Also unverified and deliberately excluded from the plan:

- A `$/path` "self repository reference" for local actions that avoids `actions/checkout`.
  The sub-agent flagged its own source as likely a markdown-converter artifact. Moot anyway —
  `fetch-depth: 0` checkout is needed regardless.
- A long-standing report that `continue-on-error` is not honoured on composite _steps_
  despite being documented. Avoidable via `|| echo "failed=true" >> "$GITHUB_OUTPUT"`.
- Whether `result` stays populated when `outputFormat` is set. Cheap to settle with one local
  run before committing to the markdown/structured split.

## Requirements Coverage

| Requirement                            | Status                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHA workflow on every PR to master     | Exists; needs `types:` + fork guard + checkout-ref fix                                                                                                                                    |
| Composite action for the review        | Researched — §3, §4                                                                                                                                                                       |
| Input: PR title                        | Pass via `with:` → `env:` — §5                                                                                                                                                            |
| Input: PR description                  | Pass via `with:` → `env:`. Cost concern is unfounded: a PR body is a few hundred tokens against a diff of tens of thousands, and it is the only signal of author intent the reviewer gets |
| Input: git diff                        | **Rejected as an input** — computed in-process — §5                                                                                                                                       |
| `{{CR_CRITERIA}}`                      | Stays in `src/prompt.ts` (user decision); the five dimensions in `REVIEWER_APPEND` are the rubric                                                                                         |
| PR comment with summary                | Already works via `upsertPrComment()`; keep in-process                                                                                                                                    |
| Labels `ai-cr:passed` / `ai-cr:failed` | Labels do not exist yet — §7. Wiring **unresearched** — see Open Questions                                                                                                                |
| Retry on `ai-cr:review` label          | **Unresearched** — see Open Questions                                                                                                                                                     |
