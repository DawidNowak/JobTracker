import type { ParseResult, ParseStatus } from "./types";

export const EXPECTED_KEYS: Record<"linkedin" | "jjit", (keyof ParseResult)[]> = {
  linkedin: ["position", "company", "description"],
  jjit: ["position", "company", "description", "salary", "work_mode"],
};

export function countDefined(result: ParseResult): number {
  return (Object.keys(result) as (keyof ParseResult)[]).filter((k) => result[k] !== undefined).length;
}

export function resolveStatus(result: ParseResult, kind: "linkedin" | "jjit"): ParseStatus {
  const populated = countDefined(result);
  if (populated === 0) return "empty";
  const expected = EXPECTED_KEYS[kind];
  const missingExpected = expected.some((k) => result[k] === undefined);
  return missingExpected ? "partial" : "ok";
}
