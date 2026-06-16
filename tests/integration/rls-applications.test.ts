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
});
