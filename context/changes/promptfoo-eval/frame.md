# Frame Brief: Promptfoo prompt eval for the CI/CD code reviewer

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

The CI/CD code reviewer's `(model, effort)` cell was chosen by the `model-eval`
change (shipped: `claude-sonnet-5 @ high`, incumbent retained by human override).
The model axis is now settled, so the prompt is the next lever available for
improving review results. No specific shortfall in review output has been
observed — this is proactive tuning.

## Initial Framing (preserved)

- **User's stated cause or approach**: The prompt is the remaining tunable axis;
  prompt quality needs a measurement tool, and promptfoo is the tool for that.
- **User's proposed direction**: Build a promptfoo eval for the CI/CD code review
  prompt, and tune against it.
- **Pre-dispatch narrowing**:
  - Shortfall: **"No specific shortfall yet"** — proactive, not defect-driven.
  - Which prompt: **`REVIEWER_APPEND`** (`packages/code-reviewer/src/prompt.ts:21-96`)
    — the how-to-review scaffolding — _not_ `criteria.ts` and _not_ `AGENTS.md`.
  - Scope: **"Promptfoo is the goal"** — adopting promptfoo in this repo is itself
    a desired outcome, not merely instrumental.

## Dimension Map

The framing could break at any of these dimensions:

1. **Tool fit** — can promptfoo actually host _this_ reviewer? It needs a per-test
   git worktree at a pinned base SHA, `settingSources` reading `AGENTS.md` _from
   that worktree_, JSON-schema structured output, and a quota-rejection escape
   hatch.
2. **Measurement headroom** — is a prompt-variant delta detectable at all on the
   existing 6-fixture corpus, whatever tool measures it?
3. **Duplication** — `packages/code-reviewer/src/eval/` is already a working eval
   harness (fixtures, worktrees, scorer, sweeper, JSONL, report). What does
   promptfoo replace vs. duplicate?
4. **The lever** — is `REVIEWER_APPEND` where the variance actually lives, or is
   the score gated by the scoring rule instead? ← implied by initial framing

## Hypothesis Investigation

| Hypothesis                                                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Verdict                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **1. Tool fit** — promptfoo cannot host this reviewer                          | Promptfoo ships a first-class `anthropic:claude-agent-sdk` provider exposing every option `index.ts:217-237` sets: `model`, `effort`, `max_turns`, `max_budget_usd`, `output_format` (json_schema), `setting_sources`, `disallowed_tools`, `custom_allowed_tools`, `append_system_prompt`, `working_dir`, `permission_mode`. `beforeEach`/`afterEach` extension hooks can host `withFixtureWorktree`'s create/apply/commit/remove lifecycle (`src/eval/worktree.ts:52-71`). Multiple `prompts:` entries compared across identical tests is promptfoo's core grid — exactly the prompt-variant matrix wanted. Two real frictions: per-test-case templating of `working_dir` is not documented, and promptfoo has **no concept of excluding a run from scoring** (`failureReason` 2 = error, counted in `errors`) — the exact `rate_limited` exclusion that `run.ts:88-101` exists to provide on subscription auth. Both are closable via a custom JS provider (`callApi` returning `ProviderResponse`). | **WEAK** (frictions are real but not blocking)       |
| **2. Measurement headroom** — the corpus cannot detect a prompt delta          | `eval-results/runs.jsonl`, 48 runs, 4 cells: **37 `caught`, 8 `clean_pass`, 3 `errored` — and zero `missed`, zero `misattributed`, zero `false_positive`.** Every cell, including the eliminated `haiku-high`, caught every seeded defect on every run that produced consistent output. Recall is pinned at 100%; false-positive rate is pinned at 0% (8/8 clean passes). There is no headroom left to measure an improvement in either direction. Corroborated by `results.md` Caveat 1: seeded fixtures are "an upper bound on real-world recall, not an estimate of it."                                                                                                                                                                                                                                                                                                                                                                                                                            | **STRONG**                                           |
| **3. Duplication** — a new harness would rebuild existing work                 | `src/eval/` already provides fixture loading (`fixtures.ts`), worktree materialization (`worktree.ts`), a pure categorical scorer (`score.ts:61-87`), a matrix sweeper (`run.ts`), and a report generator (`report.ts`). Sweeping a prompt axis instead of a model axis is a `cells.ts`-shaped change. But the user's answer makes promptfoo adoption an explicit goal, so this is a **cost to acknowledge, not a reason to refuse**. The reusable core is `score.ts` — pure, model-call-free, and directly usable as a promptfoo `javascript` assertion.                                                                                                                                                                                                                                                                                                                                                                                                                                              | **STRONG as fact, NOT a blocker given stated scope** |
| **4. The lever** — `REVIEWER_APPEND` is the right file, for the assumed reason | Right file, wrong reason. All 3 non-scoring runs were `resultSubtype: "success"` with a **consistency violation**, not an SDK failure: `haiku-high × rls-using-true` (`correctness` FAIL with no BLOCKING finding), `haiku-high × service-layer-assert` (`architecture_boundaries` likewise), `sonnet-high × rls-using-true` (`test_discipline` likewise). That biconditional is legislated by `REVIEWER_APPEND` itself (`prompt.ts:85-90`) — the _one_ thing the eval has ever measured varying is a `REVIEWER_APPEND` concern. On 2 of the 3, the over-FAILed criterion is **not** the fixture's expected one, so the model caught the real defect _and additionally_ over-flagged an unrelated criterion.                                                                                                                                                                                                                                                                                           | **STRONG (reframed)**                                |

