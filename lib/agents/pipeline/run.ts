// runPipeline (implementationplan.md §9.5): the top N proposed lines go through Demand → Supplier → Order; each agent
// sees the database state the previous one left. Fallback (no key, API error, timeout, non-STOP finish, or an invalid
// terminal call after 2 retries) → the remaining agents make no changes and the Order Agent creates NO POs; the run
// ends 'fallback'. 'failed' only on an unexpected server error (stored). Audited agent.run_started / run_finished.
import { formatINR } from "@/lib/money";
import { resolvePlanningState } from "@/lib/services/as-of";
import { type AgentName, StepLog, finishRun, getRun, selectRunLines, setRunSkus } from "@/lib/services/agent-runs";
import type { RunContext } from "./context";
import { type DemandSummary, runDemandAgent } from "./demand-agent";
import { type ModelClient, geminiClient } from "./loop";
import { type OrderSummary, runOrderAgent } from "./order-agent";
import { type SupplierSummary, runSupplierAgent } from "./supplier-agent";

export const AI_UNAVAILABLE = "AI unavailable — review and approve manually.";

export async function runPipeline(runId: string, deps: { client?: ModelClient | null; model?: string } = {}): Promise<void> {
  const log = new StepLog(runId);
  try {
    const run = await getRun(runId);
    const [lines, state] = await Promise.all([selectRunLines(run.planId, run.maxSkus), resolvePlanningState()]);
    await setRunSkus(runId, lines.map((l) => ({ lineId: l.lineId, sku: l.sku, rank: l.rank })));
    if (lines.length === 0) return await finishRun(runId, "succeeded", "Nothing to do: the plan has no proposed lines left for the agents.");

    const client = deps.client !== undefined ? deps.client : geminiClient();
    const skipRest = async (agents: AgentName[], reason: string) => {
      for (const agent of agents) await log.add({ agent, kind: "fallback", output: { reason, effect: agent === "order" ? "No purchase orders created." : "No changes made." }, ok: false });
    };
    if (!client) {
      await skipRest(["demand", "supplier", "order"], "GEMINI_API_KEY is not set");
      return await finishRun(runId, "fallback", `${AI_UNAVAILABLE} The agents made no changes and created no purchase orders.`);
    }

    const ctx: RunContext = { runId, planId: run.planId, asOf: state.asOf, lines, client, model: deps.model ?? (process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest"), log };

    const demand = await runDemandAgent(ctx);
    if (demand.status === "fallback") {
      await skipRest(["supplier", "order"], `the Demand Agent fell back (${demand.reason})`);
      return await finishRun(runId, "fallback", `${AI_UNAVAILABLE} Demand Agent: ${demand.reason}. No changes made and no purchase orders created.`);
    }
    const supplier = await runSupplierAgent(ctx);
    if (supplier.status === "fallback") {
      await skipRest(["order"], `the Supplier Agent fell back (${supplier.reason})`);
      return await finishRun(runId, "fallback", `${AI_UNAVAILABLE} ${demandText(demand.result)} Supplier Agent: ${supplier.reason}. No purchase orders created.`);
    }
    const order = await runOrderAgent(ctx);
    if (order.status === "fallback") {
      return await finishRun(runId, "fallback", `${AI_UNAVAILABLE} ${demandText(demand.result)} ${supplierText(supplier.result)} Order Agent: ${order.reason}.`);
    }
    await finishRun(runId, "succeeded", `${demandText(demand.result)} ${supplierText(supplier.result)} ${orderText(order.result, state.approvalLimit)}`);
  } catch (err) {
    console.error("[agent run]", err);
    await finishRun(runId, "failed", "The run stopped on a server error; nothing after the error was applied.", err instanceof Error ? err.message.slice(0, 500) : String(err)).catch(() => {});
  }
}

const demandText = (d: DemandSummary) =>
  d.changed.length === 0
    ? `Demand Agent: kept every line's forecast (${d.accepted} accepted, ${d.rejected} rejected).`
    : `Demand Agent: changed the forecast on ${d.changed.length} line${d.changed.length === 1 ? "" : "s"} (${d.changed.map((c) => `${c.sku} ${c.from}→${c.to}, ${c.qtyBefore}→${c.qtyAfter} packs`).join("; ")}); ${d.rejected} rejected.`;

const supplierText = (s: SupplierSummary) =>
  s.switched.length === 0
    ? `Supplier Agent: kept every offer (${s.accepted} accepted, ${s.rejected} rejected).`
    : `Supplier Agent: switched ${s.switched.length} line${s.switched.length === 1 ? "" : "s"} (${s.switched.map((x) => `${x.sku} ${x.from}→${x.to}`).join("; ")}); ${s.rejected} rejected.`;

const orderText = (o: OrderSummary, limit: string) => {
  if (o.created.length === 0) return `Order Agent: no purchase orders created${o.skipped.length ? ` (${o.skipped.length} skipped)` : ""}.`;
  const gated = o.created.filter((p) => p.status === "pending_approval");
  return (
    `Order Agent: created ${o.created.length} purchase order${o.created.length === 1 ? "" : "s"} (${o.created.map((p) => `${p.poNumber} ${p.supplierCode} ${formatINR(p.grandTotal)}`).join("; ")}); ` +
    (gated.length ? `${gated.map((p) => p.poNumber).join(", ")} need${gated.length === 1 ? "s" : ""} the Owner's approval (above ${formatINR(limit, { paise: false })}).` : `none needs the Owner's approval.`) +
    (o.skipped.length ? ` Skipped: ${o.skipped.map((s) => `${s.sku} (${s.reason})`).join("; ")}.` : "")
  );
};
