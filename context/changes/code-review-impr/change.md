---
change_id: code-review-impr
title: Review criteria & mechanical gate
status: implementing
created: 2026-08-11
updated: 2026-08-12
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

**Phase 1 scope broadened during implementation (2026-08-11):** a live `npm run review` run
surfaced the model reading `context/archive/**` content directly via the `Read` tool, because
those files still appeared in the changed-files list even with their diff body excluded.
Decided to exclude all of `context/**` (not just `context/archive/**`) from `getChangedFiles`,
`getDiffStat`, and `getDiff` alike — fully invisible, not just diff-body-excluded — since
`/10x-impl-review` already owns comparing implementation to plan, and none of this reviewer's
five criteria can act on "a plan changed" anyway. `GENERATED_FILE_EXCLUDES` narrowed back to
just its original two lockfile/type entries; a new `OUT_OF_SCOPE_EXCLUDES = ["context/**"]`
covers the stricter full exclusion, applied in all three `git.ts` functions.

**Phase 3 manual verification (2026-08-12):** ran `npm run review` live against the real Phase 3
diff (5 criteria + findings, no schema-retry error, PASS matching `deriveVerdict`), then twice
more with a deliberate break layered on top (missing `prerender = false` → `api_and_validation_contract`
FAIL with a file:line BLOCKING finding; `USING (true)` in a throwaway migration → `security_and_data_isolation`
FAIL, correctly ignoring an in-file comment claiming the change was "temporary"). `checkConsistency`/
`deriveVerdict` were also exercised directly against hand-built fixtures (not through a live model
run) to confirm the FAIL⇔BLOCKING biconditional rejects an inconsistent output. Cost/turns across
the three live runs: $0.60–$0.83, 15–19 turns — within the README's $0.30–1.00 band. One deviation:
an attempt to build a fully isolated docs-only diff (via a throwaway integration branch pointed at
as `origin/master`) tripped a pre-commit hook that spawned a dev server and hung on a port conflict;
abandoned that approach and relied instead on the `NOT_APPLICABLE` behavior already observed
repeatedly for untouched criteria across the other three runs.

**Phase 4 manual verification (2026-08-12):** verified live against a throwaway PR (#28, base
`master`, closed and deleted after). FAIL path: dropped `prerender = false` from
`src/pages/api/applications/index.ts` → job red, `ai-cr:failed` applied, reviewer correctly cited
`api_and_validation_contract` FAIL with a `file:line` BLOCKING finding (it also flagged a real,
pre-existing bug in `output.ts` — unescaped `|` in `formatCriteriaTable`'s markdown cells — noted
as a follow-up, not fixed here). Retry path: re-applying `ai-cr:review` mid-FAIL triggered a fresh
run and the label was auto-removed after. PASS path: reverted the violation, pushed, job went
green with `ai-cr:passed`. Errored-run path: blanked `claude-code-oauth-token` in the workflow
input (not the secret) to trip the composite action's own token guard before any verdict —
job still failed via the review step's exit code, `Enforce verdict` correctly showed `skipped`.

**Phase 5 manual verification (2026-08-12):** cross-checked the new README sections against the
implemented source rather than re-deriving them from the plan — "Review criteria" table against
`src/criteria.ts`'s ids/titles, "Gate rule" against `.github/workflows/ai-code-review.yml`'s
`Enforce verdict` step (ordering, `if` condition) and `src/schema.ts`'s `deriveVerdict`/
`checkConsistency`, and the "How it is wired" `outputFormat` row against the actual
`parseReviewOutput` → `checkConsistency` → `deriveVerdict` → `emitVerdict`/`deliverReport` flow in
`src/index.ts`. Grepped for leftover non-blocking language ("not a merge gate", "non-blocking") —
none remained; the old sentence was replaced with wording noting the job now goes red on `FAIL`.
