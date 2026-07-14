import { describe, it, expect } from "vitest";
import { isStale, isStaleBusinessDays } from "@/lib/format";

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

describe("isStaleBusinessDays", () => {
  it("PRD vector: Friday anchor viewed the following Tuesday is 2 business days — false at n=4", () => {
    const friday = "2026-07-10T09:00:00"; // Friday
    const followingTuesday = new Date("2026-07-14T12:00:00"); // Tuesday
    expect(isStaleBusinessDays(friday, 4, followingTuesday)).toBe(false);
  });

  it("PRD vector: Friday anchor viewed the following Thursday is 4 business days — true at n=4", () => {
    const friday = "2026-07-10T09:00:00"; // Friday
    const followingThursday = new Date("2026-07-16T12:00:00"); // Thursday
    expect(isStaleBusinessDays(friday, 4, followingThursday)).toBe(true);
  });

  it("Monday anchor viewed the same week's Thursday is 3 business days — false at n=4", () => {
    const monday = "2026-07-06T09:00:00"; // Monday
    const thursday = new Date("2026-07-09T12:00:00"); // Thursday
    expect(isStaleBusinessDays(monday, 4, thursday)).toBe(false);
  });

  it("Monday anchor viewed the same week's Friday is 4 business days — true at n=4", () => {
    const monday = "2026-07-06T09:00:00"; // Monday
    const friday = new Date("2026-07-10T12:00:00"); // Friday
    expect(isStaleBusinessDays(monday, 4, friday)).toBe(true);
  });

  it("weekend anchor (Saturday) counts only subsequent weekdays — false one weekday short of n=4", () => {
    const saturday = "2026-07-11T09:00:00"; // Saturday
    const wednesday = new Date("2026-07-15T12:00:00"); // Wednesday: Mon, Tue, Wed = 3
    expect(isStaleBusinessDays(saturday, 4, wednesday)).toBe(false);
  });

  it("weekend anchor (Saturday) counts only subsequent weekdays — true once n=4 is reached", () => {
    const saturday = "2026-07-11T09:00:00"; // Saturday
    const thursday = new Date("2026-07-16T12:00:00"); // Thursday: Mon, Tue, Wed, Thu = 4
    expect(isStaleBusinessDays(saturday, 4, thursday)).toBe(true);
  });

  it("returns false for a same-day timestamp", () => {
    const monday = "2026-07-06T09:00:00"; // Monday
    const sameDay = new Date("2026-07-06T20:00:00");
    expect(isStaleBusinessDays(monday, 4, sameDay)).toBe(false);
  });

  it("returns false for a future iso timestamp", () => {
    const now = new Date("2026-07-13T12:00:00"); // Monday
    const tomorrow = "2026-07-14T12:00:00"; // Tuesday
    expect(isStaleBusinessDays(tomorrow, 4, now)).toBe(false);
  });
});
