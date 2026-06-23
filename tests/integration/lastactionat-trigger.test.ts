import { describe, it, expect, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { seedApplication } from "../helpers/seed";

// Risk #3 — prove the four `last_action_at` trigger invariants hold at the SQL row
// level against the fully-migrated local stack. Canonical column values are read
// through the admin client (RLS-bypassing); mutations go through the owning user
// client so the triggers fire under the same path the app uses.
describe("applications last_action_at trigger invariants", () => {
  const admin = createAdminClient();
  let user: Awaited<ReturnType<typeof provisionUser>>;

  afterEach(async () => {
    await cleanupUser(admin, user.userId);
  });

  it("INSERT sets last_action_at exactly equal to created_at", async () => {
    user = await provisionUser(admin);
    const row = await seedApplication(user.client, user.userId);

    // Both columns default now(), which is transaction-stable → byte-equal on a single INSERT.
    expect(row.last_action_at).toBe(row.created_at);
  });

  it("status UPDATE advances last_action_at past created_at", async () => {
    user = await provisionUser(admin);
    const row = await seedApplication(user.client, user.userId, { status: "Interesujące" });

    const { error: updateError } = await user.client
      .from("applications")
      .update({ status: "Zaaplikowano" })
      .eq("id", row.id);
    if (updateError) throw new Error(`status update failed — ${updateError.message}`);

    const after = await readActionTimes(row.id);
    expect(new Date(after.last_action_at) > new Date(row.created_at)).toBe(true);
  });

  it("non-status UPDATE leaves last_action_at unchanged", async () => {
    user = await provisionUser(admin);
    const row = await seedApplication(user.client, user.userId);

    // Editing a non-status column: the trigger's WHEN (old.status IS DISTINCT FROM NEW.status)
    // guard means it never fires, so last_action_at must stay byte-equal.
    const { error: updateError } = await user.client
      .from("applications")
      .update({ source: "edited-non-status" })
      .eq("id", row.id);
    if (updateError) throw new Error(`source update failed — ${updateError.message}`);

    const after = await readActionTimes(row.id);
    expect(after.last_action_at).toBe(row.last_action_at);
  });

  it("application_notes INSERT advances the parent's last_action_at", async () => {
    user = await provisionUser(admin);
    const row = await seedApplication(user.client, user.userId);

    const { error: noteError } = await user.client
      .from("application_notes")
      .insert({ application_id: row.id, user_id: user.userId, body: "first note" });
    if (noteError) throw new Error(`note insert failed — ${noteError.message}`);

    const after = await readActionTimes(row.id);
    expect(new Date(after.last_action_at) > new Date(row.last_action_at)).toBe(true);
  });
});

async function readActionTimes(id: string): Promise<{ created_at: string; last_action_at: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("applications").select("created_at,last_action_at").eq("id", id).single();
  if (error) throw new Error(`canonical read failed — ${error.message}`);
  return data;
}
