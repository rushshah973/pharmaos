// The Agent Run panel's view logic (§9.5, P23B): agent status from the step log, decisions with the guardrail's
// verdict, the Order Agent's result and the plain fallback rule. Pure: no network, no database.
import { describe, expect, it } from "vitest";
import { type RunWithSteps, agentState, decisions, madeNoChanges, orderResult, toolResult } from "@/components/agents/run-view";
import type { AgentStep } from "@/lib/services/agent-runs";

let seq = 0;
const step = (s: Partial<AgentStep> & Pick<AgentStep, "agent" | "kind">): AgentStep => ({
  id: `s${++seq}`,
  seq,
  toolName: null,
  input: {},
  output: {},
  ok: true,
  ms: 10,
  createdAt: "2026-10-22T10:00:00.000Z",
  ...s,
});
const run = (status: RunWithSteps["status"], steps: AgentStep[]): RunWithSteps => ({
  id: "r1",
  planId: "p1",
  status,
  maxSkus: 15,
  skus: [{ lineId: "l1", sku: "PHX-0001", rank: 1 }],
  startedAt: "2026-10-22T10:00:00.000Z",
  finishedAt: status === "running" ? null : "2026-10-22T10:03:00.000Z",
  summary: null,
  error: null,
  steps,
});

describe("Agent Run panel view", () => {
  it("while running, the first unfinished agent is thinking and the others wait", () => {
    const r = run("running", [step({ agent: "demand", kind: "tool_call", toolName: "get_demand_forecasts" })]);
    expect([agentState(r, "demand"), agentState(r, "supplier"), agentState(r, "order")]).toEqual(["thinking", "waiting", "waiting"]);
    const r2 = run("running", [step({ agent: "demand", kind: "tool_call", toolName: "submit_demand_decisions" })]);
    expect([agentState(r2, "demand"), agentState(r2, "supplier")]).toEqual(["done", "thinking"]);
  });

  it("a fallback step marks the agent fallback", () => {
    const r = run("fallback", [step({ agent: "demand", kind: "fallback", output: { reason: "GEMINI_API_KEY is not set" }, ok: false })]);
    expect(agentState(r, "demand")).toBe("fallback");
    expect(madeNoChanges(r)).toBe(true);
  });

  it("decisions show the guardrail: accepted with the change, or rejected with its code", () => {
    const r = run("succeeded", [
      step({ agent: "demand", kind: "decision", input: { sku: "PHX-0001", method: "baseline", reason: "Spike is a one-off order" }, output: { changed: true, before: { qty: 50 }, after: { qty: 60 } } }),
      step({ agent: "demand", kind: "rejected_decision", input: { sku: "PHX-9999", method: "ml", reason: "ML error is lower here" }, output: { code: "SKU_NOT_IN_RUN", message: "…" }, ok: false }),
    ]);
    const rows = decisions(r, "demand");
    expect(rows[0]).toMatchObject({ sku: "PHX-0001", decision: "Average · 50 → 60 packs", accepted: true, changed: true, code: null });
    expect(rows[1]).toMatchObject({ sku: "PHX-9999", accepted: false, code: "SKU_NOT_IN_RUN" });
    expect(madeNoChanges(r)).toBe(false);
  });

  it("the Order Agent's summary gives the POs created, and tool results read as one line", () => {
    const created = [{ poId: "po1", poNumber: "PO-1", supplierCode: "SUP-01", status: "pending_approval", grandTotal: "450000.00", lines: 3 }];
    const r = run("succeeded", [step({ agent: "order", kind: "decision", output: { created, skipped: [] } })]);
    expect(orderResult(r)?.created[0].status).toBe("pending_approval");
    expect(agentState(r, "order")).toBe("done");
    expect(toolResult(step({ agent: "order", kind: "tool_call", toolName: "create_purchase_orders", output: { ok: true, data: { purchaseOrders: [{}, {}], alreadyProcessed: false } } }))).toBe("2 POs created");
    expect(toolResult(step({ agent: "demand", kind: "tool_call", toolName: "get_sales_history", output: { ok: false, error: { code: "INVALID_TOOL_INPUT", message: "days: too big" } } }))).toBe("INVALID_TOOL_INPUT: days: too big");
  });
});
