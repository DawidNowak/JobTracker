---
change_id: testing-bootstrap-and-data-isolation
title: Test bootstrap + data-isolation guard (rollout phase 1)
status: implemented
created: 2026-06-16
updated: 2026-06-17

archived_at: null
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Test bootstrap + data-isolation guard".
Risks covered: #2 (Cross-user data leak via RLS regression — see §2).
Test types planned: unit + integration against local Supabase (supabase start).
Risk response intent: prove that user A's session cannot SELECT/UPDATE/DELETE rows owned by user B at the SQL layer when driven through the real Supabase SSR client against the local DB with RLS on — for BOTH the applications table AND the application_notes table. Anti-patterns to avoid: mocking Supabase (RLS is the system under test), and asserting via the service-layer abstraction (assert at the row level so a trigger/policy regression is still caught). Phase 1 also lands the project-wide test-runner choice (Vitest is the natural fit for the Vite-based Astro toolchain) and the directory/location convention for tests, since AGENTS.md currently says "no test framework — do not scaffold tests".
After creating the folder, follow the downstream continuation rule: suggest /10x-research next unless a clear blocker surfaces.
