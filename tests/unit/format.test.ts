import { describe, it, expect } from "vitest";
import { isStale } from "@/lib/format";

describe("isStale", () => {
  it("returns false when the action happened today, even hours ago", () => {
    const now = new Date("2026-07-13T20:00:00");
    const lastActionAt = "2026-07-13T09:00:00";
    expect(isStale(lastActionAt, 1, now)).toBe(false);
  });

  it("returns true once local midnight has passed, even with under 2 hours elapsed", () => {
    const now = new Date("2026-07-13T00:30:00");
    const lastActionAt = "2026-07-12T23:00:00";
    expect(isStale(lastActionAt, 1, now)).toBe(true);
  });

  it("is inclusive exactly at the local-midnight day boundary", () => {
    const now = new Date("2026-07-13T00:00:00");
    const lastActionAt = "2026-07-12T00:00:00";
    expect(isStale(lastActionAt, 1, now)).toBe(true);
  });

  it("returns false when ~20 hours have elapsed but the calendar day hasn't turned over", () => {
    const now = new Date("2026-07-13T23:00:00");
    const lastActionAt = "2026-07-13T03:00:00";
    expect(isStale(lastActionAt, 1, now)).toBe(false);
  });

  it("supports a multi-day threshold (e.g. 7 days) — false one day short, true once reached", () => {
    const now = new Date("2026-07-13T12:00:00");
    const sixDaysAgo = "2026-07-07T12:00:00";
    const sevenDaysAgo = "2026-07-06T12:00:00";
    expect(isStale(sixDaysAgo, 7, now)).toBe(false);
    expect(isStale(sevenDaysAgo, 7, now)).toBe(true);
  });

  it("returns false for a future iso timestamp", () => {
    const now = new Date("2026-07-13T12:00:00");
    const tomorrow = "2026-07-14T12:00:00";
    expect(isStale(tomorrow, 1, now)).toBe(false);
  });
});
