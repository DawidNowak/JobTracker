import { config } from "dotenv";

config({ path: ".env.test" });

const ALLOWED_PREFIXES = ["http://127.0.0.1:54321", "http://localhost:54321"] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing or empty env var "${name}" in .env.test`);
  return value;
}

const url = requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_KEY");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

if (!ALLOWED_PREFIXES.some((prefix) => url.startsWith(prefix))) {
  throw new Error(
    `SUPABASE_URL must point at the local Supabase stack (http://127.0.0.1:54321 or http://localhost:54321). Refusing to run tests against: ${url}`,
  );
}
