import type { createClient } from "@/lib/supabase";
import type { ApplicationNoteRow } from "@/types";

type Client = NonNullable<ReturnType<typeof createClient>>;

export async function listNotes(
  supabase: Client,
  applicationId: string,
  userId: string,
): Promise<ApplicationNoteRow[]> {
  const { data, error } = await supabase
    .from("application_notes")
    .select("*")
    .eq("application_id", applicationId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }
  return data;
}

export async function createNote(
  supabase: Client,
  applicationId: string,
  body: string,
  userId: string,
): Promise<ApplicationNoteRow> {
  const { data, error } = await supabase
    .from("application_notes")
    .insert({ application_id: applicationId, user_id: userId, body })
    .select("*")
    .single();

  if (error) {
    throw error;
  }
  return data;
}

export async function updateNote(
  supabase: Client,
  noteId: string,
  body: string,
  userId: string,
): Promise<ApplicationNoteRow | null> {
  const { data, error } = await supabase
    .from("application_notes")
    .update({ body })
    .eq("id", noteId)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

export async function deleteNote(supabase: Client, noteId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("application_notes")
    .delete()
    .eq("id", noteId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data !== null;
}
