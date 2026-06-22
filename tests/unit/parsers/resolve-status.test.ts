import { describe, it, expect } from "vitest";
import { resolveStatus, EXPECTED_KEYS } from "@/lib/parsers/status";
import type { ParseResult } from "@/lib/parsers/types";

// Synthetic inputs — values don't matter, only which keys are defined.
const ALL_LI: ParseResult = { position: "p", company: "c", description: "d" };
const ALL_JJIT: ParseResult = { position: "p", company: "c", description: "d", salary: "s", work_mode: "Zdalna" };
const NONE: ParseResult = {};

describe("resolveStatus — linkedin", () => {
  it("returns ok when all expected keys are present", () => {
    expect(resolveStatus(ALL_LI, "linkedin")).toBe("ok");
  });

  it("returns ok even when optional keys (salary, work_mode) are absent", () => {
    expect(resolveStatus({ position: "p", company: "c", description: "d" }, "linkedin")).toBe("ok");
  });

  it("returns partial when position is missing", () => {
    const r: ParseResult = { company: "c", description: "d" };
    expect(resolveStatus(r, "linkedin")).toBe("partial");
  });

  it("returns partial when company is missing", () => {
    const r: ParseResult = { position: "p", description: "d" };
    expect(resolveStatus(r, "linkedin")).toBe("partial");
  });

  it("returns partial when description is missing", () => {
    const r: ParseResult = { position: "p", company: "c" };
    expect(resolveStatus(r, "linkedin")).toBe("partial");
  });

  it("returns empty when nothing is populated", () => {
    expect(resolveStatus(NONE, "linkedin")).toBe("empty");
  });

  it("does NOT return ok when only 1 key is populated (partial, not ok)", () => {
    const r: ParseResult = { position: "p" };
    expect(resolveStatus(r, "linkedin")).toBe("partial");
  });
});

describe("resolveStatus — jjit", () => {
  it("returns ok when all expected keys are present", () => {
    expect(resolveStatus(ALL_JJIT, "jjit")).toBe("ok");
  });

  it("returns partial when salary is missing (jjit requires salary)", () => {
    const { salary: _, ...withoutSalary } = ALL_JJIT;
    expect(resolveStatus(withoutSalary, "jjit")).toBe("partial");
  });

  it("returns partial when work_mode is missing", () => {
    const { work_mode: _, ...withoutMode } = ALL_JJIT;
    expect(resolveStatus(withoutMode, "jjit")).toBe("partial");
  });

  it("returns partial when position is missing", () => {
    const r: ParseResult = { company: "c", description: "d", salary: "s", work_mode: "Zdalna" };
    expect(resolveStatus(r, "jjit")).toBe("partial");
  });

  it("returns empty when nothing is populated", () => {
    expect(resolveStatus(NONE, "jjit")).toBe("empty");
  });
});

describe("EXPECTED_KEYS contract", () => {
  it("linkedin expected keys are position, company, description", () => {
    expect(EXPECTED_KEYS.linkedin).toEqual(["position", "company", "description"]);
  });

  it("jjit expected keys include salary and work_mode", () => {
    expect(EXPECTED_KEYS.jjit).toContain("salary");
    expect(EXPECTED_KEYS.jjit).toContain("work_mode");
  });
});
