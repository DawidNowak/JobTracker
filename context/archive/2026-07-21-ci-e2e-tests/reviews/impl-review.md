<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: E2E as a PR-Pipeline Quality Gate

- **Plan**: context/changes/ci-e2e-tests/plan.md
- **Scope**: Phases 1–3 of 3 (all complete)
- **Date**: 2026-07-21
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success Criteria Evidence

- **1.1 YAML parses** — `python -c "import yaml; yaml.safe_load(...)"` → OK.
- **2.1 No surviving "not a gate" assertion** — broadened `git grep` returns only the 3 allow-listed §8 ledger lines (306–307 history + 308 superseding reversal note). No unreconciled contradiction.
- **2.2 Prettier clean** — `prettier --check` on all edited files → "All matched files use Prettier code style!"
- **2.3 typecheck + lint** — `astro check` 0 errors; `eslint .` 0 errors (12 pre-existing `no-console` warnings in scripts, unrelated to this change).
- **Phase 1/3 CI + promotion** — verified via recorded run IDs and `mergeStateStatus` BLOCKED→CLEAN evidence in `change.md` (concrete, not rubber-stamped).
- **NOT-doing guardrails** — `retries: 0` retained, no `workers` cap / `--workers`, `.spec.ts` net-zero vs master (deliberate breaks fully reverted), single parallel job.

## Findings

### F1 — Chromium cache key invalidates on any dependency change

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Efficiency
- **Location**: .github/workflows/ci.yml:64
- **Detail**: The cache key `${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}` hashes the whole lockfile, so _any_ dependency bump (not just `@playwright/test`) invalidates the Chromium binary cache and triggers a ~30–60s re-download. This exactly matches the plan's Phase 1 item 5 (which explicitly prescribed this key to avoid the stale-caret-key trap), so it is plan-adherent — noted only as a future efficiency lever. There is also no `restore-keys` fallback, so a miss is always a full cold fetch. Correctness is unaffected: `npx playwright install --with-deps chromium` runs unconditionally and is idempotent.
- **Fix**: Optional — narrow the key to the resolved Playwright version (e.g. add a `restore-keys: ${{ runner.os }}-playwright-` prefix line) so unrelated dep bumps reuse the browser binary. Low value at ~10 specs; safe to leave as-is.
- **Decision**: FIXED — added `restore-keys: ${{ runner.os }}-playwright-` fallback to the cache step (ci.yml); YAML re-validated.

### F2 — Deliberate-break verification commits will land in master history unless squash-merged

- **Severity**: 🟦 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: git history (0d2fa34/52ae31e, a6987e6/a92bbaa)
- **Detail**: Four TEMPORARY commits (two break + two revert) exercise the CI gate and merge-block per the plan's verification steps. They net to zero (spec files identical to master), so there is no code impact — but if this branch is merged with a merge commit rather than squashed, the noise commits enter `master` history. This is the inherent cost of the plan-prescribed "break → push → observe red → revert" proof method.
- **Fix**: Squash-merge the PR (or interactive-rebase the four commits away pre-merge) so master history stays clean. No code change.
- **Decision**: SKIPPED — noted as a merge-time reminder (squash-merge PR #22); no repo change, this is a PR-merge choice not a code fix.
