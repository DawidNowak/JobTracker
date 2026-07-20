import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

describe("applications RLS — cross-user isolation", () => {
  const admin = createAdminClient();
  let userA: { userId: string; client: SupabaseClient<Database> };
  let userB: { userId: string; client: SupabaseClient<Database> };
  let rowAId: string;

  beforeEach(async () => {
    userA = await provisionUser(admin);
    userB = await provisionUser(admin);

    const { data, error } = await userA.client
      .from("applications")
      .insert({ source: "test", status: "Zaaplikowano", user_id: userA.userId })
      .select()
      .single();

    if (error) throw new Error(`Setup: insert failed — ${error.message}`);
    rowAId = data.id;
  });

  afterEach(async () => {
    await cleanupUser(admin, userA.userId);
    await cleanupUser(admin, userB.userId);
  });

  it("userB cannot SELECT userA's application", async () => {
    const { data, error } = await userB.client.from("applications").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("userB cannot UPDATE userA's application", async () => {
    const { data, error } = await userB.client
      .from("applications")
      .update({ status: "Rozmowa" })
      .eq("id", rowAId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("userB cannot DELETE userA's application", async () => {
    const { data, error } = await userB.client.from("applications").delete().eq("id", rowAId).select();
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("owner can set archived_at, and the archived row drops out of the active-board filter", async () => {
    const { data, error } = await userA.client
      .from("applications")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", rowAId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].archived_at).not.toBeNull();

    const { data: active, error: activeError } = await userA.client
      .from("applications")
      .select("id")
      .is("archived_at", null);
    expect(activeError).toBeNull();
    expect(active).toEqual([]);
  });

  it("userB cannot UPDATE archived_at on userA's application", async () => {
    const { data, error } = await userB.client
      .from("applications")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", rowAId)
      .select();
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: row, error: fetchError } = await admin
      .from("applications")
      .select("archived_at")
      .eq("id", rowAId)
      .single();
    if (fetchError) throw fetchError;
    expect(row.archived_at).toBeNull();
  });

  it("owner sees own archived rows via the archived-list query; other users' rows and active rows are excluded", async () => {
    const { error: archiveError } = await userA.client
      .from("applications")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", rowAId);
    if (archiveError) throw archiveError;

    const { data: activeRow, error: insertError } = await userA.client
      .from("applications")
      .insert({ source: "test-active", status: "Zaaplikowano", user_id: userA.userId })
      .select()
      .single();
    if (insertError) throw insertError;

    const { data: userBArchived, error: userBInsertError } = await userB.client
      .from("applications")
      .insert({ source: "test-b", status: "Zaaplikowano", user_id: userB.userId })
      .select()
      .single();
    if (userBInsertError) throw userBInsertError;
    const { error: userBArchiveError } = await userB.client
      .from("applications")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", userBArchived.id);
    if (userBArchiveError) throw userBArchiveError;

    const { data: archivedForA, error: archivedError } = await userA.client
      .from("applications")
      .select("*")
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });
    expect(archivedError).toBeNull();
    expect(archivedForA?.map((row) => row.id)).toEqual([rowAId]);
    expect(archivedForA?.some((row) => row.id === activeRow.id)).toBe(false);
    expect(archivedForA?.some((row) => row.id === userBArchived.id)).toBe(false);
  });
});
