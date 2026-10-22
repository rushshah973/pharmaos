// What every pipeline agent gets: the run, its plan, the lines it may work on, the model client and the step log.
import type { StepSink } from "@/lib/services/agent-runs";
import type { ModelClient } from "./loop";
import { ServiceError } from "@/lib/api/errors";

export type RunLine = { lineId: string; sku: string; rank: number; productId: string };

export type RunContext = {
  runId: string;
  planId: string;
  asOf: string;
  lines: RunLine[];
  client: ModelClient;
  model: string;
  log: StepSink;
  /** Epoch ms by which the whole run must finish (before the serverless function is stopped). */
  deadline?: number;
};

/** The run line for a SKU code, or a SKU_NOT_IN_RUN error (agents only touch the SKUs selected for this run). */
export function lineFor(ctx: RunContext, sku: string): RunLine {
  const line = ctx.lines.find((l) => l.sku.toUpperCase() === sku.trim().toUpperCase());
  if (!line) throw new ServiceError("SKU_NOT_IN_RUN", 400, `${sku} is not one of this run's SKUs (${ctx.lines.map((l) => l.sku).join(", ")}).`);
  return line;
}

/** The run's SKUs for the first user message. */
export function runLinesText(ctx: RunContext): string {
  return ctx.lines.map((l) => `- ${l.sku} (rank ${l.rank}, line ${l.lineId})`).join("\n");
}
