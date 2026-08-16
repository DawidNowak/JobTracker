# Review Criteria & Mechanical Gate — Plan Brief

> Full plan: `context/changes/code-review-impr/plan.md`
> Predecessor: `context/archive/2026-08-11-cicd-review-impr/plan-brief.md`

## What & Why

The CI reviewer already scores five dimensions and already emits structured output — but the five are
the generic software-review set, and the structure gives the pipeline nothing to gate on. This change
rebuilds the five around **JobTracker's own rules, which existed long before the agent**, and replaces
the fuzzy 1–10 scorecard with a per-criterion status enum plus structured findings, so the verdict is
**computed in Node** rather than authored by the model — and the workflow can mechanically stop a
change on it.

## Starting Point

`src/schema.ts:7` holds the generic five; the internal rules reach the agent only indirectly, via
`settingSources: ["project"]` loading `AGENTS.md`. The 1–10 scores are decorative — nothing reads them
but the comment renderer. Findings are one free-text `report_markdown` blob, so nothing can verify a
verdict is backed by a located finding. And the gate does not gate: `ai-code-review.yml:44-58` applies
labels, the job never fails. Separately, `src/git.ts:70` excludes only lockfiles and generated types,
so every `context/**` markdown body a PR touches is embedded in the prompt.

## Desired End State

`src/criteria.ts` is the single source of truth for five criteria, each citing the written rules it
enforces. The agent returns five criterion results (`PASS`/`CONCERN`/`FAIL`/`NOT_APPLICABLE` +
rationale) and a structured findings array — and **no verdict field at all**. `index.ts` derives it:
`FAIL` iff any criterion is `FAIL`, guarded by a validated biconditional that a failing criterion
carries a `BLOCKING`/`CERTAIN` finding with a `file:line`. On `FAIL` the CI job turns red; branch
protection stays a switch the user flips.

## Key Decisions Made

| Decision              | Choice                                                                            | Why                                                                             |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Criteria set          | Replace with five internal-anchored criteria; keep only `correctness`             | Every criterion cites a rule written down before the agent existed              |
| Dropping `complexity` | Accepted as the cost                                                              | Its reuse-catching value partly moves into `architecture_boundaries`            |
| Criteria home         | New `src/criteria.ts`, one array driving schema + prompt + report                 | Extends the anti-drift intent `schema.ts:1-5` already states for itself         |
| Per-criterion shape   | Status enum only, no 1–10 score                                                   | A decision the pipeline can branch on; 1–10 is the fuzziness we're removing     |
| `NOT_APPLICABLE`      | Explicit fourth value, non-blocking                                               | Honest signal over an invented judgment; a never-firing criterion is visible    |
| Verdict               | **Removed from the schema**; computed in `index.ts`                               | It can never contradict the detail beneath it; the rule becomes readable code   |
| Gate rule             | `FAIL` iff ≥1 criterion is `FAIL`; `CONCERN` never blocks                         | One auditable sentence; `CONCERN` is the valve against forced blocking          |
| Evidence rule         | Biconditional: criterion `FAIL` ⟺ ≥1 `BLOCKING` + `CERTAIN` finding with a `file` | A FAIL is always backed by citable evidence — enforced in both directions       |
| Findings              | Structured array; `output.ts` renders the markdown                                | Completes the design `output.ts:44-48` already describes                        |
| CI blocking           | Job goes red on `FAIL`; required-check status stays manual                        | Delivers the gate while "nobody can merge" stays a deliberate human action      |
| Red wiring            | Separate `Enforce verdict` **workflow** step, not a non-zero exit                 | Exit 1 keeps meaning "the run broke"; label steps aren't skipped                |
| Partial diff          | Gate normally; existing truncation note carries the caveat                        | A bug in the visible lines is still real                                        |
| Gate tests            | No test runner added; `deriveVerdict` stays pure, testable later                  | Avoids a new dependency (`AGENTS.md` ⚠️), keeps the package's zero-test shape   |
| `context/**` in diff  | Excluded from the embedded diff body                                              | Full plans stop costing tokens on every review — the reason plan.md was skipped |

