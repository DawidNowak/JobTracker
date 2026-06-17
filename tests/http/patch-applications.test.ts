import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";

describe("PATCH /api/applications/[id]", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;
  let cookiesB: string;
  let appAId: string;
  let appACreatedAt: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    [cookiesA, cookiesB] = await Promise.all([
      signInAndCaptureCookies(userA.email, userA.password),
      signInAndCaptureCookies(userB.email, userB.password),
    ]);

    const { data, error } = await userA.client
      .from("applications")
      .insert({ source: "test-http-smoke", user_id: userA.userId, status: "Zaaplikowano" })
      .select("id, created_at")
      .single();

    if (error) throw new Error(`Setup: failed to insert application — ${error.message}`);
    appAId = data.id;
    appACreatedAt = data.created_at;
  });

  afterEach(async () => {
    await Promise.all([cleanupUser(admin, userA.userId), cleanupUser(admin, userB.userId)]);
  });

  it("returns 401 without a cookie", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${appAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Rozmowa" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns exactly 404 when a non-owner patches", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${appAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiesB },
      body: JSON.stringify({ status: "Rozmowa" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 and updates status when the owner patches; last_action_at advances", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${appAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
      body: JSON.stringify({ status: "Rozmowa" }),
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { application: { status: string } };
    expect(json.application.status).toBe("Rozmowa");

    // PostgREST follow-up: confirm the DB row reflects the update and the trigger advanced last_action_at
    const { data, error: fetchError } = await userA.client
      .from("applications")
      .select("status, last_action_at")
      .eq("id", appAId)
      .single();
    if (fetchError) throw fetchError;
    expect(data.status).toBe("Rozmowa");
    expect(new Date(data.last_action_at) >= new Date(appACreatedAt)).toBe(true);
  });
});
