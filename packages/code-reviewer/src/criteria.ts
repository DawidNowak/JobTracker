/**
 * The five review criteria, as data. `schema.ts` derives its enum and required keys from
 * `CRITERION_IDS`, `prompt.ts` renders `CRITERIA` into the "what to look for" section, and
 * `output.ts` reads `title` for the report's criteria table — one array, four consumers, so
 * the criteria wording and the shapes downstream of it cannot drift apart.
 *
 * Every `rules` entry is phrased as the reviewer will read it and traces to a written rule in
 * `AGENTS.md` or `tests/README.md` — this file does not invent house rules of its own.
 */

export const CRITERIA = [
  {
    id: "correctness",
    title: "Correctness",
    description:
      "Logic that produces a wrong result, crashes, or silently does nothing — the baseline every " +
      "other criterion assumes, independent of any written house rule.",
    rules: [
      "Wrong results, crashes, or silent no-ops: off-by-one/boundary errors, unhandled null/undefined, inverted conditions, wrong comparison or operator.",
      "Missing `await`, an unhandled promise rejection, or an error path that swallows a failure instead of surfacing it.",
      "A resource acquired and never released, or state mutated during render.",
    ],
    failsWhen:
      "A concrete input or call sequence reachable from the diff produces a wrong result, a crash, or a " +
      "silently dropped error — not a hypothetical or a style preference.",
  },
  {
    id: "security_and_data_isolation",
    title: "Security & data isolation",
    description:
      "Anything that widens who can read or write what, per AGENTS.md's non-negotiable boundaries " +
      "around Supabase RLS and server-only secrets.",
    rules: [
      "AGENTS.md ✅ — every new Supabase table gets RLS with separate SELECT/INSERT/UPDATE/DELETE policies per role (anon, authenticated) using auth.uid() or an explicit role clause, defined in the table's migration.",
      "AGENTS.md 🚫 — never `USING (true)` in an RLS policy.",
      "AGENTS.md 🚫 — SUPABASE_URL and SUPABASE_KEY are server-only and must never appear in client code or a response body; SUPABASE_SERVICE_ROLE_KEY must never land in a tracked file.",
      "IDOR: an endpoint or query that lets one authenticated user read or write another user's row by guessing an id, independent of RLS.",
    ],
    failsWhen:
      "A table gains RLS missing a per-role policy for one of the four operations, uses `USING (true)`, or a " +
      "server-only secret crosses into client code or a response — or an endpoint trusts a caller-supplied id " +
      "without a policy or ownership check behind it.",
  },
  {
    id: "api_and_validation_contract",
    title: "API & validation contract",
    description:
      "Whether every API route follows the shape AGENTS.md and the Code Style section fix for all " +
      "routes in this codebase.",
    rules: [
      "AGENTS.md ✅ — export `const prerender = false` from every API route.",
      "AGENTS.md ✅ — validate inputs with zod.",
      "Code Style — API routes use uppercase handler names, zod-validated input, JSON via `@/lib/http` helpers, and Polish error copy.",
    ],
    failsWhen:
      "A new or modified API route is missing `prerender = false`, accepts input that reaches a query or " +
      "response unvalidated by zod, or returns an error in a language other than Polish.",
  },
  {
    id: "architecture_boundaries",
    title: "Architecture boundaries",
    description:
      "Whether the change respects the project's layering and import rules — island architecture, " +
      "`src/lib` purity, and the untouched shadcn boundary.",
    rules: [
      "AGENTS.md ✅ — reach for React only when browser events, state, or hooks are required (strict island architecture — no React for static content).",
      "AGENTS.md ✅ — internal imports use the `@/*` alias, never relative deep paths; Tailwind classes merge only via `cn()` from `@/lib/utils`, never concatenated strings or Astro's `class:list`.",
      "Project Structure — `src/lib/` is pure utilities only (no Supabase, no domain logic); Supabase queries and domain orchestration belong in `src/lib/services/`.",
      "AGENTS.md 🚫 — no Next.js directives (\"use client\" / \"use server\") in authored code.",
      "AGENTS.md ⚠️ — `src/components/ui/` is kept as upstream shadcn ships it so future installs diff-merge cleanly; a change there is a flag, not automatically a fail.",
    ],
    failsWhen:
      "Static, non-interactive markup is implemented as a React component; `src/lib/` gains a Supabase call " +
      "or domain logic that belongs in `src/lib/services/`; an import bypasses the `@/*` alias or concatenates " +
      "class strings instead of using `cn()`; or a Next.js directive appears in authored code.",
  },
  {
    id: "test_discipline",
    title: "Test discipline",
    description:
      "Whether the risk this change introduces is exercised by a test, and whether that test follows " +
      "tests/README.md's hard rules for how this suite is allowed to assert.",
    rules: [
      "tests/README.md Hard rules — no mocking Supabase; RLS is the system under test and mocking the client bypasses it.",
      "tests/README.md Hard rules — never assert through `src/lib/services/`; assert at the row level (PostgREST responses) so a policy regression is caught even if the service layer changes.",
      "tests/README.md Pools — a test that calls `HTMLRewriter` directly belongs in the workers pool; everything else (Supabase, process-spawning, no workerd dependency) belongs in the node pool.",
      "Coverage is risk-proportional: a new code path, edge case, or security-relevant branch this diff introduces should be exercised by a test where a regression would otherwise go unnoticed.",
    ],
    failsWhen:
      "A new test mocks the Supabase client, asserts through `src/lib/services/` instead of the PostgREST row " +
      "level, or is placed in the wrong Vitest pool for what it calls — or a security-relevant branch this diff " +
      "introduces has no test covering it at all.",
  },
] as const;

export type CriterionId = (typeof CRITERIA)[number]["id"];

export const CRITERION_IDS: readonly CriterionId[] = CRITERIA.map((criterion) => criterion.id);
