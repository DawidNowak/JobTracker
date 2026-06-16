import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient, createUserClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";

describe("RLS — unauthenticated client sees no rows", () => {
  const admin = createAdminClient();
  let userId: string;

  beforeEach(async () => {
    const user = await provisionUser(admin);
    userId = user.userId;

    const { data: appData, error: appError } = await user.client
      .from("applications")
      .insert({ source: "test", user_id: user.userId })
      .select()
      .single();

    if (appError) throw new Error(`Setup: app insert failed — ${appError.message}`);

    const { error: noteError } = await user.client
      .from("application_notes")
      .insert({ application_id: appData.id, user_id: user.userId, body: "a-note" });

    if (noteError) throw new Error(`Setup: note insert failed — ${noteError.message}`);
  });

  afterEach(async () => {
    await cleanupUser(admin, userId);
  });

  it("unauthenticated client sees zero applications", async () => {
    const anon = createUserClient();
    const { data, error } = await anon.from("applications").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("unauthenticated client sees zero application_notes", async () => {
    const anon = createUserClient();
    const { data, error } = await anon.from("application_notes").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
