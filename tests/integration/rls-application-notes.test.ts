import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

describe("application_notes RLS — cross-user isolation", () => {
  const admin = createAdminClient();
  let userA: { userId: string; client: SupabaseClient<Database> };
  let userB: { userId: string; client: SupabaseClient<Database> };
  let noteAId: string;

  beforeEach(async () => {
    userA = await provisionUser(admin);
    userB = await provisionUser(admin);

    const { data: appData, error: appError } = await userA.client
      .from("applications")
      .insert({ source: "test", user_id: userA.userId })
      .select()
      .single();

    if (appError) throw new Error(`Setup: app insert failed — ${appError.message}`);

    const { data: noteData, error: noteError } = await userA.client
      .from("application_notes")
      .insert({ application_id: appData.id, user_id: userA.userId, body: "a-note" })
      .select()
      .single();

    if (noteError) throw new Error(`Setup: note insert failed — ${noteError.message}`);
    noteAId = noteData.id;
  });

  afterEach(async () => {
    await cleanupUser(admin, userA.userId);
    await cleanupUser(admin, userB.userId);
  });

  it("userB cannot SELECT userA's note", async () => {
    const { data, error } = await userB.client.from("application_notes").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("userB cannot UPDATE userA's note", async () => {
    const { data, error } = await userB.client
      .from("application_notes")
      .update({ body: "tampered" })
      .eq("id", noteAId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("userB cannot DELETE userA's note", async () => {
    const { data, error } = await userB.client.from("application_notes").delete().eq("id", noteAId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
