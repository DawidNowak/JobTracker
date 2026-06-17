import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";

const validBody = { source: "test-http-smoke" };

describe("POST /api/applications", () => {
  const admin = createAdminClient();
  let user: Awaited<ReturnType<typeof provisionUser>>;
  let cookieHeader: string;

  beforeEach(async () => {
    user = await provisionUser(admin);
    cookieHeader = await signInAndCaptureCookies(user.email, user.password);
  });

  afterEach(async () => {
    await cleanupUser(admin, user.userId);
  });

  it("returns 401 without a cookie", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(401);
  });

  it("returns 201 with a valid cookie and the row is visible via PostgREST", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/api/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify(validBody),
    });
    expect(res.status).toBe(201);

    const json = (await res.json()) as { application: { id: string } };
    expect(json.application.id).toBeTruthy();

    const { data } = await user.client.from("applications").select("id").eq("id", json.application.id);
    expect(data).toHaveLength(1);
  });
});
