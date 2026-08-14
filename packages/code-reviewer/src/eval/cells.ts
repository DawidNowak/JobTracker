/**
 * The four (model, effort) cells the sweep runs, cheapest-first — so a sweep cut short by the
 * ceiling or the subscription's usage limits still answers the cheapest questions first.
 */

import type { EffortLevel } from "@anthropic-ai/claude-agent-sdk";

export interface Cell {
  id: string;
  model: string;
  effort: EffortLevel;
  /**
   * `false` means the SDK silently downgrades `effort` for this model rather than honoring it
   * (`sdk.d.ts:141`) — the report must label the cell rather than presenting it as a comparable
   * `@ high`.
   */
  effortSupported: boolean;
  note?: string;
}

export const CELLS: readonly Cell[] = [
  {
    id: "haiku-high",
    model: "claude-haiku-4-5",
    effort: "high",
    effortSupported: false,
    note: "claude-haiku-4-5 does not support effort levels; the SDK silently downgrades this to its default rather than erroring, so this cell is not a true `@ high` comparison.",
  },
  {
    id: "sonnet-high",
    model: "claude-sonnet-5",
    effort: "high",
    effortSupported: true,
  },
  {
    id: "sonnet-xhigh",
    model: "claude-sonnet-5",
    effort: "xhigh",
    effortSupported: true,
  },
  {
    id: "opus-high",
    model: "claude-opus-5",
    effort: "high",
    effortSupported: true,
  },
];
