# E2E authoring rules

Playwright specs under `tests/e2e/` are a **local-only** suite (`npm run test:e2e`), not a CI gate — see `context/foundation/test-plan.md` §4/§7. They exist to cover genuinely browser-level risks: state that only exists in the rendered UI (drag/drop, dialogs, real navigation).

`board-load.spec.ts` is the reference exemplar — copy its shape for new specs.

## Rules

- **One test per file.** `describe` blocks and multi-`test()` files are not used here; each `*.spec.ts` is a single named risk.
- **Role-based locators.** Use `getByRole`, `getByText`, `getByLabel` — not CSS selectors or test IDs. If a role-based locator can't disambiguate (e.g. two elements with the same accessible name), scope by a containing element found via `getByRole("heading", ...)`, as `board-load.spec.ts` does for column scoping.
- **Auth without the UI.** Sign in via the `context` fixture (cookie injection from `signInAndCaptureCookies`), never by driving the `/auth/signin` form. The form itself is out of scope for this suite.
- **Per-test isolation.** Use the `account` fixture for a fresh ephemeral user (`u-<uuid>@test.local`) per test; never share users or rows across tests. Use `seedApp` to insert rows scoped to that user.
- **Unique data.** Give seeded rows a unique `company`/`source` marker per test run so assertions can't accidentally match another test's leftovers.
- **Wait for state, never `waitForTimeout`.** Use web-first assertions (`expect(locator).toBeVisible()`, `toHaveText()`, etc.) or explicit navigation waits (e.g. after a reload). Arbitrary sleeps are flaky and hide real timing bugs.
- **Risk-bound test names.** Name the test after the risk it proves, not the mechanics (e.g. `deletes a Zaaplikowano card from board and database`, not `click delete button`).
- **Polish UI copy.** All user-facing text/roles use the Polish strings actually rendered (e.g. "Zaaplikowano", "Usuń", "Brak aplikacji") — do not invent English equivalents.
- **Local stack only.** Never point specs or fixtures at a non-local `SUPABASE_URL`; the harness (`scripts/e2e-webserver.ts`) enforces this at the server level, but fixtures reuse the same helpers as the rest of the test suite and inherit the same guarantee.
- **No mocked internal boundaries.** Auth, routing, and the database stay real. If a scenario needs mocking to work, it belongs in Vitest, not here.

## Reference

- Exemplar: `tests/e2e/board-load.spec.ts`
- Fixtures: `tests/e2e/fixtures.ts` (extends Playwright's `test` with `admin`, `account`, `context`, `seedApp`)
- Harness internals: `playwright.config.ts`, `scripts/e2e-webserver.ts`, `tests/e2e/global-teardown.ts`
