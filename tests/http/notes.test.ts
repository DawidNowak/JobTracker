import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAdminClient } from "../helpers/supabase-clients";
import { provisionUser, cleanupUser } from "../helpers/users";
import { signInAndCaptureCookies } from "../helpers/cookies";
import { seedApplication } from "../helpers/seed";

const BASE = process.env.TEST_BASE_URL ?? "";

describe("GET /api/applications/[id]/notes", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;
  let cookiesB: string;
  let appId: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    [cookiesA, cookiesB] = await Promise.all([
      signInAndCaptureCookies(userA.email, userA.password),
      signInAndCaptureCookies(userB.email, userB.password),
    ]);
    const row = await seedApplication(userA.client, userA.userId);
    appId = row.id;
  });

  afterEach(async () => {
    await Promise.all([cleanupUser(admin, userA.userId), cleanupUser(admin, userB.userId)]);
  });

  it("returns 401 without a cookie", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes`);
    expect(res.status).toBe(401);
  });

  it("returns 400 on a bad UUID", async () => {
    const res = await fetch(`${BASE}/api/applications/not-a-uuid/notes`, {
      headers: { Cookie: cookiesA },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 with empty notes list for a new application", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes`, {
      headers: { Cookie: cookiesA },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { notes: unknown[] };
    expect(json.notes).toEqual([]);
  });

  it("non-owner gets empty list (RLS hides data)", async () => {
    // Seed a note as user A first
    await fetch(`${BASE}/api/applications/${appId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
      body: JSON.stringify({ body: "secret note" }),
    });

    const res = await fetch(`${BASE}/api/applications/${appId}/notes`, {
      headers: { Cookie: cookiesB },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { notes: unknown[] };
    expect(json.notes).toEqual([]);
  });
});

describe("POST /api/applications/[id]/notes", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;
  let appId: string;
  let appLastActionAt: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    cookiesA = await signInAndCaptureCookies(userA.email, userA.password);
    const row = await seedApplication(userA.client, userA.userId);
    appId = row.id;
    appLastActionAt = row.last_action_at;
  });

  afterEach(async () => {
    await Promise.all([cleanupUser(admin, userA.userId), cleanupUser(admin, userB.userId)]);
  });

  it("returns 401 without a cookie", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 on a bad UUID", async () => {
    const res = await fetch(`${BASE}/api/applications/not-a-uuid/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
      body: JSON.stringify({ body: "hello" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 422 on empty body", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
      body: JSON.stringify({ body: "" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 201 and advances last_action_at on successful create", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
      body: JSON.stringify({ body: "my note" }),
    });
    expect(res.status).toBe(201);

    const json = (await res.json()) as { note: { id: string; body: string; application_id: string } };
    expect(json.note.body).toBe("my note");
    expect(json.note.application_id).toBe(appId);

    // Insert trigger must have bumped last_action_at
    const { data, error } = await userA.client.from("applications").select("last_action_at").eq("id", appId).single();
    if (error) throw error;
    expect(new Date(data.last_action_at) > new Date(appLastActionAt)).toBe(true);
  });

  it("returns 404 when posting to another user's application", async () => {
    const cookiesB = await signInAndCaptureCookies(userB.email, userB.password);
    const res = await fetch(`${BASE}/api/applications/${appId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookiesB },
      body: JSON.stringify({ body: "hostile note" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/applications/[id]/notes/[noteId]", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;
  let cookiesB: string;
  let appId: string;
  let noteId: string;
  let appLastActionAtAfterInsert: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    [cookiesA, cookiesB] = await Promise.all([
      signInAndCaptureCookies(userA.email, userA.password),
      signInAndCaptureCookies(userB.email, userB.password),
    ]);
    const row = await seedApplication(userA.client, userA.userId);
    appId = row.id;

    // Seed a note directly via Supabase client
    const { data: note, error } = await userA.client
      .from("application_notes")
      .insert({ application_id: appId, user_id: userA.userId, body: "original" })
      .select()
      .single();
    if (error) throw error;
    noteId = note.id;

    const { data: app, error: appErr } = await userA.client
      .from("applications")
      .select("last_action_at")
      .eq("id", appId)
      .single();
    if (appErr) throw appErr;
    appLastActionAtAfterInsert = app.last_action_at;
  });

  afterEach(async () => {
    await Promise.all([cleanupUser(admin, userA.userId), cleanupUser(admin, userB.userId)]);
  });

  it("returns 401 without a cookie", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "updated" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 on a bad noteId UUID", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/not-a-uuid`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
      body: JSON.stringify({ body: "updated" }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 422 on empty body", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
      body: JSON.stringify({ body: "" }),
    });
    expect(res.status).toBe(422);
  });

  it("returns 200 and does NOT advance last_action_at on successful edit", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
      body: JSON.stringify({ body: "updated body" }),
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { note: { id: string; body: string } };
    expect(json.note.body).toBe("updated body");

    const { data, error } = await userA.client.from("applications").select("last_action_at").eq("id", appId).single();
    if (error) throw error;
    expect(data.last_action_at).toBe(appLastActionAtAfterInsert);
  });

  it("returns 404 when a non-owner patches", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookiesB },
      body: JSON.stringify({ body: "hostile" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/applications/[id]/notes/[noteId]", () => {
  const admin = createAdminClient();
  let userA: Awaited<ReturnType<typeof provisionUser>>;
  let userB: Awaited<ReturnType<typeof provisionUser>>;
  let cookiesA: string;
  let cookiesB: string;
  let appId: string;
  let noteId: string;
  let appLastActionAtAfterInsert: string;

  beforeEach(async () => {
    [userA, userB] = await Promise.all([provisionUser(admin), provisionUser(admin)]);
    [cookiesA, cookiesB] = await Promise.all([
      signInAndCaptureCookies(userA.email, userA.password),
      signInAndCaptureCookies(userB.email, userB.password),
    ]);
    const row = await seedApplication(userA.client, userA.userId);
    appId = row.id;

    const { data: note, error } = await userA.client
      .from("application_notes")
      .insert({ application_id: appId, user_id: userA.userId, body: "to delete" })
      .select()
      .single();
    if (error) throw error;
    noteId = note.id;

    const { data: app, error: appErr } = await userA.client
      .from("applications")
      .select("last_action_at")
      .eq("id", appId)
      .single();
    if (appErr) throw appErr;
    appLastActionAtAfterInsert = app.last_action_at;
  });

  afterEach(async () => {
    await Promise.all([cleanupUser(admin, userA.userId), cleanupUser(admin, userB.userId)]);
  });

  it("returns 401 without a cookie", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("returns 400 on a bad noteId UUID", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/not-a-uuid`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 and does NOT advance last_action_at on successful delete", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(res.status).toBe(200);

    const json = (await res.json()) as { ok: boolean };
    expect(json.ok).toBe(true);

    const { data, error } = await userA.client.from("applications").select("last_action_at").eq("id", appId).single();
    if (error) throw error;
    expect(data.last_action_at).toBe(appLastActionAtAfterInsert);

    // Note should be gone
    const { data: notes } = await userA.client.from("application_notes").select("id").eq("id", noteId);
    expect(notes).toEqual([]);
  });

  it("returns 404 when a non-owner deletes", async () => {
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookiesB },
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when deleting an already-deleted note", async () => {
    // Delete once
    await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    // Delete again
    const res = await fetch(`${BASE}/api/applications/${appId}/notes/${noteId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Cookie: cookiesA },
    });
    expect(res.status).toBe(404);
  });
});
