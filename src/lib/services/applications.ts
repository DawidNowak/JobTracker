import type { createClient } from "@/lib/supabase";
import type { ApplicationCreate, ApplicationStatus, ApplicationUpdate } from "@/lib/validation/applications";
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

export async function updateApplicationStatus(
  supabase: Client,
  id: string,
  status: ApplicationStatus,
  userId: string,
): Promise<ApplicationRow | null> {
  const { data, error } = await supabase
    .from("applications")
    .update({ status })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

export async function updateApplication(
  supabase: Client,
  id: string,
  input: ApplicationUpdate,
  userId: string,
): Promise<ApplicationRow | null> {
  const { data, error } = await supabase
    .from("applications")
    .update(input)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

export async function deleteApplication(supabase: Client, id: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("applications")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data !== null;
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
