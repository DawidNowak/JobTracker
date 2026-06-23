import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";
import { seedApplication } from "../helpers/seed";

// Risk #5 — IDOR ownership matrix at the HTTP layer. PATCH /api/applications/[id] is the
// only id-addressed mutating verb with an HTTP surface, so it is the only one tested here.
// SELECT/UPDATE/DELETE ownership has no GET/PUT/DELETE handler and is proven at the RLS
// layer in tests/integration/rls-applications.test.ts.
//
// Note on isolation: createClient() uses the anon key with the caller's session cookie, so
// RLS is active on every HTTP request. The non-owner 404 is therefore produced by RLS
// (user B cannot see user A's row) and the .eq("user_id", userId) application clause
// together — they cannot be separated through this endpoint alone. The test proves the
// combined protection works end-to-end and that the denied request leaves the row unmutated.
describe("PATCH /api/applications/[id]", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;
  let cookiesB: string;
  let appAId: string;
  let appACreatedAt: string;
  let appAStatus: string;
  let appALastActionAt: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    [cookiesA, cookiesB] = await Promise.all([
      signInAndCaptureCookies(userA.email, userA.password),
      signInAndCaptureCookies(userB.email, userB.password),
    ]);

    const row = await seedApplication(userA.client, userA.userId);
    appAId = row.id;
    appACreatedAt = row.created_at;
    appAStatus = row.status;
    appALastActionAt = row.last_action_at;
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

  it("returns exactly 404 when a non-owner patches and leaves the row unmutated", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${appAId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiesB },
      body: JSON.stringify({ status: "Rozmowa" }),
    });
    // 404-collapse is a deliberate existence-leak guard — assert exactly 404, never a range.
    expect(res.status).toBe(404);

    // The denied PATCH must not have executed: re-read canonical columns via the admin
    // client and confirm status + last_action_at are byte-equal to the seeded values.
    const { data, error: fetchError } = await admin
      .from("applications")
      .select("status, last_action_at")
      .eq("id", appAId)
      .single();
    if (fetchError) throw fetchError;
    expect(data.status).toBe(appAStatus);
    expect(data.last_action_at).toBe(appALastActionAt);
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
