import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";

const PARSE_URL = () => `${process.env.TEST_BASE_URL}/api/applications/parse`;

describe("POST /api/applications/parse", () => {
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
    const res = await fetch(PARSE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "https://www.linkedin.com/jobs/view/123456789/" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-JSON body", async () => {
    const res = await fetch(PARSE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: "not-json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 422 for an empty source (Zod min-1 fail)", async () => {
    const res = await fetch(PARSE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ source: "" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 422 when source field is missing (Zod required fail)", async () => {
    const res = await fetch(PARSE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it("returns unsupported for a non-portal URL — structurally proves no outbound fetch", async () => {
    const res = await fetch(PARSE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ source: "https://example.com/jobs/view/123456789/" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string; message: string };
    expect(json.status).toBe("unsupported");
    expect(typeof json.message).toBe("string");
  });

  it("returns unsupported for evil.linkedin.com (F3 regression guard)", async () => {
    const res = await fetch(PARSE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ source: "https://evil.linkedin.com/jobs/view/123456789/" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("unsupported");
  });

  it("returns unsupported for javascript: URL", async () => {
    const res = await fetch(PARSE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ source: "javascript:alert(1)" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe("unsupported");
  });

  it("returns ok/partial/fetch_failed for a valid LinkedIn URL (recognize() accepted, parser dispatched)", async () => {
    const res = await fetch(PARSE_URL(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      body: JSON.stringify({ source: "https://www.linkedin.com/jobs/view/1234567890/" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(["ok", "partial", "fetch_failed"]).toContain(json.status);
  });
}, 60_000);
