import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function createAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createUserClient(): SupabaseClient<Database> {
  return createClient<Database>(env("SUPABASE_URL"), env("SUPABASE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
