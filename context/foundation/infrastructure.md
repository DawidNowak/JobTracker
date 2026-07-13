---
project: JobTracker
researched_at: 2026-05-20
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 (full SSR, output: server)
  runtime: Cloudflare Workers (workerd)
  database: Supabase (PostgreSQL, external)
  auth: Supabase Google OAuth (external)
  adapter: "@astrojs/cloudflare ^13.5.0"
  wrangler: "^4.90.0"
---

## Recommendation

**Deploy on Cloudflare Workers.**

The project is already wired: `wrangler.jsonc` targets the Workers entrypoint (`@astrojs/cloudflare/entrypoints/server`), `nodejs_compat` is enabled, and the `@astrojs/cloudflare` adapter (v13.5.0) is pinned. Cloudflare's free tier covers 100,000 requests per day — the entire MVP runs at $0. It scores a perfect 10/10 against all five agent-friendly criteria, including a GA MCP server with 2,500+ API endpoints. The only gap between the current scaffold and a live deployment is wiring two CI secrets and adding a `wrangler deploy` step.

## Platform Comparison

Scoring: Pass = 2 / Partial = 1 / Fail = 0. Cost soft-weight applied (user priority: minimize cost).

| Platform               | CLI-first | Managed | Agent docs | Stable API | MCP     | Score  | Cost/mo             |
| ---------------------- | --------- | ------- | ---------- | ---------- | ------- | ------ | ------------------- |
| **Cloudflare Workers** | Pass      | Pass    | Pass       | Pass       | Pass    | **10** | $0                  |
| Vercel                 | Pass      | Pass    | Pass       | Pass       | Partial | 9      | ~$20 (Pro required) |
| Netlify                | Partial   | Pass    | Pass       | Partial    | Pass    | 8      | $0                  |
| Render                 | Partial   | Pass    | Pass       | Partial    | Pass    | 8      | $7                  |
| Fly.io                 | Pass      | Partial | Fail       | Pass       | Partial | 6      | $5–15               |
| Railway                | Partial   | Pass    | Partial    | Partial    | Partial | 6      | $5–8                |

**Scoring notes:**

- **Cloudflare**: Full `wrangler` CLI covers deploy, rollback by version ID, and real-time log tailing. `llms.txt` and Markdown for Agents published GA (Feb 2026). MCP server launched GA May 2026 with 2,500+ Cloudflare API endpoints.
- **Vercel**: Strong on all criteria but the free Hobby tier prohibits commercial use — Pro is $20/month from day one. Vercel MCP is Public Beta (soft signal). Supabase Marketplace integration works; `@vercel/postgres` client must be avoided (rejects Supabase pooled connection strings).
- **Netlify**: Tied cost with Cloudflare ($0 free tier, 1.5M requests/month free). Netlify MCP Server is GA. Loses points because `netlify rollback` does not exist as a CLI command — rollback is UI-only. Edge Functions default to 50ms timeout (too short for Astro SSR); must use standard Functions.
- **Render**: $7/month minimum because free-tier services spin down after 15 minutes of idle, causing 30–60s cold starts — unacceptable for SSR. Good Render MCP (GA). Ireland is the nearest EU region (adds ~10–20ms vs. a Poland-hosted data center).
- **Fly.io**: No free tier for new accounts ($5–15/month). Docs are HTML-only with no `llms.txt` or markdown source — only platform in the pool that fails the agent-readable docs criterion. Official FlyMCP exists on GitHub but is community-maintained.
- **Railway**: $5/month Hobby baseline. No `llms.txt` confirmed. Rollback is UI-based (plan-dependent retention). Railway MCP is work-in-progress / beta. EU region availability not clearly documented.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Already the scaffold's deployment target. Perfect criteria score. Free tier eliminates MVP cost entirely. Astro 6 uses the real workerd runtime locally via `astro dev`, giving production-faithful behavior during development. `wrangler` handles deploy, versioned rollback (`wrangler rollback [version-id]`), and log tailing in a single CLI. The GA MCP server is the most mature agent integration of any platform evaluated.

#### 2. Netlify

Tied on cost ($0 free tier). Astro SSR adapter is GA and actively maintained. Netlify MCP Server is GA with deploy, env var, and project management tools. The gap vs. Cloudflare: no CLI rollback (UI-only), Edge Functions can't be used for SSR (50ms timeout), and the standard Functions compute defaults to US East — latency to Poland is higher than Cloudflare's global edge.

#### 3. Render

