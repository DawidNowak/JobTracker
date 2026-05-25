---
name: blocker-resolved
description: Close a finished GitHub issue on DawidNowak/JobTracker and update downstream `blocked` → `ready` labels via the Issue Dependencies graph. Invoke when the user types `/blocker-resolved <issue-number>` (e.g. `/blocker-resolved 5`) or otherwise signals that work on a specific issue is complete and the dependency graph should be reconciled.
---

# /blocker-resolved

Use this skill when the user has finished work on a JobTracker issue and wants downstream dependents reconciled. The skill is **idempotent** — running it against an already-closed issue is fine and will still recompute labels.

## Repository

- Owner: `DawidNowak`
- Name: `JobTracker`
- All `gh` calls below MUST pass `--repo DawidNowak/JobTracker` (the user may be in a different working directory).

## Inputs

- A single argument: the GitHub issue number (positive integer). Parse it from the slash invocation (`/blocker-resolved 5`) or from the user's message ("I'm done with #5"). If you cannot identify an unambiguous integer, ask the user before proceeding.

## Steps

### 1. Resolve the issue's current state

```powershell
gh issue view <N> --repo DawidNowak/JobTracker --json state,title,number
```

- If the command fails (e.g. issue does not exist), report the error and stop.
- Capture `state` and `title`.

### 2. Close if open

If `state == "OPEN"`:

```powershell
gh issue close <N> --repo DawidNowak/JobTracker
```

If GitHub refuses (the issue itself has open blockers — Issue Dependencies prevents premature close), surface the error verbatim and stop. Do NOT bypass it.

If `state == "CLOSED"` already, skip this step and continue — the skill is idempotent on re-runs.

### 3. Query dependents in one call

```powershell
gh api graphql -F n=<N> -f query='
  query($n: Int!) {
    repository(owner: "DawidNowak", name: "JobTracker") {
      issue(number: $n) {
        blocking(first: 50) {
          nodes {
            number
            title
            state
            labels(first: 20) { nodes { name } }
            blockedBy(first: 20) { nodes { number state } }
          }
        }
      }
    }
  }'
```

Parse `.data.repository.issue.blocking.nodes`. If empty, jump to step 5 with "no dependents".

### 4. Update labels per dependent

For each child node:

- Skip if `child.state != "OPEN"` (already closed — nothing to relabel).
- Count `child.blockedBy.nodes` where `state == "OPEN"`. Note: at this point the just-closed issue should appear with `state == "CLOSED"` since step 2 closed it — so it should not be counted as an open blocker.
- **If open-blocker count == 0** → child is newly ready:
  ```powershell
  gh issue edit <child-number> --repo DawidNowak/JobTracker --remove-label blocked --add-label ready
  ```
- **If open-blocker count ≥ 1** → child still blocked. Record the remaining open blocker numbers for the report. Do **not** touch its labels.

`gh issue edit --add-label / --remove-label` is idempotent (no-op if already in target state) — safe to run regardless of current label state.

### 5. Report to the user

Emit a short summary, in this exact shape:

- `Closed #<N> (<title>)` — or `#<N> already closed (<title>)` if step 2 was skipped.
- For each newly-ready child: `Unblocked → ready: #<X> (<title>)`.
- For each still-blocked child: `Still blocked: #<Y> waiting on #<Z>, #<W>` (list remaining open blocker numbers).
- `No dependents.` if the `blocking` set was empty.

Keep the report to one bullet per child. No extra commentary.

## Edge cases

- **Issue does not exist** (step 1 fails): report the error, stop.
- **Issue already closed**: step 2 is a no-op; still run steps 3–5 (lets the user reconcile after a manual web-UI close).
- **Issue has open blockers itself** (step 2 refused by GitHub): surface verbatim, stop. User error — they're trying to close out-of-order.
- **No dependents** (`blocking` empty): step 5 reports `No dependents.` and exits.
- **Child has multiple parents, some still open**: leave `blocked`; list remaining blocker numbers in the report.
- **Labels already correct**: idempotent — re-runs make no visible change. Good.
- **Manual label drift** (user hand-edited `ready` / `blocked`): the skill only reasserts state for children of the issue passed in. It will not sweep the entire repo. If you suspect broader drift, mention it in the report; do not attempt a global resync.
- **Non-integer or missing argument**: ask the user for the issue number; do not guess.

## Related docs

- `context/foundation/gh-issues-process.md` — conventions for labels, dependency graph, and post-MVP slice creation.
- `context/foundation/roadmap.md` — shaping artifact (do not edit from this skill).
