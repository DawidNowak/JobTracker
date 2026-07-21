import { describe, it, expect } from "vitest";

// GET / is a pure SSR page: unauthenticated visitors see the landing (200),
// authenticated visitors are redirected to /dashboard (covered manually — see plan.md 1.9).
describe("GET /", () => {
  it("serves the landing page for an unauthenticated request", async () => {
    const res = await fetch(`${process.env.TEST_BASE_URL}/`);
    expect(res.redirected).toBe(false);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("JobTracker");
  });
});
