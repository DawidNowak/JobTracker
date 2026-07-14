import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { E2E_BASE_URL } from "./tests/e2e/config";

config({ path: ".env.test" });

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  // 0, deliberately: hydration is gated deterministically (see tests/helpers/hydration.ts's
  // waitForBoardHydration, called after every page.goto("/dashboard")) rather than papered over
  // with a retry, and no spec retries a click behind a mutating/optimistic UI update anymore
  // (see decision-prompt.spec.ts's Aplikuj test). A real flake should fail loudly, not be
  // silently absorbed — do not re-add retries here to "fix" flakiness without root-causing it.
  retries: 0,
  reporter: "list",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
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
