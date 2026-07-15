import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";
import { seedApplication } from "../helpers/seed";

// POST /api/applications/[id]/archive stamps archived_at on an owned, active,
// Zaaplikowano/Rozmowa row. This suite proves the full status matrix, including the
// existence-leak 404 convention and the state-keyed 422 copy (Interesujące vs already archived).
describe("POST /api/applications/[id]/archive", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;
  let cookiesB: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    [cookiesA, cookiesB] = await Promise.all([
      signInAndCaptureCookies(userA.email, userA.password),
      signInAndCaptureCookies(userB.email, userB.password),
    ]);
  });

  afterEach(async () => {
    await Promise.all([cleanupUser(admin, userA.userId), cleanupUser(admin, userB.userId)]);
  });

  it("returns 401 without a cookie", async () => {
    const row = await seedApplication(userA.client, userA.userId, { status: "Zaaplikowano" });
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${row.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("returns exactly 404 when a non-owner archives and leaves the row unmutated", async () => {
    const row = await seedApplication(userA.client, userA.userId, { status: "Zaaplikowano" });
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${row.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesB },
    });
    // 404-collapse is a deliberate existence-leak guard — assert exactly 404, never a range.
    expect(res.status).toBe(404);

    const { data, error } = await admin.from("applications").select("archived_at").eq("id", row.id).single();
    if (error) throw error;
    expect(data.archived_at).toBeNull();
  });

  it("returns 200 for the owner on a Zaaplikowano seed and sets archived_at", async () => {
    const row = await seedApplication(userA.client, userA.userId, { status: "Zaaplikowano" });
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${row.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { application: { archived_at: string | null } };
    expect(json.application.archived_at).not.toBeNull();

    const { data, error } = await admin.from("applications").select("archived_at").eq("id", row.id).single();
    if (error) throw error;
    expect(data.archived_at).not.toBeNull();
  });

  it("returns 200 for the owner on a Rozmowa seed and sets archived_at", async () => {
    const row = await seedApplication(userA.client, userA.userId, { status: "Rozmowa" });
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${row.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(res.status).toBe(200);

    const { data, error } = await admin.from("applications").select("archived_at").eq("id", row.id).single();
    if (error) throw error;
    expect(data.archived_at).not.toBeNull();
  });

  it("returns 422 for the owner on an Interesujące seed and leaves archived_at null", async () => {
    const row = await seedApplication(userA.client, userA.userId, { status: "Interesujące" });
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${row.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(res.status).toBe(422);

    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('Ofertę z kolumny „Interesujące" można tylko usunąć lub przenieść do „Zaaplikowano".');

    const { data, error } = await admin.from("applications").select("archived_at").eq("id", row.id).single();
    if (error) throw error;
    expect(data.archived_at).toBeNull();
  });

  it("returns 422 for the owner on an already-archived seed with the neutral copy", async () => {
    const pastTs = new Date(Date.now() - 60_000).toISOString();
    const row = await seedApplication(userA.client, userA.userId, {
      status: "Zaaplikowano",
      archived_at: pastTs,
    });
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${row.id}/archive`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(res.status).toBe(422);

    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("Aplikacja została już odrzucona.");

    const { data, error } = await admin.from("applications").select("archived_at").eq("id", row.id).single();
    if (error) throw error;
    expect(data.archived_at).not.toBeNull();
    expect(new Date(data.archived_at ?? "").getTime()).toBe(new Date(pastTs).getTime());
  });
});
