import { vi, describe, it, expect, beforeEach } from "vitest";

// `configStatuses` and `missingConfigs` are module-level constants evaluated at import time,
// so each test that needs different env values must reset the module cache and re-import.
describe("config-status", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function loadWith(url: string | undefined, key: string | undefined) {
    vi.doMock("astro:env/server", () => ({ SUPABASE_URL: url, SUPABASE_KEY: key }));
    return import("@/lib/config-status");
  }

  describe("configStatuses", () => {
    it("contains exactly one entry — Supabase is the only required infrastructure for MVP", async () => {
      const { configStatuses } = await loadWith("https://x.supabase.co", "key");
      expect(configStatuses).toHaveLength(1);
    });

    it('the Supabase entry name is "Supabase"', async () => {
      const { configStatuses } = await loadWith("https://x.supabase.co", "key");
      expect(configStatuses[0].name).toBe("Supabase");
    });

    it("is marked configured when both SUPABASE_URL and SUPABASE_KEY are set", async () => {
      const { configStatuses } = await loadWith("https://x.supabase.co", "anon-key");
      expect(configStatuses[0].configured).toBe(true);
    });

    it("is not configured when SUPABASE_URL is absent — auth features disabled (FR-001)", async () => {
      const { configStatuses } = await loadWith(undefined, "anon-key");
      expect(configStatuses[0].configured).toBe(false);
    });

    it("is not configured when SUPABASE_KEY is absent — both vars are required", async () => {
      // Also kills the LogicalOperator mutation (&&→||): with ||, a present URL would make
      // configured truthy even without the key.
      const { configStatuses } = await loadWith("https://x.supabase.co", undefined);
      expect(configStatuses[0].configured).toBe(false);
    });

    it("has a non-empty message to surface when auth is unavailable", async () => {
      const { configStatuses } = await loadWith(undefined, undefined);
      expect(configStatuses[0].message).toBeTruthy();
    });

    it("has a non-empty docsUrl pointing to setup instructions", async () => {
      const { configStatuses } = await loadWith(undefined, undefined);
      expect(configStatuses[0].docsUrl).toMatch(/^https:\/\//);
    });

    it("has a non-empty docsLabel for the documentation link text", async () => {
      const { configStatuses } = await loadWith(undefined, undefined);
      expect(configStatuses[0].docsLabel).toBeTruthy();
    });
  });

  describe("missingConfigs", () => {
    it("is empty when Supabase is fully configured — auth features enabled (FR-001)", async () => {
      const { missingConfigs } = await loadWith("https://x.supabase.co", "anon-key");
      expect(missingConfigs).toHaveLength(0);
    });

    it("contains the Supabase entry when SUPABASE_URL is missing", async () => {
      const { missingConfigs } = await loadWith(undefined, "anon-key");
      expect(missingConfigs).toHaveLength(1);
      expect(missingConfigs[0].name).toBe("Supabase");
    });

    it("contains the Supabase entry when SUPABASE_KEY is missing", async () => {
      const { missingConfigs } = await loadWith("https://x.supabase.co", undefined);
      expect(missingConfigs).toHaveLength(1);
    });

    it("contains the Supabase entry when both env vars are absent", async () => {
      const { missingConfigs } = await loadWith(undefined, undefined);
      expect(missingConfigs).toHaveLength(1);
    });
  });
});
