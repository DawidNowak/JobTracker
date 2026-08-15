/**
 * A pure, model-call-free grader producing per-run recall, precision, validity and a composite
 * score. Superset of `scoreRun`'s single-outcome model: `gradeRun` handles the `multi` expectation
 * (N planted defects, M decoys) and degrades cleanly to the existing `violation` (one defect, no
 * decoys) and `clean` (no defects) shapes, so it can be exercised against the 48 stored records
 * before any `multi` fixture exists.
 */

import type { ReviewRun } from "../index.ts";
import type { CriterionId } from "../criteria.ts";
import type { Fixture, FixtureExpectation } from "./fixtures.ts";
import { hasBlockingFindingOnExpectedFile, matchesExpectedFile } from "./score.ts";

export interface RunGrade {
  valid: boolean;
  planted: number;
  caught: number;
  falsePositives: number; // BLOCKING on a file with no planted defect
  decoyHits: number; // the subset landing on declared decoy files
  misattributed: number; // BLOCKING on a defect's file under the wrong criterion
  advisoryOnNonDefect: number; // tracked, never scored
  score: number; // valid ? max(0,(caught-falsePositives)/planted) : 0
  violations: string[]; // consistency violation messages, surfaced not swallowed
}

interface NormalizedDefect {
  criterion: CriterionId;
  files: string[];
}

interface NormalizedExpectation {
  defects: NormalizedDefect[];
  decoyFiles: string[];
}

function normalizeExpectation(expect: FixtureExpectation): NormalizedExpectation {
  if (expect.kind === "clean") return { defects: [], decoyFiles: [] };
  if (expect.kind === "violation") {
    return { defects: [{ criterion: expect.criterion, files: expect.files }], decoyFiles: [] };
  }
  return {
    defects: expect.defects.map((defect) => ({ criterion: defect.criterion, files: [defect.file] })),
    decoyFiles: expect.decoys.map((decoy) => decoy.file),
  };
}

function gradeFindings(
  output: NonNullable<ReviewRun["output"]>,
  defects: NormalizedDefect[],
  decoyFiles: string[],
): { caught: number; falsePositives: number; decoyHits: number; misattributed: number; advisoryOnNonDefect: number } {
  const caught = defects.filter((defect) => hasBlockingFindingOnExpectedFile(output, defect.criterion, defect.files)).length;

  let falsePositives = 0;
  let decoyHits = 0;
  let misattributed = 0;
  let advisoryOnNonDefect = 0;

  for (const finding of output.findings) {
    const matchingDefect = defects.find((defect) => defect.files.some((file) => matchesExpectedFile(finding.file, file)));
    const onDecoyFile = decoyFiles.some((file) => matchesExpectedFile(finding.file, file));

    if (finding.severity === "BLOCKING") {
      if (matchingDefect === undefined) {
        falsePositives += 1;
        if (onDecoyFile) decoyHits += 1;
      } else if (matchingDefect.criterion !== finding.criterion) {
        misattributed += 1;
      }
      // else: this is the finding that made `caught` true for its defect — already counted above.
    } else if (matchingDefect === undefined) {
      advisoryOnNonDefect += 1;
    }
  }

  return { caught, falsePositives, decoyHits, misattributed, advisoryOnNonDefect };
}

export function gradeRun(fixture: Fixture, run: ReviewRun): RunGrade {
  const { defects, decoyFiles } = normalizeExpectation(fixture.expect);
  const planted = defects.length;
  const violations = run.consistencyViolations;

  const valid = run.output !== null && run.resultSubtype === "success" && violations.length === 0;

  if (!valid) {
    return {
      valid: false,
      planted,
      caught: 0,
      falsePositives: 0,
      decoyHits: 0,
      misattributed: 0,
      advisoryOnNonDefect: 0,
      score: 0,
      violations,
    };
  }

  // `run.output` is non-null here — `valid` above already checked it.
  const output = run.output as NonNullable<ReviewRun["output"]>;
  const { caught, falsePositives, decoyHits, misattributed, advisoryOnNonDefect } = gradeFindings(
    output,
    defects,
    decoyFiles,
  );

  const score = planted === 0 ? (falsePositives === 0 ? 1 : 0) : Math.max(0, (caught - falsePositives) / planted);

  return { valid, planted, caught, falsePositives, decoyHits, misattributed, advisoryOnNonDefect, score, violations };
}
