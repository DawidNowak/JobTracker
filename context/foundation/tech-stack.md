---
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
---

## Why this stack

JobTracker is a solo-built web app with a 4-week after-hours timeline requiring Google OAuth auth, a PostgreSQL-backed kanban board, and strict per-user data isolation. The 10x Astro Starter delivers Supabase (PostgreSQL + auth + storage + TypeScript SDK) and Cloudflare Pages/Workers out of the box — Google OAuth is a supported Supabase auth provider, eliminating custom auth plumbing, and the edge runtime aligns with the <500ms perceived-latency NFR. TypeScript across the full stack and Zod schemas at API boundaries match the data-integrity guardrails the PRD emphasizes: status changes, note saves, and lastActionAt resets must never be silently lost. A 4-week after-hours constraint favors a batteries-included starter over an assembled one; 10x-astro-starter clears all four agent-friendly gates and is the recommended default for (web-app, js).
