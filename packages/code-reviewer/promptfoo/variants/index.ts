/**
 * Four whole-prompt texts that differ **only** in the FAIL⇔BLOCKING consistency paragraph
 * (`../../src/prompt.ts:85-90`). Each is built from the live `REVIEWER_APPEND` export by
 * substituting that one block, so the surrounding text is sourced from production rather than
 * copied — a future edit to any other part of the prompt cannot silently turn this into a
 * multi-axis sweep, and the `incumbent` variant automatically tracks production wording.
 */

import { REVIEWER_APPEND } from "../../src/prompt.ts";

/** The consistency paragraph exactly as it reads in `prompt.ts` today — the substitution anchor. */
const INCUMBENT_CONSISTENCY_BLOCK = `**The rule tying criteria and findings together, enforced mechanically after you respond:** a
criterion's status is \`FAIL\` if and only if it has at least one \`BLOCKING\` finding. A \`FAIL\`
with no \`BLOCKING\` finding, or a \`BLOCKING\` finding filed under a criterion you marked anything
other than \`FAIL\`, is a contradiction — the run is rejected outright: no verdict, no comment.
Keep this consistent yourself; do not rely on a later pass to fix it. A \`NOT_APPLICABLE\`
criterion must carry no findings at all.`;

const RESTATED_CONSISTENCY_BLOCK = `**Two rules tie criteria and findings together, enforced mechanically after you respond:**
1. If a criterion's status is \`FAIL\`, it must have at least one \`BLOCKING\` finding filed under it.
2. If a criterion has a \`BLOCKING\` finding filed under it, that criterion's status must be \`FAIL\`.
Breaking either rule is a contradiction — the run is rejected outright: no verdict, no comment.
Keep this consistent yourself; do not rely on a later pass to fix it. A \`NOT_APPLICABLE\`
criterion must carry no findings at all.`;

const WORKED_EXAMPLE_CONSISTENCY_BLOCK = `**The rule tying criteria and findings together, enforced mechanically after you respond:** a
criterion's status is \`FAIL\` if and only if it has at least one \`BLOCKING\` finding. A \`FAIL\`
with no \`BLOCKING\` finding, or a \`BLOCKING\` finding filed under a criterion you marked anything
other than \`FAIL\`, is a contradiction — the run is rejected outright: no verdict, no comment.

Correct: \`correctness\` is \`FAIL\` and at least one finding filed under \`correctness\` is
\`BLOCKING\`. Incorrect: \`correctness\` is \`FAIL\` but every finding filed under it is
\`ADVISORY\` — either mark the criterion \`CONCERN\` instead, or add the \`BLOCKING\` finding that
justifies \`FAIL\`.

Keep this consistent yourself; do not rely on a later pass to fix it. A \`NOT_APPLICABLE\`
criterion must carry no findings at all.`;

const CHECKLIST_CONSISTENCY_BLOCK = `**Before you submit, check this yourself — it is enforced mechanically after you respond, and an
inconsistent run is rejected outright: no verdict, no comment.**
- For every criterion you marked \`FAIL\`: confirm at least one finding filed under it is
  \`BLOCKING\`.
- For every \`BLOCKING\` finding: confirm the criterion it is filed under is marked \`FAIL\`.
- For every \`NOT_APPLICABLE\` criterion: confirm it carries no findings at all.
Fix any mismatch before responding — do not rely on a later pass to fix it.`;

/**
 * Returns the full `REVIEWER_APPEND` text with the consistency paragraph replaced by
 * `consistencyBlock`. Throws if `prompt.ts` has drifted from `INCUMBENT_CONSISTENCY_BLOCK`, so a
 * silent mismatch never produces four prompts that quietly differ on more than one axis.
 */
export function buildReviewerAppend(consistencyBlock: string): string {
  if (!REVIEWER_APPEND.includes(INCUMBENT_CONSISTENCY_BLOCK)) {
    throw new Error(
      "variants/index.ts: REVIEWER_APPEND no longer contains INCUMBENT_CONSISTENCY_BLOCK verbatim " +
        "— update the constant in this file to match the current wording in ../../src/prompt.ts.",
    );
  }
  return REVIEWER_APPEND.replace(INCUMBENT_CONSISTENCY_BLOCK, consistencyBlock);
}

/**
 * One exported function per variant, matching promptfoo's `PromptFunction` contract
 * (`(context) => string`) so each can be referenced from `promptfooconfig.yaml` as
 * `file://./variants/index.ts:<name>` — promptfoo's documented mechanism for a JS/TS prompt
 * source, as opposed to a bare string export whose file-reference behavior isn't documented.
 * The `context` argument (promptfoo's vars/provider for this test case) is unused: every variant
 * is a fixed whole-prompt text, not templated per test case.
 */
export function incumbent(): string {
  return buildReviewerAppend(INCUMBENT_CONSISTENCY_BLOCK);
}
export function restated(): string {
  return buildReviewerAppend(RESTATED_CONSISTENCY_BLOCK);
}
export function workedExample(): string {
  return buildReviewerAppend(WORKED_EXAMPLE_CONSISTENCY_BLOCK);
}
export function checklist(): string {
  return buildReviewerAppend(CHECKLIST_CONSISTENCY_BLOCK);
}

/** Name → text, for pairwise diffing (manual verification) and for `README.md` tooling. */
export const VARIANT_TEXT: Record<string, string> = {
  incumbent: incumbent(),
  restated: restated(),
  "worked-example": workedExample(),
  checklist: checklist(),
};