## Narrowing Signals

- **Catch rate is saturated across every cell.** 40 violation runs, 37 caught, 3
  lost to consistency violations, **0 genuine misses**. A prompt variant cannot
  score better than 100%.
- **The model-eval ranking was decided entirely by consistency violations.**
  `haiku-high` 8/10 and `sonnet-high` 9/10 were not recall gaps —
  `results.md:22` calls haiku's a "systematic gap" in _catching_, which the raw
  records contradict. That eval ranked models on schema discipline, not review
  quality.
- **`score.ts:64` conflates three failure modes into one `errored` bucket**
  (`output === null` ‖ consistency violation ‖ non-success subtype). The current
  scorer literally cannot express the only signal that has ever varied.
- **A consistency violation discards the entire review in production.**
  `index.ts:313-315` — "no verdict emitted, no comment posted", `process.exit(1)`.
  Observed rate: 3/48 ≈ 6% of runs produce no review at all.
- **User is tuning `REVIEWER_APPEND`, not `criteria.ts`** — which is precisely
  where the FAIL⇔BLOCKING rule and the severity/confidence semantics live.

## Corpus Design Signal (post-frame, user-raised)

The user's response to the reframe: the 100% score reflects that _"the issues were
simple and the diff was small"_ — proposing fixtures with **multiple issues in one
larger diff**. This is the resolution to the headroom problem and is adopted into
the frame. Four properties it implies:

- **Headroom comes from the per-run range, not the fixture count.** One planted
  defect makes the task a lookup; `results.md` Caveat 1 concedes the current
  fixtures have "no competing signal and no ambiguity about which file to look
  at." N planted defects in one diff makes a run score 0–N and forces the model to
  budget `maxTurns: 20` (`index.ts:233`) across the surface. A mean of 3.4 vs 4.1
  separates prompt variants; 100% vs 100% cannot.
- **Recall alone rewards flag-everything.** A diff containing only real defects
  makes "be maximally suspicious" the optimal prompt — which is the exact
  behaviour that discards reviews today (2 of 3 consistency violations were
  over-`FAIL`s on criteria the fixture never planted). Fixtures must carry
  **deliberate decoys** — a `USING (true)` inside a comment (verified manually
  during `code-review-impr`, see its `change.md` notes), a React component that
  genuinely needs to be React, a `src/lib/` file that is genuinely pure — and
  precision must be scored against that decoy list alongside recall.
- **Evidence for which decoys matter.** `rls-using-true` produced 2 of the 3
  consistency violations, over-`FAIL`ing `correctness` and `test_discipline` on a
  _migration_ diff — a new table with no accompanying test is an empirically
  confirmed over-flag magnet.
- **Ground truth gets contestable at multi-issue scale.** Each planted defect
  should cite the `AGENTS.md` / `tests/README.md` rule it breaks — the discipline
  `criteria.ts` already holds itself to (`criteria.ts:7-9`) — or the metric
  destabilises. Retain the existing six as a **regression floor**, not a
  replacement: a variant that breaks a saturated fixture is disqualified
  regardless of its score on the hard ones.

