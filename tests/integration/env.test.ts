import { describe, it, expect } from "vitest";

describe("test environment", () => {
  it("loads .env.test and points at local Supabase", () => {
    expect(process.env.SUPABASE_URL).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):54321/);
    expect(process.env.SUPABASE_KEY).toBeTruthy();
    expect(process.env.SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  });
});
