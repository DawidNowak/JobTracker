# CI Code Review — Embedded Diff & Turn Budget — Plan Brief

> No separate `plan.md` for this change — by request, this brief is the complete plan (kept
> token-light instead of a hundreds-of-lines full plan).

## What & Why

The AI code reviewer (`packages/code-reviewer`) currently makes the agent fetch the diff itself
via a `Bash(git diff:*)` tool call, which `README.md` names as the reason `maxTurns` is set to 40
("multi-turn by design: fetching diffs and reading surrounding files takes several turns"). This
change embeds the diff directly in the task prompt instead, removes the now-redundant git tools,
cuts `maxTurns` to 10, caps the embedded diff at 3000 lines (truncated and flagged rather than
skipped or silently swallowed), and makes the tool-call console log show what was actually read
or searched instead of just a bare tool name.

## Starting Point

- `src/prompt.ts` instructs the agent: "The diff is not provided to you — fetch it yourself" via
  the literal `git diff` command `src/git.ts`'s `buildDiffCommand()` generates as a string.
- `src/index.ts` sets `ALLOWED_TOOLS` to `Read, Grep, Glob, Bash(git diff|show|log|status:*)` and
  `maxTurns: 40`; `git show/log/status` are allowed but never referenced anywhere in `prompt.ts`.
- Tool-call logging in `index.ts`'s message loop prints only `` `[tool] ${block.name}` `` — no
  input detail.
- `src/output.ts`'s `formatReport()` builds a fixed header (branch, merge-base, file count,
  timestamp) with no concept of a partial/truncated review.

## Desired End State

The task prompt contains the actual diff text (generated-file exclusions from
`GENERATED_FILE_EXCLUDES` still applied), truncated to the first 3000 lines when longer, with a
deterministic "truncated to N of M lines — review is partial" line added to the report header
whenever that happens. The agent has no `Bash(git *)` tools left — only `Read`, `Grep`, `Glob` for
opening files the diff depends on. `maxTurns` is 10. Console tool-call logs show the file path
(Read) or search pattern (Grep/Glob) being used, not just the tool name.

## Key Decisions Made

| Decision              | Choice                                                                        | Why                                                                                                                                                                   | Source |
| --------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Diff delivery         | Embed diff text directly in the prompt instead of agent-fetched               | Removes the multi-turn fetch step that was `README.md`'s stated reason for `maxTurns: 40`                                                                             | Plan   |
| Overflow behavior     | Truncate to the first 3000 lines (cut wherever that falls, not skipped)       | A bounded review should always run rather than being blocked or silently skipped                                                                                      | Plan   |
| Line-count metric     | Lines of the actual embedded diff text (post exclusions)                      | Matches exactly what drives prompt size / token cost — not diffstat or byte size                                                                                      | Plan   |
| Truncation visibility | Deterministic line in the report header, not model-reported                   | Always accurate; doesn't rely on the model remembering to caveat its own summary                                                                                      | Plan   |
| Tool access           | Remove all four `Bash(git *)` entries; add bare `"Bash"` to `disallowedTools` | `git diff` is now redundant; `show/log/status` were never referenced in `prompt.ts` anyway; matches the file's existing "bare-name deny = structural removal" pattern | Plan   |
| `maxTurns`            | 10 (down from 40)                                                             | Diff-fetch turns are gone; remaining turns cover opening dependent files + synthesis                                                                                  | Plan   |
| `maxBudgetUsd`        | Unchanged at $2.00                                                            | Already documented as a rare runaway backstop, not a tuning target — out of scope here                                                                                | Plan   |
| Tool-call logging     | Per-tool key fields (`file_path` for Read, `pattern` for Grep/Glob)           | Readable CI logs without a generic JSON dump                                                                                                                          | Plan   |

## Scope

**In scope:**

- `src/git.ts` — diff execution + truncation helper, retire `buildDiffCommand`
- `src/prompt.ts` — embed diff text, drop "fetch it yourself" instructions
- `src/index.ts` — wire the new diff data through, trim `ALLOWED_TOOLS`, `maxTurns: 10`, richer tool-call logging
- `src/output.ts` — truncation note in the report header
- `README.md` — update wiring table and behavior docs

**Out of scope:**

