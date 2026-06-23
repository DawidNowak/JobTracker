import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type ApplicationRow = Database["public"]["Tables"]["applications"]["Row"];
type ApplicationInsert = Database["public"]["Tables"]["applications"]["Insert"];

// Seed one application via the passed client and return the inserted row (incl. id,
// created_at, last_action_at) for immediate assertion. userId is explicit so the
// helper works with either the admin client or an owning user client.
export async function seedApplication(
  client: SupabaseClient<Database>,
  userId: string,
  overrides?: Partial<ApplicationInsert>,
): Promise<ApplicationRow> {
  const { data, error } = await client
    .from("applications")
    .insert({ source: "test-seed", status: "Zaaplikowano", user_id: userId, ...overrides })
    .select()
    .single();

  if (error) throw new Error(`Setup: insert failed — ${error.message}`);
  return data;
}
