/**
 * Bridges promptfoo's grid to the real reviewer: one worktree per test case, the real
 * `runReview()`, the real SDK options — so what this rig measures is the production path, not a
 * reimplementation that can drift from it. Promptfoo's `prompt` argument becomes
 * `reviewerAppend`, so the four prompt variants in `variants/index.ts` map directly onto
 * promptfoo's own prompt axis.
 */

import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import type { ApiProvider, CallApiContextParams, ProviderOptions, ProviderResponse } from "promptfoo";
import { runReview } from "../src/index.ts";
import { classifyThrownError } from "../src/eval/run.ts";
import { loadFixtures, type Fixture } from "../src/eval/fixtures.ts";
import { RATE_LIMITED_SUBTYPE } from "../src/eval/score.ts";
import { withFixtureWorktree } from "../src/eval/worktree.ts";

// Must match `MODEL` / `DEFAULT_EFFORT` in `../src/index.ts` — duplicated rather than imported so
// this rig never forces a second edit to that production file beyond the `reviewerAppend` seam.
const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_EFFORT: EffortLevel = "high";

interface ReviewerProviderConfig {
  model?: string;
  effort?: EffortLevel;
}

export default class ReviewerProvider implements ApiProvider {
  private readonly providerId: string;
  private readonly reviewerConfig: ReviewerProviderConfig;
  private readonly fixturesById: Map<string, Fixture>;

  constructor(options: ProviderOptions = {}) {
    this.providerId = options.id ?? "jobtracker-code-reviewer";
    this.reviewerConfig = (options.config ?? {}) as ReviewerProviderConfig;
    this.fixturesById = new Map(loadFixtures().map((fixture) => [fixture.id, fixture]));
  }

  id(): string {
    return this.providerId;
  }

  async callApi(prompt: string, context?: CallApiContextParams): Promise<ProviderResponse> {
    const fixtureId = context?.vars.fixtureId;
    if (typeof fixtureId !== "string") {
      return { error: `Missing "fixtureId" test var — every test case needs vars: { fixtureId }.` };
    }

    const fixture = this.fixturesById.get(fixtureId);
    if (fixture === undefined) {
      return { error: `Unknown fixture "${fixtureId}" — not found under src/eval/fixtures/.` };
    }

    const model = this.reviewerConfig.model ?? DEFAULT_MODEL;
    const effort = this.reviewerConfig.effort ?? DEFAULT_EFFORT;

    let run: Awaited<ReturnType<typeof runReview>>;
    try {
      run = await withFixtureWorktree(fixture, (worktreePath) =>
        runReview({
          repoRoot: worktreePath,
          base: fixture.baseSha,
          branch: fixture.branch,
          prTitle: fixture.prTitle,
          prBody: fixture.prBody,
          model,
          effort,
          reviewerAppend: prompt,
        }),
      );
    } catch (err) {
      const { resultSubtype, errorMessage } = classifyThrownError(err);
      // Promptfoo has no concept of excluding a run from scoring — surfacing this as an `error`
      // (rather than a scored `output`) keeps it visible in the report instead of silently
      // counting against a prompt variant it says nothing about.
      const prefix = resultSubtype === RATE_LIMITED_SUBTYPE ? "rate_limited: " : "";
      return { error: `${prefix}${errorMessage}` };
    }

    return {
      output: run,
      cost: run.costUsd,
      metadata: {
        resultSubtype: run.resultSubtype,
        consistencyViolations: run.consistencyViolations,
        numTurns: run.numTurns,
        durationMs: run.durationMs,
      },
    };
  }
}

