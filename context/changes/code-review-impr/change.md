---
change_id: code-review-impr
title: Review criteria & mechanical gate
status: implementing
created: 2026-08-11
updated: 2026-08-11
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
