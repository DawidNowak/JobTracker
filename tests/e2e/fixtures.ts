import { test as base, expect } from "@playwright/test";
import { config } from "dotenv";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { ApplicationRow } from "@/types";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";
import { seedApplication } from "../helpers/seed";
import { E2E_BASE_URL } from "./config";

// Loaded here (not just relied on via playwright.config.ts) because Playwright runs each
// test file in its own worker process — the config's dotenv side-effect doesn't reach it.
config({ path: ".env.test" });

type ApplicationInsert = Database["public"]["Tables"]["applications"]["Insert"];

interface Account {
  userId: string;
  email: string;
  password: string;
}

interface WorkerFixtures {
  admin: SupabaseClient<Database>;
}

interface TestFixtures {
  account: Account;
  seedApp: (overrides?: Partial<ApplicationInsert>) => Promise<ApplicationRow>;
}

// Tolerant of chunked auth cookies (e.g. sb-127-auth-token.0 / .1) — splits only on the first "=".
function parseCookieString(cookieString: string): { name: string; value: string; url: string }[] {
  return cookieString
    .split(";")
    .map((pair) => {
      const trimmed = pair.trim();
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) return null; // skip malformed/valueless pairs rather than mangle name/value
      return { name: trimmed.slice(0, eqIndex), value: trimmed.slice(eqIndex + 1), url: E2E_BASE_URL };
    })
    .filter((cookie): cookie is { name: string; value: string; url: string } => cookie !== null);
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  admin: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature requires the destructure
    async ({}, use) => {
      await use(createAdminClient());
    },
    { scope: "worker" },
  ],

  account: async ({ admin }, use) => {
    const { userId, email, password } = await provisionUser(admin);
    await use({ userId, email, password });
    // Deleting the auth user cascades (ON DELETE CASCADE) to every `applications` row it
    // owns, so rows seeded via `seedApp` never need explicit teardown of their own.
    await cleanupUser(admin, userId);
  },

  // Overrides the built-in `context` fixture: inject @supabase/ssr cookies via the same
  // createServerClient path the middleware reads, so every `page` is signed in without the UI.
  context: async ({ browser, account }, use) => {
    const cookieString = await signInAndCaptureCookies(account.email, account.password);
    const context = await browser.newContext();
    await context.addCookies(parseCookieString(cookieString));
    await use(context);
    await context.close();
  },

  seedApp: async ({ admin, account }, use) => {
    await use((overrides) => seedApplication(admin, account.userId, overrides));
  },
});

export { expect };