$7/month minimum for always-on SSR (no cold starts). Render MCP Server is GA. Ireland region is the nearest EU option. Scores identically to Netlify on criteria but costs more — ranked third on the cost-priority weight. A reasonable fallback if Cloudflare runtime compatibility becomes a blocker during implementation.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **workerd ≠ full Node.js**: The Workers runtime does not expose all Node.js built-ins. npm packages that use `fs`, `net`, `crypto`, or DOM globals can fail in workerd even with `nodejs_compat` enabled. The job portal HTML parsing feature ("Pobierz dane oferty") is the highest-risk surface — the chosen parser must be workerd-compatible or the endpoint will 503 in production while passing local tests.
2. **Free tier CPU time limit is 10ms per request** (CPU time, not wall-clock): CPU-intensive SSR paths — particularly HTML parsing of dense JustJoinIT or LinkedIn pages — can exceed this limit and return 503. The 30-second limit on the paid plan ($5/month) is a low-cost fix, but the free-tier assumption needs validation against real job listing payloads.
3. **No persistent TCP connections to Supabase**: Each Workers request creates a new HTTPS connection to Supabase. At low QPS (MVP scale) this is imperceptible. At 20+ concurrent users it can add 200–400ms per request, pushing past the 500ms NFR. Hyperdrive (Cloudflare's connection pooling layer) mitigates this but requires configuration and adds $0.20 per million queries beyond free limits.
4. **Workers replaces Pages for SSR**: `wrangler.jsonc` already targets the Workers entrypoint correctly. This is not a migration risk for this project, but it means some Cloudflare Pages documentation (preview URLs, branch deploys, analytics) does not apply — look for Workers-specific docs, not Pages.
5. **Vendor lock-in deepens with each Cloudflare primitive**: The current scaffold uses Workers only. Adding KV, D1, or Durable Objects increases switching cost. Keep Supabase as the exclusive data layer to preserve portability.

### Pre-Mortem — How This Could Fail

The team shipped the MVP on Cloudflare Workers at the end of week 4. Everything worked in development. Week 5, real users submitted JustJoinIT URLs with dense multi-kilobyte job descriptions. The HTML parser — a popular library that had worked fine in local `astro dev` tests — internally used a Node.js DOM API not polyfilled by `nodejs_compat`. In production it threw `ReferenceError: document is not defined` and the "Pobierz dane oferty" button returned a 503 for every JustJoinIT URL. The team discovered the error in wrangler logs but the root cause took a day to isolate because the error message pointed to a minified internal stack frame, not their own code. They switched parsers, but the replacement exceeded the free tier's 10ms CPU limit on large payloads — a second failure mode they discovered only after deploying the fix. They upgraded to the $5/month Workers Paid plan to raise the CPU limit, which resolved both issues. Net impact: two unplanned days of debugging and one week of missed polish work. The mistake was not testing the parsing endpoint against real production-scale HTML payloads using `wrangler dev` (the production-faithful command) rather than `astro dev` (which uses Node.js, not workerd).

### Unknown Unknowns

- **`astro dev` uses Node.js; `wrangler dev` uses workerd**: For production-faithful behavior, run `npx wrangler dev` instead of `npm run dev` when testing any server-side code. The two can diverge on runtime API availability. This is especially important for the portal scraping endpoint.
- **Cloudflare Auto Minify breaks Astro hydration**: If Auto Minify is toggled on in the Cloudflare dashboard (a common default for new zones), it mangles `<script type="module">` tags and breaks client-side React component hydration. Disable it before first user test.
- **Supabase project region determines actual latency**: Supabase free projects are single-region. If the Supabase project was initialized with `us-east-1` (the Supabase default), every Workers request — even from a Polish edge node — round-trips to Virginia. Verify the Supabase project region in the dashboard and migrate to `eu-central-1` (Frankfurt) or `eu-west-1` (Ireland) if latency to Poland matters.
- **Supabase free tier pauses after 1 week of inactivity**: An inactive Supabase project takes 30+ seconds to wake on the next request. This will manifest as a Cloudflare timeout (the Worker itself is fine). Keep the Supabase project active during development or upgrade to Supabase Pro before the first user demo.
- **Both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are required in CI**: The current `ci.yml` has `SUPABASE_URL` and `SUPABASE_KEY` wired but no Cloudflare secrets. Wrangler fails with an opaque auth error if either is missing. The API token needs the `Workers Scripts:Edit` and `Workers Routes:Edit` permissions at minimum.

## Operational Story

- **Preview deploys**: Workers does not provide automatic branch-preview URLs (that was a Pages feature). For MVP, deploy manually to a named preview worker: `npx wrangler deploy --name job-tracker-preview`. Add a separate GitHub Actions job on PRs that deploys to the preview worker using the same secrets.
- **Secrets**: Stored in Cloudflare's encrypted secret store per Worker. Set with `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` (interactive prompt). List with `npx wrangler secret list`. Never commit secrets to `wrangler.jsonc`. For CI, inject as `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` GitHub repository secrets.
- **Rollback**: `npx wrangler deployments list` to get version IDs; `npx wrangler rollback [version-id]` to revert in seconds. Database migrations (Supabase) do not roll back automatically — coordinate schema changes with deployment versions.
- **Approval**: An agent may run `npm run build && npx wrangler deploy` unattended after passing CI. Secret rotation (`wrangler secret put`) and account-level changes (custom domains, billing tier) require a human. No human approval needed for standard deploys or rollbacks.
- **Logs**: Real-time: `npx wrangler tail job-tracker --format json`. Filter errors only: `npx wrangler tail job-tracker --status error`. Historical logs are available in the Cloudflare dashboard under Workers > job-tracker > Logs (observability is enabled in `wrangler.jsonc`).

## Risk Register

| Risk                                                              | Source           | Likelihood | Impact | Mitigation                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML parser library uses Node.js globals not available in workerd | Devil's advocate | High       | High   | Test the parsing endpoint with `npx wrangler dev` (not `astro dev`) against real job listing HTML before shipping. Choose parsers explicitly tested on Cloudflare Workers (e.g., `node-html-parser`, `linkedom`). |
| Free-tier 10ms CPU limit exceeded by HTML parsing                 | Pre-mortem       | Medium     | Medium | Benchmark the parser against large real payloads in `wrangler dev`. If CPU time exceeds 8ms, upgrade to Workers Paid ($5/month) before launch.                                                                    |
| Supabase project in wrong region adds 100–200ms per request       | Unknown unknown  | Medium     | Medium | Check Supabase project region in dashboard. If not `eu-central-1` or `eu-west-1`, migrate the project now (free tier allows one active project).                                                                  |
| Supabase free project pauses after inactivity                     | Unknown unknown  | Medium     | High   | Keep the Supabase project active during development. Upgrade to Supabase Pro ($25/month) before the first external user demo.                                                                                     |
| Cloudflare Auto Minify breaks React hydration                     | Unknown unknown  | Medium     | High   | In Cloudflare dashboard → Speed → Optimization, disable Auto Minify for JavaScript before the first browser test.                                                                                                 |
| CI deploy fails silently (missing CLOUDFLARE_ACCOUNT_ID secret)   | Unknown unknown  | High       | Medium | Add both `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to GitHub repository secrets before writing the deploy workflow step.                                                                                 |
| Supabase connection latency spikes at 20+ concurrent users        | Devil's advocate | Low        | Medium | At MVP scale this is unlikely. If the 500ms NFR is breached under load, enable Hyperdrive in `wrangler.jsonc` to pool connections.                                                                                |
| Worker name "10x-astro-starter" deployed as-is                    | Research finding | High       | Low    | Rename `name` in `wrangler.jsonc` to `job-tracker` before first `wrangler deploy`. The name becomes the Worker subdomain on `workers.dev`.                                                                        |

## Getting Started

The scaffold is already configured for Cloudflare Workers deployment. Four steps remain before the first live deploy:

1. **Rename the Worker** — update `name` in `wrangler.jsonc` from `"10x-astro-starter"` to `"job-tracker"`. This sets the `workers.dev` subdomain and Worker identity in the Cloudflare dashboard.

2. **Get a Cloudflare API token** — log into dash.cloudflare.com → My Profile → API Tokens → Create Token. Use the "Edit Cloudflare Workers" template (grants `Workers Scripts:Edit` + `Workers Routes:Edit`). Copy the token and your Account ID from the dashboard sidebar.

3. **Wire Worker secrets** — run these two commands (interactive prompt for values):

   ```
   npx wrangler secret put SUPABASE_URL
   npx wrangler secret put SUPABASE_KEY
   ```

4. **First manual deploy** — build and deploy to verify the scaffold is live:

   ```
   npm run build
   npx wrangler deploy
   ```

   The command prints the live URL (`https://job-tracker.<your-subdomain>.workers.dev`). Visit it and confirm the Supabase auth flow works.

5. **Wire CI for auto-deploy on merge** — add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub repository secrets, then append a deploy step to `.github/workflows/ci.yml` (run only on `master`, after the build step):
   ```yaml
   - name: Deploy to Cloudflare Workers
     if: github.ref == 'refs/heads/master'
     run: npx wrangler deploy
     env:
       CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
       CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
   ```

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup beyond the deploy step above
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare Access configuration for preview worker protection
- Custom domain setup (handled in Cloudflare dashboard after first deploy)