Open and deliberately unresolved here: whether a large fixture should stay under
`truncateDiff`'s cap or deliberately exercise the truncation path. That is a plan
decision, not a framing one.

## Cross-System Convention

Promptfoo's own coding-agent guidance is "test the system, not the model," and
recommends `output_format` json_schema over prompting-for-JSON plus `is-json` —
which is what `index.ts:234` already does. The convention for agent evals is
deterministic assertions over structured output plus trajectory/cost checks;
`score.ts` is already written in exactly that shape. The leading hypothesis
matches the convention: keep the deterministic scorer, change _what it scores_.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the existing eval corpus has zero
> measurement headroom on catch rate — 40/40 violation runs caught across every
> model — so a promptfoo eval that scores `REVIEWER_APPEND` variants on recall
> would measure nothing. The only signal that has ever varied in 48 runs is
> output discipline: 3 runs where the model marked a criterion `FAIL` without a
> `BLOCKING` finding, which discards the whole review in CI.

The initial framing was **right about the lever and wrong about the metric**.
`REVIEWER_APPEND` is genuinely the correct file to tune — the FAIL⇔BLOCKING rule,
the severity/confidence semantics, and the "criterion status" instructions all
live there, and that is exactly what the failures were. But inheriting
`model-eval`'s catch-rate metric would produce a flat grid where every prompt
variant scores 100%, and the tuning effort would chase noise. What changes if
this is addressed: the eval scores _output validity and precision_ (consistency
violations, over-FAILed criteria, spurious findings on clean diffs) on a corpus
with ambiguity in it, and a prompt variant that reduces the 6% discarded-review
rate is a measurable, shippable win.

## Confidence

**HIGH** — the run-level evidence is unambiguous and mechanical (48/48 records
inspected, not sampled), it directly contradicts a claim in the prior change's
own `results.md`, and it lands on the exact file the user independently chose to
tune. The tool-fit dimension is the only one carrying residual uncertainty, and
its two frictions have known workarounds.

## What Changes for /10x-plan

Plan a promptfoo eval — the adoption goal stands, and the `anthropic:claude-agent-sdk`
provider fits — but **do not carry over `model-eval`'s catch-rate metric**. Four
things the plan must settle:

1. **New multi-issue fixtures with decoys** (see Corpus Design Signal above) —
   the source of measurement headroom. The existing six become a regression
   floor.
2. **A graded scorer.** `score.ts:61-87` returns one categorical outcome per run
   against a single expectation; multi-issue fixtures need per-defect recall plus
   precision against a decoy list.
3. **Split `score.ts`'s `errored` bucket** (`:64`) so a consistency violation —
   the only signal that has ever varied — is distinct from an SDK error.
4. **Built-in provider vs. custom JS provider.** Promptfoo's provider plus
   `beforeEach`/`afterEach` worktree hooks is the idiomatic path; a custom JS
   provider wrapping `runReview()` preserves the `rate_limited` exclusion
   promptfoo has no native concept of, and reuses `score.ts` as a `javascript`
   assertion.

## References

- Reviewer prompt under tuning: `packages/code-reviewer/src/prompt.ts:21-96`
  (FAIL⇔BLOCKING rule at `:85-90`)
- Scorer conflating failure modes: `packages/code-reviewer/src/eval/score.ts:61-87`
- SDK options promptfoo must reproduce: `packages/code-reviewer/src/index.ts:217-237`
- Review-discarding path: `packages/code-reviewer/src/index.ts:310-322`
- Worktree lifecycle needing a promptfoo hook: `packages/code-reviewer/src/eval/worktree.ts:52-71`
- Rate-limit classification with no promptfoo equivalent: `packages/code-reviewer/src/eval/run.ts:88-101`
- Fixture corpus (5 violation + 1 clean): `packages/code-reviewer/src/eval/fixtures/`
- Raw evidence: `packages/code-reviewer/eval-results/runs.jsonl` (48 records)
- Prior change: `context/changes/model-eval/results.md` (Caveats 1–2; ranking at :14-22)
- Promptfoo docs: [Claude Agent SDK provider](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/) ·
  [Evaluate Coding Agents](https://www.promptfoo.dev/docs/guides/evaluate-coding-agents/) ·
  [JavaScript provider](https://www.promptfoo.dev/docs/providers/custom-api/) ·
  [Configuration reference](https://www.promptfoo.dev/docs/configuration/reference/)
