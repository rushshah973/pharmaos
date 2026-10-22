// Pure helpers that turn an agent run's step log (agent_steps) into what the Agent Run panel shows:
// each agent's status, its tool timeline, its decisions (accepted or rejected by the guardrail) and the results.
import type { AgentName, AgentRun, AgentStep } from "@/lib/services/agent-runs";

export type RunWithSteps = AgentRun & { steps: AgentStep[] };
export type AgentState = "waiting" | "thinking" | "done" | "fallback";

export const AGENTS: { name: AgentName; title: string; role: string; terminal: string }[] = [
  { name: "demand", title: "Demand Agent", role: "Checks each medicine's sales and picks the more accurate forecast: ML or the average.", terminal: "submit_demand_decisions" },
  { name: "supplier", title: "Supplier Agent", role: "Compares supplier offers for that forecast and keeps or switches to the best valid one.", terminal: "submit_supplier_decisions" },
  { name: "order", title: "Order Agent", role: "Creates one purchase order per supplier. It cannot send a PO or approve one for the Owner.", terminal: "submit_order_summary" },
];

function finishedState(run: RunWithSteps, agent: AgentName): AgentState | null {
  const steps = run.steps.filter((s) => s.agent === agent);
  if (steps.some((s) => s.kind === "fallback")) return "fallback";
  const terminal = AGENTS.find((a) => a.name === agent)!.terminal;
  if (steps.some((s) => s.kind === "tool_call" && s.toolName === terminal && s.ok)) return "done";
  if (agent === "order" && steps.some((s) => s.kind === "decision")) return "done";
  return null;
}

/** Done / fallback from the agent's own steps; while the run is going, the first unfinished agent is thinking. */
export function agentState(run: RunWithSteps, agent: AgentName): AgentState {
  const own = finishedState(run, agent);
  if (own) return own;
  if (run.status !== "running") return "waiting";
  const firstOpen = AGENTS.find((a) => finishedState(run, a.name) === null)?.name;
  return firstOpen === agent ? "thinking" : "waiting";
}

type Rec = Record<string, unknown>;
const obj = (x: unknown): Rec => (x && typeof x === "object" ? (x as Rec) : {});
const n1 = (x: unknown) => (typeof x === "number" ? (Number.isInteger(x) ? String(x) : x.toFixed(1)) : "—");
const pct = (x: unknown) => (typeof x === "number" ? `${Math.round(x * 100)}%` : "—");

/** One line describing a tool call's result, in plain words. */
export function toolResult(step: AgentStep): string {
  const out = obj(step.output);
  if (out.ok === false) {
    const e = obj(out.error);
    return `${e.code ?? "ERROR"}: ${String(e.message ?? "").slice(0, 120)}`;
  }
  const d = obj(out.data);
  const input = obj(step.input);
  switch (step.toolName) {
    case "get_demand_forecasts":
      return `${d.sku}: ML ${n1(d.mlDaily)}/day (error ${pct(d.mlWape)}) vs average ${n1(d.baselineDaily)}/day (error ${pct(d.baselineWape)}); default ${d.defaultMethod === "ml" ? "ML blend" : "average"}`;
    case "get_sales_history":
      return `${input.sku}: ${Array.isArray(d.days) ? d.days.length : (input.days ?? "")} days of sales`;
    case "get_inventory_position":
      return `${d.sku}: ${n1(d.eligibleAvailable)} available + ${n1(d.incoming)} on order · runs out in ${n1(d.coverDays)} d · lead ${n1(d.fastestLeadDays)} d`;
    case "compare_supplier_offers": {
      const offers = Array.isArray(d.offers) ? d.offers : [];
      const usable = offers.filter((o) => !(obj(o).exclusions as unknown[] | undefined)?.length).length;
      return `${input.sku}: ${offers.length} offers, ${usable} usable`;
    }
    case "get_po_projection": {
      const pos = Array.isArray(d.supplierPos) ? d.supplierPos : [];
      const gated = pos.filter((p) => obj(p).ownerApproval === "required").length;
      return `${pos.length} supplier POs projected${gated ? `, ${gated} need the Owner` : ", none needs the Owner"}`;
    }
    case "get_approval_limit":
      return `Owner approval above ${d.formatted ?? d.approvalLimit ?? "the limit"}`;
    case "get_plan": {
      const lines = Array.isArray(d.runLines) ? d.runLines : [];
      const pos = Array.isArray(d.supplierPos) ? d.supplierPos : [];
      const gated = pos.filter((p) => obj(p).ownerApproval === "required").length;
      return `${lines.length} run lines · ${pos.length} supplier POs projected${gated ? `, ${gated} need the Owner` : ""}`;
    }
    case "validate_po": {
      const lines = Array.isArray(d.lines) ? d.lines : [];
      const failing = lines.filter((l) => (obj(l).hardStops as unknown[] | undefined)?.length).length;
      return `${lines.length} lines checked · ${failing ? `${failing} fail a hard stop` : "no hard stops"}`;
    }
    case "create_purchase_orders": {
      const pos = Array.isArray(d.purchaseOrders) ? d.purchaseOrders : [];
      return `${pos.length} PO${pos.length === 1 ? "" : "s"} ${d.alreadyProcessed ? "already created (same run)" : "created"}`;
    }
    default:
      if (step.toolName?.startsWith("submit_")) {
        const acc = d.accepted ?? (Array.isArray(d.created) ? d.created.length : undefined);
        return typeof d.accepted === "number" ? `${d.accepted} accepted · ${d.rejected ?? 0} rejected` : acc !== undefined ? `Summary submitted (${acc} POs)` : "Submitted";
      }
      return "OK";
  }
}

