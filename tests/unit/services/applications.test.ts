import { describe, it, expect, vi } from "vitest";
import {
  listActiveApplications,
  createApplication,
  deleteApplication,
  updateApplicationStatus,
  updateApplication,
} from "@/lib/services/applications";

type Client = Parameters<typeof listActiveApplications>[0];

type SpyChain = {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
};

// Chainable Supabase query builder where every method is a vi.fn() spy that
// returns the same chain — allows asserting which methods were called with
// which arguments, which kills argument-mutation survivors in Stryker.
function makeClient(response: { data: unknown; error: Record<string, unknown> | null }): Client & SpyChain {
  const chain = {} as SpyChain & Record<string, unknown>;
  for (const m of ["from", "select", "update", "insert", "delete", "is", "eq", "order"] as const) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.maybeSingle = vi.fn().mockResolvedValue(response);
  chain.single = vi.fn().mockResolvedValue(response);
  // Make the chain itself thenable so `await supabase.from(...).select(...)...`
  // without a terminal .single()/.maybeSingle() works (used by listActiveApplications).
  (chain as Record<string, unknown>).then = (
    resolve: (v: typeof response) => unknown,
    reject: (r: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject);
  return chain as unknown as Client & SpyChain;
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

  it("filters only non-archived rows via IS NULL on archived_at", async () => {
    const client = makeClient({ data: [], error: null });
    await listActiveApplications(client);
    expect(client.from).toHaveBeenCalledWith("applications");
    expect(client.select).toHaveBeenCalledWith("*");
    expect(client.is).toHaveBeenCalledWith("archived_at", null);
  });

  it("orders results by created_at descending", async () => {
    const client = makeClient({ data: [], error: null });
    await listActiveApplications(client);
    expect(client.order).toHaveBeenCalledWith("created_at", { ascending: false });
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

  it("inserts input fields merged with user_id — neither must be dropped", async () => {
    const client = makeClient({ data: { id: "new-id" }, error: null });
    await createApplication(client, { source: "https://example.com", status: "Interesujące" }, "u1");
    expect(client.from).toHaveBeenCalledWith("applications");
    expect(client.select).toHaveBeenCalledWith("*");
    expect(client.insert).toHaveBeenCalledWith({
      source: "https://example.com",
      status: "Interesujące",
      user_id: "u1",
    });
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
    await expect(deleteApplication(makeClient({ data: null, error: DB_ERROR }), "app-1", "u1")).rejects.toEqual(
      DB_ERROR,
    );
  });

  it("scopes delete to the target row id", async () => {
    const client = makeClient({ data: { id: "app-1" }, error: null });
    await deleteApplication(client, "app-1", "owner");
    expect(client.from).toHaveBeenCalledWith("applications");
    expect(client.select).toHaveBeenCalledWith("id");
    expect(client.eq).toHaveBeenCalledWith("id", "app-1");
  });

  it("scopes delete to the owning user to prevent cross-user deletion", async () => {
    const client = makeClient({ data: { id: "app-1" }, error: null });
    await deleteApplication(client, "app-1", "owner");
    expect(client.eq).toHaveBeenCalledWith("user_id", "owner");
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
    expect(await updateApplicationStatus(makeClient({ data: row, error: null }), "app-1", "Rozmowa", "owner")).toEqual(
      row,
    );
  });

  it("throws when the database returns an error", async () => {
    await expect(
      updateApplicationStatus(makeClient({ data: null, error: DB_ERROR }), "app-1", "Rozmowa", "u1"),
    ).rejects.toEqual(DB_ERROR);
  });

  it("updates only the status field", async () => {
    const client = makeClient({ data: { id: "app-1", status: "Rozmowa" }, error: null });
    await updateApplicationStatus(client, "app-1", "Rozmowa", "owner");
    expect(client.from).toHaveBeenCalledWith("applications");
    expect(client.select).toHaveBeenCalledWith("*");
    expect(client.update).toHaveBeenCalledWith({ status: "Rozmowa" });
  });

  it("scopes update to the target row id", async () => {
    const client = makeClient({ data: { id: "app-1" }, error: null });
    await updateApplicationStatus(client, "app-1", "Rozmowa", "owner");
    expect(client.eq).toHaveBeenCalledWith("id", "app-1");
  });

  it("scopes update to the owning user to prevent cross-user modification", async () => {
    const client = makeClient({ data: { id: "app-1" }, error: null });
    await updateApplicationStatus(client, "app-1", "Rozmowa", "owner");
    expect(client.eq).toHaveBeenCalledWith("user_id", "owner");
  });
});

describe("updateApplication", () => {
  it("returns null when no row matched — application not owned by caller", async () => {
    expect(
      await updateApplication(makeClient({ data: null, error: null }), "app-1", { source: "new" }, "wrong-user"),
    ).toBeNull();
  });

  it("returns the updated row on success", async () => {
    const row = { id: "app-1", source: "new" };
    expect(
      await updateApplication(makeClient({ data: row, error: null }), "app-1", { source: "new" }, "owner"),
    ).toEqual(row);
  });

  it("throws when the database returns an error", async () => {
    await expect(
      updateApplication(makeClient({ data: null, error: DB_ERROR }), "app-1", { source: "new" }, "u1"),
    ).rejects.toEqual(DB_ERROR);
  });

  it("passes the full input payload to the update call", async () => {
    const client = makeClient({ data: { id: "app-1", source: "new" }, error: null });
    await updateApplication(client, "app-1", { source: "new" }, "owner");
    expect(client.from).toHaveBeenCalledWith("applications");
    expect(client.select).toHaveBeenCalledWith("*");
    expect(client.update).toHaveBeenCalledWith({ source: "new" });
  });

  it("scopes update to the target row id", async () => {
    const client = makeClient({ data: { id: "app-1" }, error: null });
    await updateApplication(client, "app-1", { source: "new" }, "owner");
    expect(client.eq).toHaveBeenCalledWith("id", "app-1");
  });

  it("scopes update to the owning user to prevent cross-user modification", async () => {
    const client = makeClient({ data: { id: "app-1" }, error: null });
    await updateApplication(client, "app-1", { source: "new" }, "owner");
    expect(client.eq).toHaveBeenCalledWith("user_id", "owner");
  });
});
