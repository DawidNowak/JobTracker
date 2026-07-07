import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

describe("application_notes F-01 regression — cross-user write attack", () => {
  const admin = createAdminClient();
  let userA: { userId: string; client: SupabaseClient<Database> };
  let userB: { userId: string; client: SupabaseClient<Database> };
  let appAId: string;

  beforeEach(async () => {
    userA = await provisionUser(admin);
    userB = await provisionUser(admin);

    const { data, error } = await userA.client
      .from("applications")
      .insert({ source: "test", user_id: userA.userId })
      .select()
      .single();

    if (error) throw new Error(`Setup: app insert failed — ${error.message}`);
    appAId = data.id;
  });

  afterEach(async () => {
    await cleanupUser(admin, userA.userId);
    await cleanupUser(admin, userB.userId);
  });

  it("userB cannot insert a note pointing at userA's application (hardened INSERT WITH CHECK)", async () => {
    // F-01 attack: B sets user_id to their own UID but application_id to A's app.
    // The hardened policy's EXISTS clause rejects this because A's app is not owned by B.
    const { data, error } = await userB.client
      .from("application_notes")
      .insert({ application_id: appAId, user_id: userB.userId, body: "hostile" })
      .select()
      .single();

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    if (error) {
      expect(error.code).toBe("42501");
    }

    // Defence-in-depth: verify the row didn't sneak in
    const { data: notes } = await userA.client.from("application_notes").select("*").eq("application_id", appAId);
    expect(notes).toEqual([]);
  });
});

describe("application_notes S-06 RLS — non-owner GET/PATCH/DELETE attack", () => {
  const admin = createAdminClient();
  let userA: { userId: string; client: SupabaseClient<Database> };
  let userB: { userId: string; client: SupabaseClient<Database> };
  let appAId: string;
  let noteAId: string;

  beforeEach(async () => {
    userA = await provisionUser(admin);
    userB = await provisionUser(admin);

    const { data: app, error: appErr } = await userA.client
      .from("applications")
      .insert({ source: "test", user_id: userA.userId })
      .select()
      .single();
    if (appErr) throw new Error(`Setup: app insert failed — ${appErr.message}`);
    appAId = app.id;

    const { data: note, error: noteErr } = await userA.client
      .from("application_notes")
      .insert({ application_id: appAId, user_id: userA.userId, body: "owner note" })
      .select()
      .single();
    if (noteErr) throw new Error(`Setup: note insert failed — ${noteErr.message}`);
    noteAId = note.id;
  });

  afterEach(async () => {
    await cleanupUser(admin, userA.userId);
    await cleanupUser(admin, userB.userId);
  });

  it("userB cannot SELECT userA's notes (RLS SELECT policy)", async () => {
    const { data, error } = await userB.client.from("application_notes").select("*").eq("application_id", appAId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("userB cannot UPDATE userA's note body (RLS UPDATE policy)", async () => {
    const { data, error } = await userB.client
      .from("application_notes")
      .update({ body: "hostile edit" })
      .eq("id", noteAId)
      .select()
      .maybeSingle();

    // RLS returns no rows — null data, no error (PostgREST hides the row)
    expect(data).toBeNull();

    // Verify the row is unchanged
    const { data: original } = await userA.client.from("application_notes").select("body").eq("id", noteAId).single();
    expect(original?.body).toBe("owner note");

    // Suppress unused-variable warning from the error check above
    void error;
  });

  it("userB cannot DELETE userA's note (RLS DELETE policy)", async () => {
    await userB.client.from("application_notes").delete().eq("id", noteAId);

    // Row must still exist for userA
    const { data } = await userA.client.from("application_notes").select("id").eq("id", noteAId).maybeSingle();
    expect(data).not.toBeNull();
  });
});
