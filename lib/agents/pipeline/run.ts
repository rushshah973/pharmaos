// runPipeline (implementationplan.md §9.5): the top N proposed lines go through Demand → Supplier → Order; each agent
// sees the database state the previous one left. Fallback (no key, API error, timeout, non-STOP finish, or an invalid
// terminal call after 2 retries) → the remaining agents make no changes and the Order Agent creates NO POs; the run
// ends 'fallback'. 'failed' only on an unexpected server error (stored). Audited agent.run_started / run_finished.
// After the Order Agent, every PO of the run that may be sent (ready, within the Owner limit) is sent automatically
// (simulated, nothing leaves the app, audited po.sent by order-agent); POs above the limit wait for the Owner.
import { formatINR } from "@/lib/money";
import { resolvePlanningState } from "@/lib/services/as-of";
import { type AgentName, StepLog, finishRun, getRun, selectRunLines, setRunSkus } from "@/lib/services/agent-runs";
import { AGENT_SENDER, sendPo } from "@/lib/services/purchase-orders";
import type { RunContext } from "./context";
import { type DemandSummary, runDemandAgent } from "./demand-agent";
import { DEFAULT_GEMINI_MODEL } from "../retry";
import { type ModelClient, geminiClient } from "./loop";
import { type OrderSummary, runOrderAgent } from "./order-agent";
import { type SupplierSummary, runSupplierAgent } from "./supplier-agent";

export const AI_UNAVAILABLE = "AI unavailable — review and approve manually.";
/** The run must finish within the agents/run route's maxDuration (300 s), with room to record the outcome. */
export const RUN_BUDGET_MS = 270_000;

export async function runPipeline(runId: string, deps: { client?: ModelClient | null; model?: string } = {}): Promise<void> {
  const deadline = Date.now() + RUN_BUDGET_MS;
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

    const ctx: RunContext = { runId, planId: run.planId, asOf: state.asOf, lines, client, model: deps.model ?? (process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL), log, deadline };

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
    const sent = await sendReadyPos(ctx, order.result);
    await finishRun(runId, "succeeded", `${demandText(demand.result)} ${supplierText(supplier.result)} ${orderText(sent, state.approvalLimit)}`);
  } catch (err) {
    console.error("[agent run]", err);
    await finishRun(runId, "failed", "The run stopped on a server error; nothing after the error was applied.", err instanceof Error ? err.message.slice(0, 500) : String(err)).catch(() => {});
  }
}

/** Sends the run's ready POs (simulated) and records it in the trace; the result shows each PO's new status. */
async function sendReadyPos(ctx: RunContext, o: OrderSummary): Promise<OrderSummary> {
  const created: OrderSummary["created"] = [];
  for (const po of o.created) {
    if (po.status !== "ready") {
      created.push(po);
      continue;
    }
    const t0 = performance.now();
    try {
      const r = await sendPo(po.poId, AGENT_SENDER);
      created.push({ ...po, status: r.status });
      await ctx.log.add({ agent: "order", kind: "tool_call", toolName: "send_purchase_order", input: { poId: po.poId, poNumber: po.poNumber, automatic: true }, output: { ok: true, data: { status: "sent", simulated: true } }, ok: true, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      created.push(po);
      await ctx.log.add({ agent: "order", kind: "tool_call", toolName: "send_purchase_order", input: { poId: po.poId, poNumber: po.poNumber, automatic: true }, output: { ok: false, error: { message: err instanceof Error ? err.message : String(err) } }, ok: false, ms: Math.round(performance.now() - t0) });
    }
  }
  const result = { ...o, created };
  // The final word on the run's POs (the panel reads the last order decision).
  await ctx.log.add({ agent: "order", kind: "decision", input: { autoSend: true }, output: result });
  return result;
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
  const fresh = o.created.filter((p) => !p.addedTo);
  const added = o.created.filter((p) => p.addedTo);
  const list = (ps: typeof o.created) => ps.map((p) => `${p.poNumber} ${p.supplierCode} ${formatINR(p.grandTotal)}`).join("; ");
  const parts = [
    fresh.length ? `created ${fresh.length} new purchase order${fresh.length === 1 ? "" : "s"} (${list(fresh)})` : "",
    added.length ? `added lines to ${added.length} existing purchase order${added.length === 1 ? "" : "s"} of this plan (${list(added)})` : "",
  ].filter(Boolean);
  const sent = o.created.filter((p) => p.status === "sent");
  return (
    `Order Agent: ${parts.join(" and ")}; ` +
    (sent.length ? `sent ${sent.length} to the supplier${sent.length === 1 ? "" : "s"} automatically (simulated, nothing was emailed); ` : "") +
    (gated.length ? `${gated.map((p) => p.poNumber).join(", ")} wait${gated.length === 1 ? "s" : ""} for the Owner's approval (above ${formatINR(limit, { paise: false })}) and will be sent once approved.` : `none needs the Owner's approval.`) +
    (o.skipped.length ? ` Skipped: ${o.skipped.map((s) => `${s.sku} (${s.reason})`).join("; ")}.` : "")
  );
};
