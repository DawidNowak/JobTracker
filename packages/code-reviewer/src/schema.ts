/**
 * The agent's structured output shape — the JSON Schema handed to the SDK, the TypeScript
 * type it corresponds to, and the runtime guard that narrows `unknown` to it. Kept adjacent
 * so the three cannot drift: a schema change and a type change land in the same edit.
 */

import { CRITERION_IDS, type CriterionId } from "./criteria.ts";

export type Verdict = "PASS" | "FAIL";

export type CriterionStatus = "PASS" | "CONCERN" | "FAIL" | "NOT_APPLICABLE";
const CRITERION_STATUSES: readonly CriterionStatus[] = ["PASS", "CONCERN", "FAIL", "NOT_APPLICABLE"];

export type FindingSeverity = "BLOCKING" | "ADVISORY";
const FINDING_SEVERITIES: readonly FindingSeverity[] = ["BLOCKING", "ADVISORY"];

export type FindingConfidence = "CERTAIN" | "POSSIBLE";
const FINDING_CONFIDENCES: readonly FindingConfidence[] = ["CERTAIN", "POSSIBLE"];

export interface CriterionResult {
  id: CriterionId;
  status: CriterionStatus;
  rationale: string;
}

export interface Finding {
  criterion: CriterionId;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  file: string;
  line: number;
  what: string; // the defect, one sentence
  why: string; // the concrete failure it produces
  fix: string; // described, not patched
}

export interface ReviewOutput {
  summary: string;
  criteria: CriterionResult[];
  findings: Finding[];
}

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    criteria: {
      type: "array",
      minItems: CRITERION_IDS.length,
      maxItems: CRITERION_IDS.length,
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: [...CRITERION_IDS] },
          status: { type: "string", enum: [...CRITERION_STATUSES] },
          rationale: { type: "string" },
        },
        required: ["id", "status", "rationale"],
        additionalProperties: false,
      },
    },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          criterion: { type: "string", enum: [...CRITERION_IDS] },
          severity: { type: "string", enum: [...FINDING_SEVERITIES] },
          confidence: { type: "string", enum: [...FINDING_CONFIDENCES] },
          file: { type: "string" },
          line: { type: "integer" },
          what: { type: "string" },
          why: { type: "string" },
          fix: { type: "string" },
        },
        required: ["criterion", "severity", "confidence", "file", "line", "what", "why", "fix"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "criteria", "findings"],
  additionalProperties: false,
};

function isCriterionId(value: unknown): value is CriterionId {
  return typeof value === "string" && (CRITERION_IDS as readonly string[]).includes(value);
}

function parseCriterionResult(value: unknown): CriterionResult | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (!isCriterionId(candidate.id)) return null;
  if (typeof candidate.status !== "string" || !CRITERION_STATUSES.includes(candidate.status as CriterionStatus)) return null;
  if (typeof candidate.rationale !== "string") return null;

  return { id: candidate.id, status: candidate.status as CriterionStatus, rationale: candidate.rationale };
}

function parseFinding(value: unknown): Finding | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (!isCriterionId(candidate.criterion)) return null;
  if (typeof candidate.severity !== "string" || !FINDING_SEVERITIES.includes(candidate.severity as FindingSeverity)) return null;
  if (typeof candidate.confidence !== "string" || !FINDING_CONFIDENCES.includes(candidate.confidence as FindingConfidence)) {
    return null;
  }
  if (typeof candidate.file !== "string") return null;
  if (typeof candidate.line !== "number" || !Number.isInteger(candidate.line)) return null;
  if (typeof candidate.what !== "string") return null;
  if (typeof candidate.why !== "string") return null;
  if (typeof candidate.fix !== "string") return null;

  return {
    criterion: candidate.criterion,
    severity: candidate.severity as FindingSeverity,
    confidence: candidate.confidence as FindingConfidence,
    file: candidate.file,
    line: candidate.line,
    what: candidate.what,
    why: candidate.why,
    fix: candidate.fix,
  };
}

