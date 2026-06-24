import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";
import { seedApplication } from "../helpers/seed";

// DELETE /api/applications/[id] is a hard delete (no archive). These tests cover the owner
// happy path, the idempotent 404 on a second delete, and the IDOR guard: user B deleting
// user A's row must collapse to 404 (RLS hides the row) and leave A's row intact.
describe("DELETE /api/applications/[id]", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;
  let cookiesB: string;
  let appAId: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    [cookiesA, cookiesB] = await Promise.all([
      signInAndCaptureCookies(userA.email, userA.password),
      signInAndCaptureCookies(userB.email, userB.password),
    ]);

    const row = await seedApplication(userA.client, userA.userId);
    appAId = row.id;
  });

  afterEach(async () => {
    await Promise.all([cleanupUser(admin, userA.userId), cleanupUser(admin, userB.userId)]);
  });

  // A real browser DELETE carries a same-origin Origin header, which satisfies Astro's CSRF
  // guard. node fetch sends neither Origin nor content-type, which the guard treats as a
  // cross-site form submission (403) before routing — so set a non-form content-type to
  // mirror the browser and match the existing PATCH test convention.
  it("returns 401 without a cookie", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${appAId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("owner DELETE removes the row; a second DELETE returns 404", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${appAId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(res.status).toBe(200);

    // The row is gone for the owner.
    const { data } = await userA.client.from("applications").select("id").eq("id", appAId);
    expect(data).toEqual([]);

    // A second delete of the now-missing row is a clean 404.
    const second = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${appAId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(second.status).toBe(404);
  });

  it("returns exactly 404 when a non-owner deletes and leaves the row intact", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications/${appAId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookiesB },
    });
    // 404-collapse is a deliberate existence-leak guard — assert exactly 404, never a range.
    expect(res.status).toBe(404);

    // The denied DELETE must not have executed: the row still exists for its owner.
    const { data, error } = await admin.from("applications").select("id").eq("id", appAId).single();
    if (error) throw error;
    expect(data.id).toBe(appAId);
  });
});
