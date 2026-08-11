/**
 * The agent's structured output shape — the JSON Schema handed to the SDK, the TypeScript
 * type it corresponds to, and the runtime guard that narrows `unknown` to it. Kept adjacent
 * so the three cannot drift: a schema change and a type change land in the same edit.
 */

export const SCORE_DIMENSIONS = ["correctness", "idiomatic_style", "complexity", "test_coverage", "security"] as const;

export type ScoreDimension = (typeof SCORE_DIMENSIONS)[number];

export type Verdict = "PASS" | "FAIL";

export interface ReviewOutput {
  verdict: Verdict;
  summary: string;
  scores: Record<ScoreDimension, number>;
  report_markdown: string;
}

const scoreProperties = Object.fromEntries(
  SCORE_DIMENSIONS.map((dimension) => [dimension, { type: "integer", minimum: 1, maximum: 10 }]),
);

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["PASS", "FAIL"] },
    summary: { type: "string" },
    scores: {
      type: "object",
      properties: scoreProperties,
      required: [...SCORE_DIMENSIONS],
      additionalProperties: false,
    },
    report_markdown: { type: "string" },
  },
  required: ["verdict", "summary", "scores", "report_markdown"],
  additionalProperties: false,
};

function isValidScores(value: unknown): value is Record<ScoreDimension, number> {
  if (typeof value !== "object" || value === null) return false;
  const scores = value as Record<string, unknown>;
  return SCORE_DIMENSIONS.every((dimension) => {
    const score = scores[dimension];
    return typeof score === "number" && Number.isInteger(score) && score >= 1 && score <= 10;
  });
}

/**
 * Narrows the SDK's `structured_output: unknown` to `ReviewOutput`. Returns `null` rather
 * than throwing on anything that doesn't match, so the caller owns the exit path — a schema
 * mismatch is an errored run, not an uncaught exception.
 */
export function parseReviewOutput(value: unknown): ReviewOutput | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (candidate.verdict !== "PASS" && candidate.verdict !== "FAIL") return null;
  if (typeof candidate.summary !== "string") return null;
  if (typeof candidate.report_markdown !== "string") return null;
  if (!isValidScores(candidate.scores)) return null;

  return {
    verdict: candidate.verdict,
    summary: candidate.summary,
    scores: candidate.scores,
    report_markdown: candidate.report_markdown,
  };
}
