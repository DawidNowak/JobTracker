import { config } from "dotenv";
import { createAdminClient } from "../tests/helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../tests/helpers/users";
import { signInAndCaptureCookies } from "../tests/helpers/cookies";
import { seedApplication } from "../tests/helpers/seed";

config({ path: ".env.test" });

const ALLOWED_PREFIXES = ["http://127.0.0.1:54321", "http://localhost:54321"] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing or empty env var "${name}" in .env.test`);
  return value;
}

const supabaseUrl = requireEnv("SUPABASE_URL");

if (!ALLOWED_PREFIXES.some((prefix) => supabaseUrl.startsWith(prefix))) {
  throw new Error(
    `SUPABASE_URL must point at the local Supabase stack (http://127.0.0.1:54321 or http://localhost:54321). Refusing to run against: ${supabaseUrl}`,
  );
}

requireEnv("SUPABASE_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const args = process.argv.slice(2);

async function main() {
  const admin = createAdminClient();

  if (args[0] === "--cleanup") {
    const userId = args[1];
    if (!userId) throw new Error("--cleanup requires a userId argument");
    try {
      await cleanupUser(admin, userId);
      console.log(`Cleaned up user: ${userId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Treat "User not found" as a no-op so re-running is safe
      if (message.includes("User not found")) {
        console.log(`User not found (already cleaned up): ${userId}`);
      } else {
        throw err;
      }
    }
    return;
  }

  const { userId, email, password } = await provisionUser(admin);
  const cookieString = await signInAndCaptureCookies(email, password);

  if (args[0] === "--seed") {
    const n = parseInt(args[1] ?? "1", 10);
    if (isNaN(n) || n < 1) throw new Error("--seed requires a positive integer");
    for (let i = 0; i < n; i++) {
      await seedApplication(admin, userId, { source: `e2e-seed-${i + 1}` });
    }
    console.log(`Seeded ${n} application(s) for user ${userId}`);
  }

  console.log("\n=== E2E Session ===");
  console.log(`userId:   ${userId}`);
  console.log(`email:    ${email}`);
  console.log(`password: ${password}`);
  console.log(`\nCookie header (for HTTP requests):\n  Cookie: ${cookieString}`);
  console.log(`\nCleanup command:\n  npm run e2e:session -- --cleanup ${userId}`);
  console.log("==================\n");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
