import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";
import { seedApplication } from "../helpers/seed";

// GET /archive and GET /archive/[id] are pure SSR pages gated by PROTECTED_ROUTES
// (redirect to /auth/signin when unauthenticated) and by getOwnedApplication's
// .eq("user_id", userId) filter (404 on any non-owned/non-archived/malformed id,
// same existence-leak convention as the archive mutation endpoint).
describe("GET /archive and /archive/[id]", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    cookiesA = await signInAndCaptureCookies(userA.email, userA.password);
  });

  afterEach(async () => {
    await Promise.all([cleanupUser(admin, userA.userId), cleanupUser(admin, userB.userId)]);
  });

  it("redirects an unauthenticated request to /auth/signin", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/archive`);
    expect(res.redirected).toBe(true);
    expect(res.url.endsWith("/auth/signin")).toBe(true);
  });

  it("redirects an unauthenticated detail request to /auth/signin", async () => {
    const row = await seedApplication(userA.client, userA.userId, {
      status: "Zaaplikowano",
      archived_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await fetch(`${process.env.TEST_BASE_URL}/archive/${row.id}`);
    expect(res.redirected).toBe(true);
    expect(res.url.endsWith("/auth/signin")).toBe(true);
  });

  it("returns 200 for the owner's own archived application", async () => {
    const row = await seedApplication(userA.client, userA.userId, {
      status: "Zaaplikowano",
      archived_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await fetch(`${process.env.TEST_BASE_URL}/archive/${row.id}`, {
      headers: { Cookie: cookiesA },
    });
    expect(res.status).toBe(200);
  });

  it("returns exactly 404 for another user's archived application", async () => {
    const row = await seedApplication(userB.client, userB.userId, {
      status: "Zaaplikowano",
      archived_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await fetch(`${process.env.TEST_BASE_URL}/archive/${row.id}`, {
      headers: { Cookie: cookiesA },
    });
    expect(res.status).toBe(404);
  });

  it("returns exactly 404 for the owner's own active (non-archived) application", async () => {
    const row = await seedApplication(userA.client, userA.userId, { status: "Zaaplikowano" });
    const res = await fetch(`${process.env.TEST_BASE_URL}/archive/${row.id}`, {
      headers: { Cookie: cookiesA },
    });
    expect(res.status).toBe(404);
  });

  it("returns exactly 404 for a random, non-existent UUID", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/archive/00000000-0000-0000-0000-000000000000`, {
      headers: { Cookie: cookiesA },
    });
    expect(res.status).toBe(404);
  });

  it("returns exactly 404 for a malformed id", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/archive/not-a-uuid`, {
      headers: { Cookie: cookiesA },
    });
    expect(res.status).toBe(404);
  });
});
