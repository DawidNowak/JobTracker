import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { E2E_BASE_URL } from "./tests/e2e/config";

config({ path: ".env.test" });

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  // 1: specs race a `client:load` island's first response against a shared dev server under
  // parallel workers (see e.g. decision-prompt.spec.ts's Aplikuj click) — a single retry absorbs
  // a slow-but-successful request without masking a genuine assertion failure.
  retries: 1,
  reporter: "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "tsx scripts/e2e-webserver.ts",
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    // 120s: astro dev's first cold compile on Windows can exceed 60s — mirrors tests/global-setup.ts.
    timeout: 120_000,
  },
});
