import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createUserClient } from "./supabase-clients";

const TEST_PASSWORD = "test-password-123";

export async function provisionUser(admin: SupabaseClient<Database>): Promise<{
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient<Database>;
}> {
  const email = `u-${crypto.randomUUID()}@test.local`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  if (error ?? !data.user) {
    throw new Error(`Failed to create test user: ${error?.message ?? "unknown error"}`);
  }

  const client = createUserClient();
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });

  if (signInError) {
    throw new Error(`Failed to sign in test user: ${signInError.message}`);
  }

  return { userId: data.user.id, email, password: TEST_PASSWORD, client };
}

export async function cleanupUser(admin: SupabaseClient<Database>, userId: string): Promise<void> {
  await admin.auth.admin.deleteUser(userId);
}
