import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Module mocks must be declared before the route import so that Vitest's hoist
// picks them up before [id].ts imports @/lib/supabase and @/lib/services/applications.
vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/services/applications", () => ({
  updateApplication: vi.fn(),
  deleteApplication: vi.fn(),
}));

import { PATCH, DELETE } from "@/pages/api/applications/[id]";
import { createClient } from "@/lib/supabase";
import { updateApplication, deleteApplication } from "@/lib/services/applications";

// A well-formed UUID that passes the route's uuidSchema guard.
const VALID_ID = "550e8400-e29b-41d4-a716-446655440000";
const MOCK_USER = { id: "user-1" };
// A truthy stand-in; the service functions are mocked so the client is never called.
const MOCK_SUPABASE = {} as NonNullable<ReturnType<typeof createClient>>;

interface ContextOverrides {
  user?: { id: string } | null;
  id?: string | undefined;
  body?: unknown;
  bodyThrows?: boolean;
}

function makeContext(overrides: ContextOverrides = {}): Parameters<typeof PATCH>[0] {
  const { user = MOCK_USER, id = VALID_ID, body = {}, bodyThrows = false } = overrides;
  const json = bodyThrows
    ? vi.fn().mockRejectedValue(new SyntaxError("Unexpected token"))
    : vi.fn().mockResolvedValue(body);
  return {
    locals: { user },
    params: { id },
    request: { json, headers: new Headers() },
    cookies: {},
  } as unknown as Parameters<typeof PATCH>[0];
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

describe("PATCH /api/applications/[id]", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(MOCK_SUPABASE);
    vi.mocked(updateApplication).mockResolvedValue(null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // P1 — auth guard
  it("returns 401 when the request carries no authenticated user", async () => {
    const res = await PATCH(makeContext({ user: null }));
    expect(res.status).toBe(401);
  });

  // P2 — UUID format guard
  it("returns 400 when the id param is not a valid UUID", async () => {
    const res = await PATCH(makeContext({ id: "not-a-uuid", body: { status: "Rozmowa" } }));
    expect(res.status).toBe(400);
  });

  // P3 — JSON parse guard
  it("returns 400 when the request body is not parseable JSON", async () => {
    const res = await PATCH(makeContext({ bodyThrows: true }));
    expect(res.status).toBe(400);
  });

  // P4 — empty-body schema guard (applicationUpdateSchema.refine: at least one field required)
  it("returns 422 when the body is an empty object — no fields to update", async () => {
    const res = await PATCH(makeContext({ body: {} }));
    expect(res.status).toBe(422);
    const json = (await res.json()) as { errors: unknown };
    expect(json.errors).toBeDefined();
  });

  // P5 — invalid status value (only active-column values allowed; FR-007, FR-008)
  it("returns 422 when status is not a valid active-column value", async () => {
    const res = await PATCH(makeContext({ body: { status: "Odrzucony" } }));
    expect(res.status).toBe(422);
  });

  // P6 — Supabase availability guard
  it("returns 500 when the Supabase client is not configured", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const res = await PATCH(makeContext({ body: { status: "Rozmowa" } }));
    expect(res.status).toBe(500);
  });

  // P7 — not-found / IDOR collapse
  it("returns 404 when the application is not found or not owned by the caller", async () => {
    vi.mocked(updateApplication).mockResolvedValue(null);
    const res = await PATCH(makeContext({ body: { status: "Rozmowa" } }));
    expect(res.status).toBe(404);
  });

  // P8 — success response shape (FR-005)
  it("returns 200 with the updated application in { application } on success", async () => {
    const row = { id: VALID_ID, status: "Rozmowa", source: "https://example.com" };
    vi.mocked(updateApplication).mockResolvedValue(row);
    const res = await PATCH(makeContext({ body: { status: "Rozmowa" } }));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { application: unknown };
    expect(json.application).toEqual(row);
  });

  // P9 — service-error boundary (NFR: no silent data loss)
  it("returns 500 when the service layer throws — explicit error, no silent failure", async () => {
    vi.mocked(updateApplication).mockRejectedValue(new Error("connection lost"));
    const res = await PATCH(makeContext({ body: { status: "Rozmowa" } }));
    expect(res.status).toBe(500);
  });
});

// ── DELETE ────────────────────────────────────────────────────────────────────

describe("DELETE /api/applications/[id]", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReturnValue(MOCK_SUPABASE);
    vi.mocked(deleteApplication).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // D1 — auth guard
  it("returns 401 when the request carries no authenticated user", async () => {
    const res = await DELETE(makeContext({ user: null }));
    expect(res.status).toBe(401);
  });

  // D2 — UUID format guard
  it("returns 400 when the id param is not a valid UUID", async () => {
    const res = await DELETE(makeContext({ id: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  // D3 — Supabase availability guard
  it("returns 500 when the Supabase client is not configured", async () => {
    vi.mocked(createClient).mockReturnValue(null);
    const res = await DELETE(makeContext());
    expect(res.status).toBe(500);
  });

  // D4 — not-found / IDOR collapse
  it("returns 404 when the application is not found or not owned by the caller", async () => {
    vi.mocked(deleteApplication).mockResolvedValue(false);
    const res = await DELETE(makeContext());
    expect(res.status).toBe(404);
  });

  // D5 — success response shape (FR-006)
  it("returns 200 with { ok: true } on successful deletion", async () => {
    vi.mocked(deleteApplication).mockResolvedValue(true);
    const res = await DELETE(makeContext());
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: unknown };
    expect(json.ok).toBe(true);
  });

  // D6 — service-error boundary (NFR: no silent data loss)
  it("returns 500 when the service layer throws — explicit error, no silent failure", async () => {
    vi.mocked(deleteApplication).mockRejectedValue(new Error("connection lost"));
    const res = await DELETE(makeContext());
    expect(res.status).toBe(500);
  });
});