export type DecisionRow = { key: string; sku: string; decision: string; reason: string; accepted: boolean; code: string | null; changed: boolean };

/** The agent's decisions from its decision / rejected_decision steps. */
export function decisions(run: RunWithSteps, agent: AgentName): DecisionRow[] {
  return run.steps
    .filter((s) => s.agent === agent && (s.kind === "decision" || s.kind === "rejected_decision") && agent !== "order")
    .map((s) => {
      const i = obj(s.input);
      const o = obj(s.output);
      const accepted = s.kind === "decision";
      let decision = "";
      if (agent === "demand") {
        const label = (m: unknown) => (m === "ml" ? "ML" : m === "baseline" ? "Average" : String(m ?? "?"));
        const method = label(i.method);
        const before = obj(o.before);
        const after = obj(o.after);
        decision = accepted && o.changed ? `${before.method ? `${label(before.method)} → ` : ""}${label(after.method ?? i.method)} · ${before.qty} → ${after.qty} packs` : `${method}${accepted ? " · no change" : ""}`;
      } else {
        decision = accepted && o.changed ? `${o.from ?? "—"} → ${o.to}` : accepted ? `Keep ${o.supplierCode ?? "offer"}` : `Offer ${String(i.offerId ?? "").slice(0, 8)}`;
      }
      return {
        key: s.id,
        sku: String(i.sku ?? "—"),
        decision,
        reason: String(i.reason ?? o.message ?? ""),
        accepted,
        code: accepted ? null : String(o.code ?? "REJECTED"),
        changed: accepted && o.changed === true,
      };
    });
}

export type OrderResult = {
  /** addedTo: the run added lines to a PO an earlier approval of the plan created (absent in older runs). */
  created: { poId: string; poNumber: string; supplierCode: string; status: string; grandTotal: string; lines: number; addedTo?: boolean }[];
  skipped: { sku: string; reason: string }[];
};

export function orderResult(run: RunWithSteps): OrderResult | null {
  const s = [...run.steps].reverse().find((x) => x.agent === "order" && x.kind === "decision");
  if (!s) return null;
  const o = obj(s.output);
  return { created: (o.created as OrderResult["created"]) ?? [], skipped: (o.skipped as OrderResult["skipped"]) ?? [] };
}

/** True when no agent decision changed the plan and no PO was created. */
export function madeNoChanges(run: RunWithSteps): boolean {
  return !run.steps.some((s) => s.kind === "decision" && obj(s.output).changed === true) && !(orderResult(run)?.created.length);
}

/** One plain sentence for an agent's card: what it looked at and what it changed. */
export function agentHeadline(run: RunWithSteps, agent: AgentName, state: AgentState): string {
  if (state === "waiting") return "Starts when the agent before it is done.";
  if (state === "fallback") return "AI unavailable, so this agent made no changes.";
  if (agent === "order") {
    const r = orderResult(run);
    if (!r) return state === "thinking" ? "Checking the lines and creating purchase orders…" : "No purchase orders were created.";
    const owner = r.created.filter((p) => p.status === "pending_approval").length;
    const fresh = r.created.filter((p) => !p.addedTo).length;
    const added = r.created.length - fresh;
    if (r.created.length === 0) return `No purchase orders created${r.skipped.length ? ` · skipped ${r.skipped.length}` : ""}`;
    const parts = [
      fresh ? `Created ${fresh} new purchase order${fresh === 1 ? "" : "s"}` : "",
      added ? `${fresh ? "added" : "Added"} lines to ${added} existing PO${added === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    return `${parts.join(" · ")} · ${owner ? `${owner} need${owner === 1 ? "s" : ""} the Owner` : "none need the Owner"}${r.skipped.length ? ` · skipped ${r.skipped.length}` : ""}`;
  }
  const rows = decisions(run, agent);
  if (rows.length === 0) return state === "thinking" ? "Reading the evidence and deciding…" : "No decisions recorded.";
  const changed = rows.filter((r) => r.changed).length;
  const refused = rows.filter((r) => !r.accepted).length;
  const what = agent === "demand" ? ["changed", "forecast", "kept every forecast"] : ["switched", "supplier", "kept every supplier"];
  const middle = changed ? `${what[0]} ${changed} ${what[1]}${changed === 1 ? "" : "s"}` : what[2];
  return `Checked ${rows.length} medicine${rows.length === 1 ? "" : "s"} · ${middle}${refused ? ` · ${refused} refused by the guardrail` : ""}`;
}
