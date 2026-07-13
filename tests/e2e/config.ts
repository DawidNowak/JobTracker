// Single source of truth for the fixed E2E port, baseURL, and .dev.vars backup path.
// Shared by playwright.config.ts, scripts/e2e-webserver.ts, and tests/e2e/global-teardown.ts
// so all three agree without duplicating literals.
export const E2E_PORT = 4331;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
export const DEV_VARS_BACKUP = ".dev.vars.e2e-backup";