- Changing `maxBudgetUsd`, `model`, or `effort`
- Changing the workflow/action.yml inputs or verdict semantics (still not a merge gate)
- Per-file or size-prioritized truncation strategies
- Making the 3000-line cap configurable via env var (hardcoded constant, matches `GENERATED_FILE_EXCLUDES`'s existing style)

## Architecture / Approach

`git.ts` gains a function that executes the diff itself (via the existing argv-based `git()`
helper, not a shell string) with the current generated-file exclusions applied, plus a pure
`truncateDiff(text, maxLines)` helper. `index.ts` calls these once per run, passing the resulting
diff text (and truncation metadata) into `buildTaskPrompt` for the prompt and into `formatReport`'s
meta for the header note — the truncation flag is decided deterministically in Node, never left to
the model. Removing the `Bash(git *)` allow-entries plus adding a bare `"Bash"` deny mirrors the
file's existing pattern for `Edit`/`Write`/`NotebookEdit`: structural removal, not reliance on
`permissionMode` alone.

## Phases at a Glance

### Phase 1 — `src/git.ts`: diff computation & truncation

- Add a function executing `git diff <mergeBase> -- '.' :(exclude)package-lock.json :(exclude)database.types.ts` via the existing argv-based `git()` helper, returning the raw diff text (exclusions folded in directly, not built as a display string).
- Add a pure `truncateDiff(text, maxLines = 3000)` → `{ text, totalLines, includedLines, truncated }`, slicing at line 3000 regardless of file boundaries.
- Remove `buildDiffCommand` — no longer referenced once `prompt.ts` stops telling the agent to run it.
- **Risk:** exclusion pathspecs must keep matching today's behavior or reviews start seeing generated-file noise.

### Phase 2 — `src/prompt.ts` + `src/index.ts`: embed diff, drop fetch tools, cut turns

- `TaskPromptInput` gains diff fields; `buildTaskPrompt` replaces the "## Fetching the diff" section with a "## Diff" section holding the (possibly truncated) diff text in a fenced block, plus a truncation warning line when applicable.
- `REVIEWER_APPEND`'s "How to investigate" section rewritten: diff is provided, not fetched; the agent's remaining job is opening dependent files (callers/types/schema) via `Read`/`Grep`/`Glob`.
- `index.ts` calls the new `git.ts` functions and threads the results into `buildTaskPrompt` and the report meta.
- `ALLOWED_TOOLS` → `["Read", "Grep", "Glob"]`; `DISALLOWED_TOOLS` gains bare `"Bash"`.
- `maxTurns: 40` → `maxTurns: 10`.
- **Risk:** verify with a real multi-file PR that 10 turns is enough for the agent to still open dependent files before synthesizing — this is the phase most likely to need iteration.

### Phase 3 — `src/output.ts` + `src/index.ts`: truncation note + tool-call logging

- `ReportMeta` gains `diffTruncated`, `diffTotalLines`, `diffIncludedLines`; `formatReport` prepends a warning line when `diffTruncated` is true.
- Tool-call console logging switches on `block.name`: `Read` → `input.file_path`, `Grep`/`Glob` → `input.pattern` (+ `path`/`glob` if present) instead of the bare tool name.
- **Risk:** none significant — additive only.

### Phase 4 — `README.md`: docs

- Update the "How it is wired" table (`maxTurns` row, `allowedTools` row).
- Document the 3000-line diff cap and truncation behavior.
- Adjust the cost/latency paragraph if the turn-count cut materially shifts expectations.
- **Risk:** none — documentation only.

**Prerequisites:** none blocking — self-contained package, no schema/DB or workflow changes.
**Estimated effort:** ~1 session, one PR (small, tightly coupled changes across 4 files).

## Open Risks & Assumptions

- Assumes PRs in this repo rarely approach 3000 diff lines today; if truncation triggers often in practice, the fixed cap may need revisiting later (deliberately not pre-tuned here).
- Mid-diff truncation can end a file's diff mid-hunk — the model works with what it's given and the report flags partiality; no attempt to align cuts to file boundaries.
- Removing `Bash` entirely assumes the reviewer never legitimately needs shell access beyond `git diff` (e.g., no `git log` history digging) — matches current `prompt.ts`, which never referenced `show`/`log`/`status`.

## Success Criteria (Summary)

- A review run embeds the diff directly in the prompt — no `Bash(git diff)` tool call appears in the run log.
- A synthetic diff over 3000 lines produces a report with a visible "truncated to N of M lines" note; a diff under the cap shows no such note.
- Tool-call log lines show the file path or pattern being used, not just the tool name.
- `npm run typecheck` passes in `packages/code-reviewer`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: git.ts — diff computation & truncation

- [ ] 1.1 `npm run typecheck` passes with the new diff-fetch + truncation functions
- [ ] 1.2 `buildDiffCommand` removed, no remaining references

### Phase 2: prompt.ts + index.ts — embed diff, drop fetch tools, cut turns

- [ ] 2.1 `npm run typecheck` passes
- [ ] 2.2 Manual: `npm run review` locally on a real branch diff — no `Bash(git diff)` call in the log, review still produces findings

### Phase 3: output.ts + index.ts — truncation note + tool-call logging

- [ ] 3.1 `npm run typecheck` passes
- [ ] 3.2 Manual: force a >3000-line diff locally (or temporarily lower the cap) and confirm the truncation note appears in the report; confirm normal-size diffs show no note
- [ ] 3.3 Manual: confirm tool-call log lines show `file_path`/`pattern` instead of bare tool names

### Phase 4: README.md — docs

- [ ] 4.1 Manual: README wiring table and cap/truncation description match the implemented behavior
