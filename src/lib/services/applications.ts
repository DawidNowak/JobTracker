import type { createClient } from "@/lib/supabase";
import type { ApplicationCreate } from "@/lib/validation/applications";
import type { ApplicationRow } from "@/types";

type Client = NonNullable<ReturnType<typeof createClient>>;

export async function listActiveApplications(supabase: Client): Promise<ApplicationRow[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }
  return data;
}

export async function createApplication(
  supabase: Client,
  input: ApplicationCreate,
  userId: string,
): Promise<ApplicationRow> {
  const { data, error } = await supabase
    .from("applications")
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) {
    throw error;
  }
  return data;
}