/**
 * Narrows the SDK's `structured_output: unknown` to `ReviewOutput`. Returns `null` rather
 * than throwing on anything that doesn't match, so the caller owns the exit path — a schema
 * mismatch is an errored run, not an uncaught exception.
 */
export function parseReviewOutput(value: unknown): ReviewOutput | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;

  if (typeof candidate.summary !== "string") return null;
  if (!Array.isArray(candidate.criteria)) return null;
  if (!Array.isArray(candidate.findings)) return null;

  const criteria: CriterionResult[] = [];
  for (const item of candidate.criteria) {
    const parsed = parseCriterionResult(item);
    if (parsed === null) return null;
    criteria.push(parsed);
  }

  const findings: Finding[] = [];
  for (const item of candidate.findings) {
    const parsed = parseFinding(item);
    if (parsed === null) return null;
    findings.push(parsed);
  }

  return { summary: candidate.summary, criteria, findings };
}

/** Pure: `"FAIL"` iff any criterion is `"FAIL"`. `CONCERN` and `NOT_APPLICABLE` never block. */
export function deriveVerdict(output: ReviewOutput): Verdict {
  return output.criteria.some((criterion) => criterion.status === "FAIL") ? "FAIL" : "PASS";
}

/**
 * Returns human-readable violation messages, empty when the output is internally consistent.
 * The biconditional (a criterion is `FAIL` iff it has a `BLOCKING` finding) is checked in both
 * directions deliberately — a `BLOCKING` finding filed under a criterion marked `PASS` is the
 * same contradiction as an evidence-free `FAIL`.
 */
export function checkConsistency(output: ReviewOutput): string[] {
  const violations: string[] = [];
  const knownIds = new Set<string>(CRITERION_IDS);

  const seenIds = new Set<string>();
  for (const criterion of output.criteria) {
    if (seenIds.has(criterion.id)) violations.push(`Duplicate criterion result for "${criterion.id}".`);
    seenIds.add(criterion.id);
  }
  if (output.criteria.length !== CRITERION_IDS.length) {
    violations.push(`Expected exactly ${CRITERION_IDS.length} criterion results, got ${output.criteria.length}.`);
  }
  for (const id of CRITERION_IDS) {
    if (!seenIds.has(id)) violations.push(`Missing criterion result for "${id}".`);
  }

  for (const finding of output.findings) {
    if (!knownIds.has(finding.criterion)) {
      violations.push(`Finding at ${finding.file}:${finding.line} cites unknown criterion "${finding.criterion}".`);
    }
    if (finding.severity === "BLOCKING") {
      if (finding.confidence !== "CERTAIN") {
        violations.push(`BLOCKING finding at ${finding.file}:${finding.line} must be CERTAIN, got ${finding.confidence}.`);
      }
      if (finding.file.trim() === "") {
        violations.push(`BLOCKING finding under "${finding.criterion}" has an empty file.`);
      }
    }
  }

  const blockingCriteria = new Set(output.findings.filter((finding) => finding.severity === "BLOCKING").map((finding) => finding.criterion));
  const findingCountByCriterion = new Map<string, number>();
  for (const finding of output.findings) {
    findingCountByCriterion.set(finding.criterion, (findingCountByCriterion.get(finding.criterion) ?? 0) + 1);
  }

  for (const criterion of output.criteria) {
    if (criterion.status === "NOT_APPLICABLE" && (findingCountByCriterion.get(criterion.id) ?? 0) > 0) {
      violations.push(`Criterion "${criterion.id}" is NOT_APPLICABLE but carries findings.`);
    }

    const hasBlocking = blockingCriteria.has(criterion.id);
    if (criterion.status === "FAIL" && !hasBlocking) {
      violations.push(`Criterion "${criterion.id}" is FAIL but has no BLOCKING finding.`);
    }
    if (criterion.status !== "FAIL" && hasBlocking) {
      violations.push(`Criterion "${criterion.id}" has a BLOCKING finding but status is ${criterion.status}, not FAIL.`);
    }
  }

  return violations;
}
