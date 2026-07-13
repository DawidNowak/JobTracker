---
change_id: testing-quality-gate-wiring
title: Quality gate wiring — enforce the existing test suite as a required CI gate
status: archived
created: 2026-06-23
updated: 2026-06-23
archived_at: 2026-06-23T12:41:54Z
---

## Notes

Open a change folder for rollout Phase 4 of context/foundation/test-plan.md: "Quality gate wiring".
Risks covered: gating regression for #1-#5 (parser correctness #1, RLS cross-user #2, lastActionAt trigger #3, parser SSRF/allowlist #4, IDOR #5).
Test types planned: CI YAML edits, GitHub Actions secrets, optional scheduled parser-HTML-drift canary.
Risk response intent: Phase 4 adds no new test logic - it locks the floor by enforcing the existing unit + integration suite (Risks #1-#5) as a REQUIRED CI gate on push/PR, running against an ephemeral or local Supabase, with NO coverage threshold (per test-plan.md S7). Optionally add a scheduled parser-HTML-drift canary for the slow-burn portal-HTML-change class of Risk #1. Respect S7 exclusions: no coverage gates/thresholds, no workerd-divergence gate.
After creating the folder, follow the downstream continuation rule.

## Deferred Follow-up: Parser-HTML-Drift Canary

The parser-HTML-drift canary (Risk #1 slow-burn class) was deliberately not built here.

**What it is:** A scheduled CI job (GitHub Actions cron) that fetches a live LinkedIn and JustJoin.it job-offer page, runs the respective parser, and diffs the output against fixture-derived field expectations. Alerts (failing check or notification) when portal HTML drifts enough to silently corrupt a field.

**Open design questions before opening a `/10x-new` for it:**

- Rate-limit / ToS risk: LinkedIn's guest API and JJIT both serve publicly accessible URLs, but automated scheduled crawls may hit rate limits or violate terms. The canary must use polite delays and a real User-Agent.
- Alerting: a failing cron check does not block PRs; a separate notification channel (GitHub Actions email, Slack webhook, or a dedicated status badge) is needed so drift is noticed before it accumulates.
- Flakiness isolation: portal HTML can change for cosmetic reasons (layout, A/B tests) without breaking the parser. The canary should be scoped to the fields the parser actually extracts (`position`, `company`, `description`, `salary`, `work_mode`) and must not red on unrelated DOM changes.
- The canary must be a non-blocking gate — it must never become a required check on PRs (that would couple PR mergeability to third-party uptime).

**To open it:** `/10x-new parser-html-drift-canary` when the team decides to address Risk #1's slow-burn class.
