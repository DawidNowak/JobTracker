import { describe, it, expect } from "vitest";
import {
  listActiveApplications,
  createApplication,
  deleteApplication,
  updateApplicationStatus,
  updateApplication,
} from "@/lib/services/applications";

// Minimal chainable Supabase query builder. Every method returns the same chain
// object so any builder sequence is supported. The chain is also thenable so
// that functions which `await` the builder directly (e.g. listActiveApplications)
// receive the configured response without needing a terminal `.single()` call.
function makeClient(response: { data: unknown; error: Record<string, unknown> | null }) {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "update", "insert", "delete", "is", "eq", "order"]) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve(response);
  chain.single = () => Promise.resolve(response);
  chain.then = (resolve: (v: typeof response) => unknown, reject: (r: unknown) => unknown) =>
    Promise.resolve(response).then(resolve, reject);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return chain as any;
}

const DB_ERROR = { message: "connection error", details: "", hint: "", code: "PGRST001" };

describe("listActiveApplications", () => {
  it("returns an empty array when no applications exist", async () => {
    expect(await listActiveApplications(makeClient({ data: [], error: null }))).toEqual([]);
  });

  it("returns the rows provided by the database", async () => {
    const rows = [{ id: "1", source: "test", status: "Zaaplikowano", archived_at: null }];
    expect(await listActiveApplications(makeClient({ data: rows, error: null }))).toEqual(rows);
  });

  it("throws the database error instead of silently returning empty (NFR: no silent data loss)", async () => {
    await expect(listActiveApplications(makeClient({ data: null, error: DB_ERROR }))).rejects.toEqual(DB_ERROR);
  });
});

describe("createApplication", () => {
  it("returns the created application row", async () => {
    const row = { id: "new-id", source: "https://example.com", status: "Interesujące", user_id: "u1" };
    const result = await createApplication(
      makeClient({ data: row, error: null }),
      { source: "https://example.com", status: "Interesujące" },
      "u1",
    );
    expect(result).toEqual(row);
  });

  it("throws when the database returns an error", async () => {
    await expect(
      createApplication(makeClient({ data: null, error: DB_ERROR }), { source: "x", status: "Interesujące" }, "u1"),
    ).rejects.toEqual(DB_ERROR);
  });
});

describe("deleteApplication", () => {
  it("returns false when no row was deleted — application not found or caller is not the owner", async () => {
    expect(await deleteApplication(makeClient({ data: null, error: null }), "app-1", "wrong-user")).toBe(false);
  });

  it("returns true when a row was successfully deleted", async () => {
    expect(await deleteApplication(makeClient({ data: { id: "app-1" }, error: null }), "app-1", "owner")).toBe(true);
  });

  it("throws when the database returns an error", async () => {
    await expect(deleteApplication(makeClient({ data: null, error: DB_ERROR }), "app-1", "u1")).rejects.toEqual(DB_ERROR);
  });
});

describe("updateApplicationStatus", () => {
  it("returns null when no row matched — application not owned by caller", async () => {
    expect(
      await updateApplicationStatus(makeClient({ data: null, error: null }), "app-1", "Rozmowa", "wrong-user"),
    ).toBeNull();
  });

  it("returns the updated row on success", async () => {
    const row = { id: "app-1", status: "Rozmowa" };
    expect(await updateApplicationStatus(makeClient({ data: row, error: null }), "app-1", "Rozmowa", "owner")).toEqual(row);
  });

  it("throws when the database returns an error", async () => {
    await expect(
      updateApplicationStatus(makeClient({ data: null, error: DB_ERROR }), "app-1", "Rozmowa", "u1"),
    ).rejects.toEqual(DB_ERROR);
  });
});

describe("updateApplication", () => {
  it("returns null when no row matched — application not owned by caller", async () => {
    expect(await updateApplication(makeClient({ data: null, error: null }), "app-1", { source: "new" }, "wrong-user")).toBeNull();
  });

  it("returns the updated row on success", async () => {
    const row = { id: "app-1", source: "new" };
    expect(await updateApplication(makeClient({ data: row, error: null }), "app-1", { source: "new" }, "owner")).toEqual(row);
  });

  it("throws when the database returns an error", async () => {
    await expect(
      updateApplication(makeClient({ data: null, error: DB_ERROR }), "app-1", { source: "new" }, "u1"),
    ).rejects.toEqual(DB_ERROR);
  });
});
