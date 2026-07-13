---
bootstrapped_at: 2026-05-19T17:30:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: job-tracker
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: job-tracker
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

**Why this stack:**
JobTracker is a solo-built web app with a 4-week after-hours timeline requiring Google OAuth auth, a PostgreSQL-backed kanban board, and strict per-user data isolation. The 10x Astro Starter delivers Supabase (PostgreSQL + auth + storage + TypeScript SDK) and Cloudflare Pages/Workers out of the box — Google OAuth is a supported Supabase auth provider, eliminating custom auth plumbing, and the edge runtime aligns with the <500ms perceived-latency NFR. TypeScript across the full stack and Zod schemas at API boundaries match the data-integrity guardrails the PRD emphasizes: status changes, note saves, and lastActionAt resets must never be silently lost. A 4-week after-hours constraint favors a batteries-included starter over an assembled one; 10x-astro-starter clears all four agent-friendly gates and is the recommended default for (web-app, js).

## Pre-scaffold verification

| Signal      | Value                                                     | Severity | Notes                                                                       |
| ----------- | --------------------------------------------------------- | -------- | --------------------------------------------------------------------------- |
| npm package | not run                                                   | —        | git-clone strategy; cmd_template starts with `git clone`, npm check skipped |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-05-17 | fresh    | from card.docs_url                                                          |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone (cloned starter repo, deleted upstream git history, moved files up into cwd)
**Exit code**: 0
**Files moved**: 49 source files + node_modules (773 packages)
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: moved silently (no cwd counterpart)
**context/ handling**: not present in scaffold; cwd context/ preserved untouched
**.bootstrap-scaffold cleanup**: deleted

## Post-scaffold audit

**Tool**: `npm audit --json`
**Summary**: 0 CRITICAL, 1 HIGH, 10 MODERATE, 0 LOW
**Direct vs transitive**: 0/0 direct CRITICAL/HIGH of total 0/1; 3 direct MODERATE of 10 total

#### CRITICAL findings

None.

#### HIGH findings

- **devalue** — range `5.6.3 - 5.8.0` (transitive, via `@astrojs/cloudflare` → `@cloudflare/vite-plugin` chain)
  - Advisory: [GHSA-77vg-94rm-hx3p](https://github.com/advisories/GHSA-77vg-94rm-hx3p) — DoS via sparse array deserialization
  - CVSS: 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
  - Fix available: `npm audit fix`

#### MODERATE findings

**Direct:**

- **@astrojs/check** ≥0.9.3 — via `@astrojs/language-server` → `volar-service-yaml` → `yaml-language-server` → `yaml`. Fix: downgrade to `@astrojs/check@0.9.2` (semver-major).
- **@astrojs/cloudflare** ≥12.2.4 — via `@cloudflare/vite-plugin` + `wrangler`. Fix: `@astrojs/cloudflare@12.6.13` (semver-major).
- **wrangler** ≥3.108.0 — via `miniflare` → `ws`. Fix: `wrangler@3.107.3` (semver-major).

**Transitive (log only):**

- **@astrojs/language-server** ≥2.14.0 — via `volar-service-yaml`
- **@cloudflare/vite-plugin** — via `miniflare` + `wrangler` + `ws`
- **miniflare** — via `ws` (uninitialized memory disclosure in `ws` <8.20.1)
- **volar-service-yaml** ≤0.0.70 — via `yaml-language-server`
- **ws** 8.0.0–8.20.0 — [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) uninitialized memory disclosure, CVSS 4.4
- **yaml** 2.0.0–2.8.2 — [GHSA-48c2-rrv3-qjmp](https://github.com/advisories/GHSA-48c2-rrv3-qjmp) stack overflow via deeply nested YAML, CVSS 4.3
- **yaml-language-server** — via `yaml`

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- Review `CLAUDE.md` — the starter ships one; it will be updated by the agent-context skill later.
- Configure Supabase: create a project at supabase.com, copy credentials into `.env` (see `.env.example`).
- Configure Cloudflare: update `wrangler.jsonc` with your account/project details.
- `git init` (if you have not already) to start your own repo history.
- Address the 1 HIGH finding (`devalue`) per your project's risk tolerance — it is a dev/build-time transitive dependency, not a runtime production concern at this stage.
- Full audit breakdown is in this log.
