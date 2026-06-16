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
