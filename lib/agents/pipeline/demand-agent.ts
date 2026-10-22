// Demand Agent (implementationplan.md §9.5): for each SKU in the run, picks which forecast to trust — the ML model or
// the moving average — from the evidence (both forecasts and their measured errors). It picks a METHOD, never a
// number. Effect: the line is re-planned with that method (qty, totals, evidence.demandDecision), audited
// agent.demand_decided. Anything else in a decision (a number, an unknown SKU, an ML pick without an ML forecast)
// is rejected and logged as a rejected_decision step; the line keeps its plan.
import { z } from "zod";
import { ServiceError } from "@/lib/api/errors";
import { analyseSkuCode, salesHistory } from "@/lib/services/agent-data";
import { applyDemandDecision } from "@/lib/services/plans";
import { type RunContext, lineFor, runLinesText } from "./context";
import { type AgentOutcome, type AgentTool, runAgentLoop } from "./loop";

const SYSTEM = `You are the Demand Agent in PharmaOS, a procurement system for an Indian pharmaceutical stockist.
For each SKU you are given, decide which daily-demand forecast the purchase plan should use: "ml" (the ridge-regression
model blended with the average) or "baseline" (the trend-aware moving average).
Rules:
- The message already holds get_demand_forecasts for every SKU (both forecasts, both measured errors on the last 14
  days, the default rule's choice, demand flags). Decide from it and call submit_demand_decisions right away; use
  get_sales_history or get_inventory_position only if a decision really needs more.
- You choose a METHOD only. Never send a number: the system takes the daily demand from the method you choose.
- Prefer the method with the lower measured error; prefer "baseline" when the recent history is a one-off spike, when
  ML is missing, or when the evidence is unclear. Give a short reason (at least 10 characters) that cites the evidence.
- Only decide for the SKUs listed. Finish by calling submit_demand_decisions exactly once with one decision per SKU.`;

const sku = z.string().trim().min(3).max(32).describe("SKU code from the run list");

export const demandTerminalDecision = z
  .object({
    sku: z.string().trim().min(3),
    method: z.enum(["ml", "baseline"]),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export type DemandSummary = { accepted: number; rejected: number; changed: { sku: string; from: string; to: string; qtyBefore: number; qtyAfter: number }[] };

export function demandTools(ctx: RunContext): AgentTool[] {
  return [
    {
      name: "get_demand_forecasts",
      description: "Both forecasts for one SKU in this run: 7- and 28-day averages, the baseline, the ML forecast and its 14-day series, both measured errors (WAPE) on the last 14 days, the default rule's method, the method the plan uses now, and demand flags.",
      schema: z.object({ sku }),
      handler: async ({ sku }: { sku: string }) => {
        lineFor(ctx, sku);
        const { sku: s, analysis: a } = await analyseSkuCode(sku);
        const d = a.demand;
        return {
          sku: a.sku,
          d7: d.d7,
          d28: d.d28,
          baselineDaily: d.baseline,
          mlDaily: d.ml,
          baselineWape: d.baselineWape,
          mlWape: d.mlWape,
          defaultMethod: s.forecast?.defaultMethod ?? "baseline",
          methodInPlan: d.method,
          mlAvailable: d.ml !== null,
          flags: d.flags,
          mlSeries14: d.forecast14.map((p) => Math.round(p.units * 10) / 10),
        };
      },
    },
    {
      name: "get_sales_history",
      description: "Daily packs sold for one SKU in this run over the last N days (up to 90), oldest first.",
      schema: z.object({ sku, days: z.number().int().min(1).max(90) }),
      handler: async ({ sku, days }: { sku: string; days: number }) => {
        lineFor(ctx, sku);
        return salesHistory(sku, days);
      },
    },
    {
      name: "get_inventory_position",
      description: "Stock for one SKU in this run: eligible available, incoming, stock position, days of cover, reorder point and engine status.",
      schema: z.object({ sku }),
      handler: async ({ sku }: { sku: string }) => {
        lineFor(ctx, sku);
        const { analysis: a } = await analyseSkuCode(sku);
        return { sku: a.sku, status: a.status, eligibleAvailable: a.expiry.eligibleAvailable, incoming: a.incomingQty, stockPosition: a.stockPosition, coverDays: a.cover, reorderPoint: a.reorderPoint, fastestLeadDays: a.leadFastest };
      },
    },
  ];
}

/** Applies a submitted decision list: per-item guardrail, then the effect. Exported for the F11 tests. */
export async function applyDemandDecisions(ctx: RunContext, decisions: Record<string, unknown>[]): Promise<DemandSummary> {
  const out: DemandSummary = { accepted: 0, rejected: 0, changed: [] };
  for (const raw of decisions) {
    const parsed = demandTerminalDecision.safeParse(raw);
    if (!parsed.success) {
      out.rejected++;
      await ctx.log.add({ agent: "demand", kind: "rejected_decision", input: raw, output: { code: "INVALID_DECISION", message: "A decision is a SKU, a method ('ml' or 'baseline') and a reason of 10+ characters; never a number.", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, ok: false });
      continue;
    }
    const d = parsed.data;
    try {
      const line = lineFor(ctx, d.sku);
      const r = await applyDemandDecision(ctx.planId, line.lineId, { method: d.method, reason: d.reason });
      out.accepted++;
      if (r.changed) out.changed.push({ sku: line.sku, from: r.before.method, to: r.after.method, qtyBefore: r.before.qty, qtyAfter: r.after.qty });
      await ctx.log.add({ agent: "demand", kind: "decision", input: d, output: r });
    } catch (err) {
      out.rejected++;
      await ctx.log.add({ agent: "demand", kind: "rejected_decision", input: d, output: { code: err instanceof ServiceError ? err.code : "FAILED", message: err instanceof Error ? err.message : String(err) }, ok: false });
    }
  }
  return out;
}

export function runDemandAgent(ctx: RunContext): Promise<AgentOutcome<DemandSummary>> {
  return runAgentLoop({
    agent: "demand",
    client: ctx.client,
    model: ctx.model,
    deadline: ctx.deadline,
    systemPrompt: SYSTEM,
    userMessage: `Decide the forecast method for each of these SKUs (plan ${ctx.planId}, as of ${ctx.asOf}):\n${runLinesText(ctx)}`,
    tools: demandTools(ctx),
    briefing: ctx.lines.map((l) => ({ tool: "get_demand_forecasts", args: { sku: l.sku } })),
    terminal: {
      name: "submit_demand_decisions",
      description: "Submit one decision per SKU: { sku, method: 'ml' | 'baseline', reason }. Methods only, never numbers.",
      declared: z.object({ decisions: z.array(demandTerminalDecision).min(1).max(30) }),
      schema: z.object({ decisions: z.array(z.record(z.string(), z.unknown())).min(1).max(30) }),
      apply: ({ decisions }: { decisions: Record<string, unknown>[] }) => applyDemandDecisions(ctx, decisions),
    },
    log: ctx.log,
  });
}
