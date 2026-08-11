<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: CI Code Review — Embedded Diff & Turn Budget

- **Plan**: context/changes/cicd-review-impr/plan-brief.md
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-08-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Diff fetch bypasses the "always bounded" guarantee on oversized diffs

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/src/git.ts:6, :76-79
- **Detail**: `git()`'s `execFileSync` call shares one `maxBuffer: 64 * 1024 * 1024` across every git invocation in the file, including the small-output calls (`getDiffStat`, `getChangedFiles`) and the new `getDiff()`, which now routes the **full, untruncated** diff through it before `truncateDiff()` gets a chance to cap it at 3000 lines. A diff whose raw text exceeds 64MB (e.g. a large file not covered by `GENERATED_FILE_EXCLUDES`) throws an `ENOBUFS`-style error straight out of `execFileSync`, caught only by the generic `main().catch()` in `index.ts` — the run dies with a raw error instead of the graceful bounded review `truncateDiff`'s own docstring promises ("a bounded review should always run rather than being blocked or silently skipped"). Low likelihood in practice (64MB is a very large diff), but it's a real gap against the stated design goal.
- **Fix**: Wrap the `getDiff()` call (in `index.ts` or inside `getDiff` itself) in a try/catch for the buffer-overflow case, and on catch, treat the diff as unavailable with a deterministic report note (mirroring `truncateDiff`'s own note) instead of letting the run crash via the top-level catch.
- **Decision**: FIXED — added a try/catch around `getDiff()` in `index.ts` with a new `diffUnavailable` flag threaded through `TaskPromptInput` and `ReportMeta`; on catch, the prompt and report both render a deterministic "diff could not be fetched" note instead of crashing. `npm run typecheck` passes.

### F2 — 3000-line cap is a default parameter, not a named constant

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: packages/code-reviewer/src/git.ts:93
- **Detail**: The cap is confirmed hardcoded (no `process.env` read, satisfying the plan's "not env-configurable" requirement), but it lives as `maxLines = 3000` buried in `truncateDiff`'s signature rather than as a named module-level constant, unlike `GENERATED_FILE_EXCLUDES` immediately above it (line 70), which is this file's established convention for pulling tunable literals to the top.
- **Fix**: Extract `const MAX_DIFF_LINES = 3000;` near `GENERATED_FILE_EXCLUDES` and reference it as `truncateDiff`'s default.
- **Decision**: FIXED — added `MAX_DIFF_LINES` constant next to `GENERATED_FILE_EXCLUDES`, `truncateDiff` now defaults to it. `npm run typecheck` passes.

### F3 — New pure functions have no test coverage

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: packages/code-reviewer/src/git.ts (truncateDiff), src/prompt.ts (fenceFor), src/index.ts (describeToolUse)
- **Detail**: `packages/code-reviewer` has no test infrastructure at all — no test runner dependency, no `test` script, no `*.test.ts` files. This predates the change, so it's not a regression, but the new logic (`truncateDiff`'s line-boundary math, `fenceFor`'s backtick-run computation, `describeToolUse`'s guarded field extraction) is exactly the kind of small, pure, cheap-to-test logic that's now load-bearing for both cost control (the `maxTurns` cut assumes the diff is reliably present) and prompt-injection mitigation (fence computation).
- **Fix**: Add a minimal test setup (e.g. `node:test`, no new heavy dependency needed) covering `truncateDiff`'s under/over/exactly-at-cap boundaries and `fenceFor`'s backtick-run edge cases.
  - Strength: Cheap insurance on exactly the logic most likely to silently regress (off-by-one in the line cap, an under-computed fence length letting diff content break out of its prompt block).
  - Tradeoff: This package currently has zero test infra, so this is a new investment, not an incremental addition — needs a runner decision (bare `node:test` vs. pulling in the main repo's Vitest).
  - Confidence: MED — the value is clear, but the right-sized test setup for a small internal CI tool is a judgment call the team hasn't made yet.
  - Blind spot: Haven't checked whether the team considers this package "internal tooling, ship fast" vs. "held to the same bar as `src/`" — that framing should decide how much test infra is worth building here.
- **Decision**: SKIPPED — no test infra exists for this package and this doesn't warrant starting one right now.

### F4 — Unescaped tool-call arguments logged to console

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: packages/code-reviewer/src/index.ts:55-70, :151-155
- **Detail**: `describeToolUse`'s `file_path`/`pattern`/`path` values (drawn from the model's own tool calls, which can be influenced by adversarial content embedded in the diff) are logged to the console unescaped — a theoretical log-injection / terminal-escape-sequence surface (fake log lines, ANSI codes) in CI output. Low severity for an internal CI tool, and not a new pattern: it extends the pre-existing unescaped `console.log(block.text)` a few lines above rather than introducing a new one.
- **Fix**: Strip control characters (or `JSON.stringify`) before logging the extracted `file_path`/`pattern`/`path` values, ideally alongside the pre-existing `block.text` log line if addressed at all.
- **Decision**: FIXED — added a `sanitizeForLog` helper stripping control characters (`\x00`-`\x1f`, `\x7f`) applied to `file_path`, `pattern`, and `path` before logging. `npm run typecheck` passes.

## Additional notes (not findings)

- `fenceFor` (prompt.ts:104-113) correctly implements CommonMark's fence-closing rule (fence length = longest backtick run in diff + 1, floor 3), closing a real prompt-injection-adjacent gap where diff content containing backticks could break out of the ` ```diff ` block. Verified against off-by-one and empty-match cases.
- `getDiff` builds the git invocation as an `execFileSync` argv array, same pattern as every other function in the file — no shell interpolation, no command-injection surface. This is tighter than the old `buildDiffCommand`, which built a shell-quoted string for the _agent_ to run itself.
- The `maxTurns` value in code and README is **20**, correctly reflecting the plan's course-correction (raised from the originally-planned 10 after a real run hit `error_max_structured_output_retries`) — not the stale "10" in the phase-level plan text.
- `npm run typecheck` passes clean in `packages/code-reviewer`.
- No scope creep: `maxBudgetUsd`, `model`, `effort`, `action.yml`/workflow files untouched; no per-file truncation strategy; cap is not env-configurable.
