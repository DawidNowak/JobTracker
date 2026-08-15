/**
 * Exposes `gradeRun`'s components as separate promptfoo named metrics, so the report shows
 * *which* component moved rather than only the composite. Each export is a `type: javascript`
 * assertion referenced as `file://./grade-assert.ts:<name>` with its own `metric:` label.
 */

import type { AssertionValueFunctionContext, GradingResult } from "promptfoo";
import type { ReviewRun } from "../src/index.ts";
import { loadFixtures, type Fixture } from "../src/eval/fixtures.ts";
import { gradeRun, type RunGrade } from "../src/eval/grade.ts";

let fixturesByIdCache: Map<string, Fixture> | null = null;
function fixturesById(): Map<string, Fixture> {
  fixturesByIdCache ??= new Map(loadFixtures().map((fixture) => [fixture.id, fixture]));
  return fixturesByIdCache;
}

function fixtureFor(context: AssertionValueFunctionContext): Fixture {
  const fixtureId = context.vars.fixtureId;
  if (typeof fixtureId !== "string") {
    throw new Error('grade-assert: test is missing vars: { fixtureId }.');
  }
  const fixture = fixturesById().get(fixtureId);
  if (fixture === undefined) {
    throw new Error(`grade-assert: unknown fixture "${fixtureId}".`);
  }
  return fixture;
}

/**
 * Promptfoo always passes the assertion function a stringified `outputString` — but
 * `context.providerResponse.output` is the exact `ReviewRun` object our provider returned, with
 * no stringify/parse round trip. Prefer that; fall back to parsing `outputString` only if a
 * future promptfoo version stops populating `providerResponse`.
 */
function reviewRunFrom(outputString: string, context: AssertionValueFunctionContext): ReviewRun {
  const fromProvider = context.providerResponse?.output;
  if (fromProvider !== undefined && fromProvider !== null && typeof fromProvider === "object") {
    return fromProvider as ReviewRun;
  }
  return JSON.parse(outputString) as ReviewRun;
}

function gradeFor(outputString: string, context: AssertionValueFunctionContext): RunGrade {
  return gradeRun(fixtureFor(context), reviewRunFrom(outputString, context));
}

function reasonFor(grade: RunGrade, extra?: string): string {
  if (!grade.valid) {
    const why = grade.violations.length > 0 ? grade.violations.join("; ") : "no structured output (SDK error).";
    return `Invalid run — ${why}`;
  }
  const base = `caught ${grade.caught}/${grade.planted}, ${grade.falsePositives} false positive(s) (${grade.decoyHits} on declared decoys), ${grade.misattributed} misattributed`;
  return extra ? `${base} — ${extra}` : base;
}

/** The composite score `gradeRun` already computes: `valid ? max(0,(caught-falsePositives)/planted) : 0`. */
export function composite(outputString: string, context: AssertionValueFunctionContext): GradingResult {
  const grade = gradeFor(outputString, context);
  return { pass: grade.valid && grade.score > 0, score: grade.score, reason: reasonFor(grade) };
}

/** Fraction of planted defects caught. A fixture with nothing planted (`clean`) trivially scores 1. */
export function recall(outputString: string, context: AssertionValueFunctionContext): GradingResult {
  const grade = gradeFor(outputString, context);
  const score = !grade.valid ? 0 : grade.planted === 0 ? 1 : grade.caught / grade.planted;
  return { pass: grade.valid, score, reason: reasonFor(grade, `recall ${grade.caught}/${grade.planted}`) };
}

/** Fraction of BLOCKING findings that landed on a real planted defect. No BLOCKING findings at all scores 1. */
export function precision(outputString: string, context: AssertionValueFunctionContext): GradingResult {
  const grade = gradeFor(outputString, context);
  const flagged = grade.caught + grade.falsePositives;
  const score = !grade.valid ? 0 : flagged === 0 ? 1 : grade.caught / flagged;
  return {
    pass: grade.valid,
    score,
    reason: reasonFor(grade, `precision ${grade.caught}/${flagged || 0}`),
  };
}

/** Whether the run produced usable structured output at all: no SDK error, no consistency violation. */
export function validity(outputString: string, context: AssertionValueFunctionContext): GradingResult {
  const grade = gradeFor(outputString, context);
  return { pass: grade.valid, score: grade.valid ? 1 : 0, reason: reasonFor(grade) };
}
