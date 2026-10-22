// Approval and PO lifecycle against a real database (implementationplan.md §7.6, §7.6a).
// Skipped unless TEST_DATABASE_URL is set (it must point at a seeded PharmaOS database; the tests create plans
// and POs there, and briefly change app_state.po_approval_limit, always restoring it).
import { config } from "dotenv";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ServiceError } from "@/lib/api/errors";
import { approveLines } from "@/lib/services/approval";
import { createPlan, getPlan, recalculatePlan, rejectPlan } from "@/lib/services/plans";
import { approvePo, sendPo } from "@/lib/services/purchase-orders";

config({ path: ".env.local", quiet: true });
const url = process.env.TEST_DATABASE_URL;
const T = 180_000;

describe.skipIf(!url)("approval (integration)", () => {
  let sql: postgres.Sql;
  let originalLimit: string;
  const actor = { type: "user" as const, id: "integration-test" };

  const setLimit = (value: string) => sql`update app_state set po_approval_limit = ${value} where id = 1`;
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return "OK";
    } catch (err) {
      return err instanceof ServiceError ? err.code : String(err);
    }
  };
  /** A fresh plan and its buyable lines, grouped by supplier (largest group first). */
  async function freshPlan() {
    const { planId } = await createPlan({ priorities: "integration test" }, { type: "user", id: actor.id }, sql);
    const plan = await getPlan(planId, sql);
    const lines = plan.lines.filter((l) => l.counted && l.offerId);
    const bySupplier = new Map<string, typeof lines>();
    for (const l of lines) bySupplier.set(l.supplierId!, [...(bySupplier.get(l.supplierId!) ?? []), l]);
    return { planId, lines, groups: [...bySupplier.values()].sort((a, b) => b.length - a.length) };
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 4, onnotice: () => {} });
    [{ l: originalLimit }] = await sql<{ l: string }[]>`select po_approval_limit::text as l from app_state where id = 1`;
  }, T);
  afterAll(async () => {
    await setLimit(originalLimit);
    await sql.end();
  });

  it(
    "is idempotent: the same key returns the same POs and writes no extra rows; PO total = Σ lines",
    async () => {
      const { planId, groups } = await freshPlan();
      const pick = [groups[0][0].id, groups[1][0].id, groups[2][0].id];
      const key = crypto.randomUUID();
      const first = await approveLines(planId, pick, key, actor, sql);
      const [{ n: before }] = await sql<{ n: number }[]>`select count(*)::int as n from purchase_orders`;
      const second = await approveLines(planId, pick, key, actor, sql);
      const [{ n: after }] = await sql<{ n: number }[]>`select count(*)::int as n from purchase_orders`;
      expect(first.alreadyProcessed).toBe(false);
      expect(second.alreadyProcessed).toBe(true);
      expect(second.purchaseOrders.map((p) => p.id).sort()).toEqual(first.purchaseOrders.map((p) => p.id).sort());
      expect(after).toBe(before);
      expect(first.purchaseOrders).toHaveLength(3);
      for (const po of first.purchaseOrders) {
        const [{ sum, total }] = await sql<{ sum: string; total: string }[]>`
          select (select sum(line_total) from purchase_order_lines where po_id = ${po.id})::text as sum, grand_total::text as total
          from purchase_orders where id = ${po.id}`;
        expect(sum).toBe(total);
      }
      // A second approval of an approved line (new key) is refused.
      expect(await code(approveLines(planId, [pick[0]], crypto.randomUUID(), actor, sql))).toBe("LINE_LOCKED");
    },
    T,
  );

  it(
    "adds later lines to the supplier's open PO from the same plan; a sent PO is never changed",
    async () => {
      const { planId, groups } = await freshPlan();
      const g = groups.find((x) => x.length >= 3);
      if (!g) return; // the seeded plan always has a supplier with 3+ lines; guard anyway
      try {
        await setLimit("99999999.00"); // keep every PO "ready" so it can be sent below
        const first = await approveLines(planId, [g[0].id], crypto.randomUUID(), actor, sql);
        const key = crypto.randomUUID();
        const second = await approveLines(planId, [g[1].id], key, actor, sql);
        expect(second.purchaseOrders).toHaveLength(1);
        expect(second.purchaseOrders[0].id).toBe(first.purchaseOrders[0].id);
        expect(second.purchaseOrders[0].lines).toBe(2);
        const [{ sum, total }] = await sql<{ sum: string; total: string }[]>`
          select (select sum(line_total) from purchase_order_lines where po_id = ${first.purchaseOrders[0].id})::text as sum, grand_total::text as total
          from purchase_orders where id = ${first.purchaseOrders[0].id}`;
        expect(sum).toBe(total);
        // A replay of the merge returns the same PO and changes nothing.
        const replay = await approveLines(planId, [g[1].id], key, actor, sql);
        expect(replay.alreadyProcessed).toBe(true);
        expect(replay.purchaseOrders.map((p) => p.id)).toEqual([first.purchaseOrders[0].id]);
        // Once sent, the PO is closed: the next line for that supplier gets a new PO.
        await sendPo(first.purchaseOrders[0].id, actor, sql);
        const third = await approveLines(planId, [g[2].id], crypto.randomUUID(), actor, sql);
        expect(third.purchaseOrders[0].id).not.toBe(first.purchaseOrders[0].id);
        expect(third.purchaseOrders[0].lines).toBe(1);
      } finally {
        await setLimit(originalLimit);
      }
    },
    T,
  );

  it(
    "a rejected plan creates no POs",
    async () => {
      const { planId, lines } = await freshPlan();
      await rejectPlan(planId, "integration test reject", actor, sql);
      expect(await code(approveLines(planId, [lines[0].id], crypto.randomUUID(), actor, sql))).toBe("PLAN_LOCKED");
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from purchase_orders where source_plan_id = ${planId}`;
      expect(n).toBe(0);
    },
    T,
  );

  it(
    "gates POs above the limit: pending_approval → send refused → Owner approves → sent; exactly at the limit is ready",
    async () => {
      const { planId, groups } = await freshPlan();
      const [a, b] = groups;
      try {
        // Limit just below supplier A's PO: A needs approval.
        const aTotal = a.reduce((s, l) => s + Number(l.totals.lineTotal), 0);
        await setLimit((aTotal - 0.01).toFixed(2));
        const gated = await approveLines(planId, a.map((l) => l.id), crypto.randomUUID(), actor, sql);
        const po = gated.purchaseOrders[0];
        expect(po.status).toBe("pending_approval");
        expect(await code(sendPo(po.id, actor, sql))).toBe("APPROVAL_REQUIRED");
        expect((await approvePo(po.id, { note: "ok" }, actor, sql)).status).toBe("approved");
        const sent = await sendPo(po.id, actor, sql);
        expect(sent.status).toBe("sent");
        expect(sent.sentAt).not.toBeNull();
        expect(await code(sendPo(po.id, actor, sql))).toBe("PO_LOCKED");

        // Limit exactly equal to supplier B's PO: not above, so ready.
        const bTotal = b.reduce((s, l) => s + Math.round(Number(l.totals.lineTotal) * 100), 0) / 100;
        await setLimit(bTotal.toFixed(2));
        const atLimit = await approveLines(planId, b.map((l) => l.id), crypto.randomUUID(), actor, sql);
        expect(atLimit.purchaseOrders[0].grandTotal).toBe(bTotal.toFixed(2));
        expect(atLimit.purchaseOrders[0].status).toBe("ready");
      } finally {
        await setLimit(originalLimit);
      }
    },
    T,
  );

  it(
    "cross-plan: a SKU already on another plan's PO cannot be approved again (ALREADY_ON_ORDER names the PO); Recalculate fixes the plan",
    async (t) => {
      const made: string[] = [];
      try {
        // Two plans made before any approval propose the same lines.
        const a = await freshPlan();
        const b = await freshPlan();
        made.push(a.planId, b.planId);
        if (a.groups.length === 0) return t.skip(); // nothing left to buy in this database
        const lineA = a.groups[0][0];
        const lineB = b.lines.find((l) => l.productId === lineA.productId)!;
        expect(lineB).toBeDefined();

        const { purchaseOrders } = await approveLines(a.planId, [lineA.id], crypto.randomUUID(), actor, sql);
        const poNumber = purchaseOrders[0].poNumber;

        let err: ServiceError | undefined;
        await approveLines(b.planId, [lineB.id], crypto.randomUUID(), actor, sql).catch((e) => (err = e));
        expect(err?.code).toBe("ALREADY_ON_ORDER");
        expect(err?.status).toBe(409);
        expect(err?.message).toContain(lineB.sku);
        expect(err?.message).toContain(poNumber);
        const [conflict] = (err?.details as { conflicts: { lineId: string; pos: { poNumber: string }[]; stillNeeded: number }[] }).conflicts;
        expect(conflict.lineId).toBe(lineB.id);
        expect(conflict.pos.map((p) => p.poNumber)).toContain(poNumber);
        // Nothing was written for plan B.
        const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from purchase_orders where source_plan_id = ${b.planId}`;
        expect(n).toBe(0);

        // After Recalculate, plan B no longer asks for more than it still needs for that SKU.
        const after = await recalculatePlan(b.planId, { actor }, sql);
        const again = after.lines.find((l) => l.productId === lineA.productId && l.counted);
        expect(!again || again.qty <= conflict.stillNeeded).toBe(true);
        expect(after.alreadyOnOrder.some((i) => i.poNumber === poNumber)).toBe(true);
      } finally {
        if (made.length) {
          const pos = await sql<{ id: string }[]>`select id::text from purchase_orders where source_plan_id = any(${made}::uuid[])`;
          await sql`delete from approvals where entity_id = any(${pos.map((p) => p.id)}::uuid[])`;
          await sql`delete from purchase_orders where id = any(${pos.map((p) => p.id)}::uuid[])`;
          await sql`delete from purchase_plans where id = any(${made}::uuid[])`;
        }
      }
    },
    T,
  );
});
