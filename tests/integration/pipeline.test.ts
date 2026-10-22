// F11 against a real database (implementationplan.md §9.5, §14.1): idempotent PO creation by the Order Agent, the
// no-key fallback, and one full run with a scripted fake Gemini client. Skipped unless TEST_DATABASE_URL is set.
// Every plan, PO and run these tests create is deleted again in afterAll (audit_logs is append-only, so their audit
// rows stay, attributed to integration-test / pipeline).
import { config } from "dotenv";
import type { Content } from "@google/genai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url; // the services use the app pool
const T = 300_000;

describe.skipIf(!url)("agent pipeline (integration)", () => {
  type Mods = {
    sqlMod: typeof import("@/lib/db/client");
    plans: typeof import("@/lib/services/plans");
    runs: typeof import("@/lib/services/agent-runs");
    run: typeof import("@/lib/agents/pipeline/run");
    order: typeof import("@/lib/agents/pipeline/order-agent");
  };
  let m: Mods;
  const planIds: string[] = [];

  beforeAll(async () => {
    m = {
      sqlMod: await import("@/lib/db/client"),
      plans: await import("@/lib/services/plans"),
      runs: await import("@/lib/services/agent-runs"),
      run: await import("@/lib/agents/pipeline/run"),
      order: await import("@/lib/agents/pipeline/order-agent"),
    };
  }, T);

  afterAll(async () => {
    const sql = m.sqlMod.getSql();
    if (planIds.length) {
      const recs = await sql<{ id: string }[]>`select id::text from purchase_recommendations where plan_id = any(${planIds}::uuid[])`;
      const pos = await sql<{ id: string }[]>`select id::text from purchase_orders where source_plan_id = any(${planIds}::uuid[])`;
      const runs = await sql<{ id: string }[]>`select id::text from agent_runs where plan_id = any(${planIds}::uuid[])`;
      const ids = [...planIds, ...recs.map((r) => r.id), ...pos.map((p) => p.id), ...runs.map((r) => r.id)];
      await sql`delete from purchase_orders where id = any(${pos.map((p) => p.id)}::uuid[])`;
      await sql`delete from approvals where entity_id = any(${ids}::uuid[])`;
      await sql`delete from purchase_plans where id = any(${planIds}::uuid[])`;
    }
    await sql.end();
  }, T);

  async function freshRun(maxSkus: number) {
    const { planId } = await m.plans.createPlan({ priorities: "pipeline integration test" }, { type: "user", id: "integration-test" });
    planIds.push(planId);
    const runId = await m.runs.createRun(planId, maxSkus);
    return { planId, runId };
  }

  it(
    "no API key → run status fallback, no changes, no POs",
    async () => {
      const { planId, runId } = await freshRun(3);
      await m.run.runPipeline(runId, { client: null });
      const run = await m.runs.getRun(runId);
      expect(run.status).toBe("fallback");
      expect(run.summary).toContain("AI unavailable");
      expect(run.steps.filter((s) => s.kind === "fallback").map((s) => s.agent)).toEqual(["demand", "supplier", "order"]);
      const [{ n }] = await m.sqlMod.getSql()<{ n: number }[]>`select count(*)::int as n from purchase_orders where source_plan_id = ${planId}`;
      expect(n).toBe(0);
    },
    T,
  );

  it(
    "create_purchase_orders twice with the same run id → the same POs",
    async () => {
      const { planId, runId } = await freshRun(3);
      const lines = await m.runs.selectRunLines(planId, 3);
      const log = { add: async () => {} };
      const ctx = { runId, planId, asOf: "", lines, client: { generateContent: async () => ({}) }, model: "fake", log };
      const create = m.order.orderTools(ctx).find((t) => t.name === "create_purchase_orders")!;
      const ids = lines.map((l) => l.lineId);
      const first = (await create.handler({ lineIds: ids } as never)) as { alreadyProcessed: boolean; purchaseOrders: { poId: string }[] };
      const second = (await create.handler({ lineIds: ids } as never)) as { alreadyProcessed: boolean; purchaseOrders: { poId: string }[] };
      expect(first.alreadyProcessed).toBe(false);
      expect(second.alreadyProcessed).toBe(true);
      expect(second.purchaseOrders.map((p) => p.poId).sort()).toEqual(first.purchaseOrders.map((p) => p.poId).sort());
    },
    T,
  );

  it(
    "a full run with a scripted model: Demand → Supplier → Order, succeeded, POs created by the Order Agent",
    async () => {
      const { planId, runId } = await freshRun(2);
      const lines = await m.runs.selectRunLines(planId, 2);
      const plan = await m.plans.getPlan(planId);
      const offerOf = (lineId: string) => plan.lines.find((l) => l.id === lineId)!.offerId!;
      const fc = (id: string, name: string, args: Record<string, unknown>) => ({ id, name, args });
      const reply = (...calls: { id: string; name: string; args: Record<string, unknown> }[]) => ({
        candidates: [{ content: { role: "model", parts: calls.map((c) => ({ functionCall: c })) }, finishReason: "STOP" }],
        functionCalls: calls,
      });
      // Reads the POs from the create_purchase_orders response in the conversation so far.
      const createdIds = (contents: Content[]) => {
        for (const c of contents)
          for (const p of c.parts ?? []) {
            const r = p.functionResponse?.response as { ok?: boolean; data?: { purchaseOrders?: { poId: string }[] } } | undefined;
            if (p.functionResponse?.name === "create_purchase_orders" && r?.ok) return r.data!.purchaseOrders!.map((x) => x.poId);
          }
        return [];
      };
      const script: ((contents: Content[]) => unknown)[] = [
        () => reply(fc("d1", "get_demand_forecasts", { sku: lines[0].sku })),
        () => reply(fc("d2", "submit_demand_decisions", { decisions: lines.map((l) => ({ sku: l.sku, method: "baseline", reason: "Average is the safer forecast here" })) })),
        () => reply(fc("s1", "compare_supplier_offers", { sku: lines[0].sku })),
        () => reply(fc("s2", "submit_supplier_decisions", { decisions: lines.map((l) => ({ sku: l.sku, offerId: offerOf(l.lineId), reason: "Current offer is the engine's pick" })) })),
        () => reply(fc("o1", "get_plan", {}), fc("o2", "validate_po", { lineIds: lines.map((l) => l.lineId) })),
        () => reply(fc("o3", "create_purchase_orders", { lineIds: lines.map((l) => l.lineId) })),
        (contents) => reply(fc("o4", "submit_order_summary", { created: createdIds(contents), skipped: [] })),
      ];
      let i = 0;
      const client = { generateContent: async (req: { contents: Content[] }) => script[i++](req.contents) as never };
      await m.run.runPipeline(runId, { client, model: "fake" });

      const run = await m.runs.getRun(runId);
      expect(run.status).toBe("succeeded");
      expect(run.steps.map((s) => s.agent)).toEqual(expect.arrayContaining(["demand", "supplier", "order"]));
      expect(run.steps.filter((s) => s.kind === "decision").length).toBeGreaterThanOrEqual(lines.length * 2 + 1);
      const pos = await m.sqlMod.getSql()<{ status: string }[]>`select status from purchase_orders where source_plan_id = ${planId}`;
      expect(pos.length).toBeGreaterThan(0);
      for (const p of pos) expect(["ready", "pending_approval"]).toContain(p.status);
      expect(run.summary).toContain("Order Agent: created");
    },
    T,
  );
});
