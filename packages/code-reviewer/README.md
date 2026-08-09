# @jobtracker/code-reviewer

A code-review agent built on the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview).
It reviews the current branch's diff against `master` — committed, staged and unstaged changes — and
writes a markdown report.

This package is **self-contained**: it has its own `package.json`, `tsconfig.json` and `node_modules`,
and is excluded from the root `tsconfig.json` and `eslint.config.js`. The app's `npm run typecheck`,
`npm run lint` and `npm test` do not see it.

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

```bash
npm run typecheck   # tsc --noEmit
```

## How it is wired

| Option            | Value                                                                                       | Why                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemPrompt`    | `claude_code` preset + `REVIEWER_APPEND`                                                    | Keeps Claude Code's tool guidance and safety rules; layers the reviewer role on top                                                         |
| `settingSources`  | `["project"]`                                                                               | Loads the repo's `CLAUDE.md` → `AGENTS.md`, so project conventions are not duplicated here                                                  |
| `skills`          | `[]`                                                                                        | The repo ships 33 skills; none are review inputs, and advertising them costs context every run                                              |
| `allowedTools`    | `Read`, `Grep`, `Glob`, `Bash(git diff\|show\|log\|status:*)`                               | Auto-approved without prompting                                                                                                             |
| `disallowedTools` | `Edit`, `Write`, `NotebookEdit`, plus `Read` rules for `.env*` / `.dev.vars*` / `auth.json` | Bare-name deny rules **remove** the tool from the model's context, so read-only is structural rather than resting on `permissionMode` alone |
| `permissionMode`  | `dontAsk`                                                                                   | Anything outside `allowedTools` is denied outright; a headless run has nobody to answer a prompt                                            |
| `model`           | `claude-haiku-4-5`                                                                          |                                                                                                                                             |

`allowedTools` only _approves_ tools — it does not remove them. The read-only property comes from
`disallowedTools`, which is why the write tools are listed there explicitly rather than merely
omitted above. The report is written by `src/index.ts` from the final `result` message, not by the
agent.

## Layout

- `src/index.ts` — entry point: credentials, diff collection, `query()`, streaming, report
- `src/git.ts` — merge-base and diff helpers over `git`
- `src/prompt.ts` — the reviewer instructions and the per-run task prompt

To change what the reviewer looks for or how it reports, edit `src/prompt.ts`. Project-specific
conventions belong in the repo's `AGENTS.md`, not here.