## Scope

**In scope:** `src/git.ts` (excludes) · `src/criteria.ts` (new) · `src/schema.ts` · `src/prompt.ts` ·
`src/output.ts` · `src/index.ts` · `.github/workflows/ai-code-review.yml` (⚠️ approved) ·
`packages/code-reviewer/README.md`

**Out of scope:** `AGENTS.md` / `context/foundation/` docs · a test runner for the package · branch
protection changes · `model` / `effort` / `maxBudgetUsd` / the 3000-line cap / `action.yml` · per-PR
criteria selection · backwards compatibility with the old output shape

## Architecture / Approach

One array in `src/criteria.ts` drives four consumers: `schema.ts` (enum + required keys), `prompt.ts`
(the "what to look for" section), `output.ts` (table labels), and `index.ts` (which derives the
verdict and emits it to `$GITHUB_OUTPUT`, where the workflow's enforce step reads it). The model fills
only what it can observe — criterion status, rationale, findings. The pass/block decision is
arithmetic over that, done in Node.

**The five:** `correctness` · `security_and_data_isolation` (RLS per-role policies, no `USING (true)`,
server-only secrets, IDOR) · `api_and_validation_contract` (`prerender = false`, zod, `@/lib/http`,
Polish copy) · `architecture_boundaries` (islands, `src/lib` purity, `@/*`, `cn()`, no Next
directives, `ui/` untouched) · `test_discipline` (risk coverage, no Supabase mocking, no service-layer
asserts, correct pool).

## Phases at a Glance

| Phase                                               | What it delivers                                      | Key risk                                                 |
| --------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------- |
| 1. `git.ts` excludes                                | `context/**` bodies out of the reviewed diff          | None significant — one pathspec                          |
| 2. `criteria.ts`                                    | The five criteria as data                             | Rules phrased too loosely become unenforceable           |
| 3. Contract swap (schema + prompt + output + index) | New output shape, `deriveVerdict`, `checkConsistency` | **Highest** — richer schema may exhaust `maxTurns` again |
| 4. `ai-code-review.yml`                             | The job goes red on `FAIL`                            | First red PR is the real calibration test                |
| 5. `README.md`                                      | Criteria, gate rule, corrected framing                | None — documentation only                                |

**Prerequisites:** none blocking. Self-contained package plus one approved workflow edit; no schema/DB
change, no new dependency.
**Estimated effort:** ~1 session, one PR. Phase 3 is the bulk of it.

## Open Risks & Assumptions

- **Structured-output retries.** `maxTurns: 20` was tuned against the _old_, flatter shape after a run
  at 10 hit `error_max_structured_output_retries`. If it reappears, raise `maxTurns` — don't simplify
  the schema.
- **No automated cover on the gate rule.** `deriveVerdict` and `checkConsistency` can wrongly block a
  PR and ship hand-verified only. Both are pure and exported, so a runner can be added later without
  rework — a deliberate, revisitable trade.
- **Strict consistency turns model non-compliance into errored runs**, not degraded reviews. Intended
  direction; if it trips often, tighten the prompt rather than loosen the check.
- **Excluding `context/**` costs the reviewer sight of the plan\*\* a PR claims to implement.
- Assumes the five criteria cover what actually breaks here; a criterion that returns
  `NOT_APPLICABLE` on nearly every PR is a signal to re-cut the set.

## Success Criteria (Summary)

- A PR violating a written internal rule fails the criterion that owns it, with a `file:line` finding,
  and the CI job turns red.
- A clean PR passes all five (or marks some `NOT_APPLICABLE`) and stays green.
- The PR comment shows a criteria table and structured findings, with no model-authored verdict.
- `npm run typecheck` passes in `packages/code-reviewer`.
