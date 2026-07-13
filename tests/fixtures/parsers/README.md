# Parser HTML Fixtures

Captured HTML payloads used by the workers-pool parser unit tests. One fixture per scenario per portal;
test files live at `tests/unit/parsers/{linkedin,justjoinit}.test.ts`.

## Capture procedure

```sh
curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
     -H "Accept-Language: en-US,en;q=0.9,pl;q=0.8" \
     "<url>" > tests/fixtures/parsers/<portal>/<name>.html
```

Use the same User-Agent string the parsers use (`src/lib/parsers/linkedin.ts:4`,
`src/lib/parsers/justjoinit.ts:4`) so the captured HTML matches what the parser
would receive in production.

For LinkedIn the URL is the guest job API endpoint:
`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<jobId>`

For JustJoin.it the URL is the full job offer page:
`https://justjoin.it/job-offer/<slug>`

## Fixture catalogue

### LinkedIn

| File                    | Type                      | Source URL / note                                                                                                                                                                                                                                                                                     | Capture date |
| ----------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `happy.html`            | Real                      | `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4422277574` — "Senior .Net Developer" at Tata Consultancy Services (Hybrid). Position, company, description, work_mode present; salary absent (see note below).                                                                              | 2026-06-22   |
| `salary-synthetic.html` | **Synthetic**             | Minimal hand-authored HTML exercising the `.compensation__salary` selector only. LinkedIn's guest API almost never renders salary (it surfaces only for US pay-transparency postings), so a real fixture cannot cover this path. Treat its assertions as a selector contract, not real-HTML coverage. | 2026-06-18   |
| `missing-salary.html`   | Real                      | `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4190845636` — "Auxiliar de Recursos Humanos" at EDs RH, São Paulo, Brazil. Salary and work_mode genuinely absent.                                                                                                                            | 2026-06-18   |
| `corrupted.html`        | Derived from `happy.html` | Both title selector classes (`top-card-layout__title`, `topcard__title`) removed from the title `<h2>` element. Parser throws "LinkedIn topcard empty" and collapses to `fetch_failed`.                                                                                                               | 2026-06-22   |

> **LinkedIn salary note:** the guest job API exposes `.compensation__salary` only for postings subject to US pay-transparency law (CA/NY/CO/WA). Most real captures — including the `happy.html` above — have no salary. `salary-synthetic.html` exists solely to keep the salary-extraction path under test; replace it with a real salaried capture if one becomes available.

### JustJoin.it

| File                  | Type                      | Source URL                                                                                                                                                                                                                                                                                        | Capture date |
| --------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `happy.html`          | Real                      | `https://justjoin.it/job-offer/clurgo-senior-full-stack-engineer-node-js-angular-react--poland-remote--javascript` — "Senior Full Stack Engineer (Node.js + Angular/React)" at Clurgo, Poland (Remote). All 5 fields present: salary in 5 currencies (EUR/CHF/USD/GBP/PLN), work_mode=Zdalna.     | 2026-06-18   |
| `missing-salary.html` | Real                      | `https://justjoin.it/job-offer/from-poland-with-dev-business-development-lead-research-intern-sharetheboard-bielsko-biala-ai` — "Business Development & Lead Research Intern \| ShareTheBoard" at From Poland With Dev. Internship with `from: null` for all employment types → salary undefined. | 2026-06-18   |
| `corrupted.html`      | Derived from `happy.html` | All occurrences of `workplaceType` replaced with `_workplaceTypeX`. `extractOfferObject` cannot locate its marker and throws "offer marker not found" → `fetch_failed`.                                                                                                                           | 2026-06-18   |

## Oracle integrity

Oracle values in the test files (position, company, salary, work_mode, description fragments) were
derived from the fixture HTML content directly — **not** by running the parser and freezing its
output. For real fixtures, values were also cross-checked against the live page at capture time.

When re-capturing a fixture (e.g. after a portal HTML change), open the live source URL in a
browser and re-read the visible page before updating the oracle assertions.
