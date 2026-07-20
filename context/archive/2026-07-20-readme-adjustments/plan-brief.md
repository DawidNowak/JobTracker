# README Adjustments — Plan Brief

> Full plan: `context/changes/readme-adjustments/plan.md`
> Research: `context/changes/readme-adjustments/research.md`

## What & Why

`README.md` is a stale, near-verbatim copy of the upstream **"10x Astro Starter"** template the repo was forked from — wrong title, wrong clone URL, no product description, and drifted facts in almost every technical section. We rewrite it end-to-end so it accurately documents **JobTracker** (a completed Polish-language job-application tracker) for developers/contributors.

## Starting Point

The current README describes a generic Astro starter: title "10x Astro Starter", a `template.png` hero, clone URL `przeprogramowani/10x-astro-starter`, a 6-item stack list, a toy structure tree, "Node 20+", and "CI runs lint + build". None of it reflects the shipped app. `AGENTS.md`, `package.json`, `.github/workflows/ci.yml`, and the research doc hold the accurate state.

## Desired End State

A README that opens with JobTracker's identity and a concise feature overview, then walks a contributor accurately through stack, prerequisites (Node 22.14.0), setup (correct repo URL), scripts, real project structure, Supabase/env config, auth routes, testing, the true two-job CI (with a required `test` gate), and manual Cloudflare deployment. Written in English, with an explicit note that the product UI is in Polish.

## Key Decisions Made

| Decision              | Choice                                      | Why                                                      | Source   |
| --------------------- | ------------------------------------------- | -------------------------------------------------------- | -------- |
| Rework depth          | Full reframe (product + all facts)          | README describes the wrong project entirely              | Research |
| Feature section depth | Concise intro paragraph + tight bullet list | Scannable, low-maintenance, README-conventional          | Plan     |
| Starter screenshot    | Remove the `template.png` reference         | It's a misleading starter artifact; no fake placeholder  | Plan     |
| Change scope          | README.md only                              | Keep it a single-purpose, easy-to-review doc change      | Plan     |
| Language              | English, note UI is Polish                  | Contributor docs convention; Polish rule targets UI copy | Plan     |
| Unbuilt features      | Excluded from Features                      | Don't present OAuth/AI/extension/etc. as shipped         | Research |

## Scope

**In scope:** Complete rewrite of `README.md` — identity, Features, Tech Stack, Prerequisites, Getting Started, Scripts, Project Structure, Supabase config, Auth routes, Testing, CI, Deployment, License. Remove the `template.png` reference.

**Out of scope:** Any non-README file; deleting `public/template.png` itself; fixing the starter landing page (`src/pages/index.astro`); fixing the English confirm-email copy; translating the README to Polish; adding a real screenshot.

## Architecture / Approach

Single-pass, section-by-section rewrite using `AGENTS.md` + `package.json` + `research.md` as the source of truth. Preserve the sections that are already correct (hosted-Supabase flow, `astro:env` secrets, email-confirmation dev toggle, `db:push`/`db:types`), correct the rest, then run `npm run format` to normalize.

## Phases at a Glance

| Phase                  | What it delivers                         | Key risk                                                               |
| ---------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| 1. Full README Rewrite | Accurate JobTracker README, all sections | Re-introducing a stale claim, or listing an unbuilt feature as shipped |

**Prerequisites:** None — research is complete and all facts are verified.
**Estimated effort:** ~1 short session, single file.

## Open Risks & Assumptions

- Assumes the research "Code References" remain accurate at implementation time (same branch/commit); verify any that feel stale.
- The Features list must stay strictly to shipped features — the biggest correctness risk is describing roadmap items as current.
- Removing (not deleting) the screenshot leaves an unreferenced `public/template.png`; a future cleanup change can delete it.

## Success Criteria (Summary)

- README describes JobTracker accurately — no "10x Astro Starter" identity, no `template.png` reference, correct clone URL.
- Every technical claim (Node 22.14.0, two-job CI with required `test`, `/archive` protection, real scripts/structure, service-role-key scoped to tests) matches the repo.
- Prettier-clean; Features lists only shipped features; English doc with a Polish-UI note.
