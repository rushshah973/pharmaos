// approveLines (implementationplan.md §7.6) — the ONLY code that creates purchase orders.
// One transaction: lock the plan, honour the idempotency key, re-check every line against fresh data and all
// hard stops, then ONE open PO per supplier per plan: lines approved later for a supplier that already has an
// unsent, not-yet-Owner-approved PO from this plan are added to it (totals and the Owner rule re-applied);
// otherwise a new PO is created (ready, or pending_approval above the Owner limit). Called by the approve route
// (a person) and by the pipeline's Order Agent (P22B) — same function, same checks; the actor is recorded.
import type postgres from "postgres";
import { ServiceError, notFound } from "@/lib/api/errors";
import { addDays } from "@/lib/business-logic/dates";
import { lineTotals, needsOwnerApproval } from "@/lib/business-logic/totals";
import type { HardStopCode, LineTotals, Money, OfferInput } from "@/lib/business-logic/types";
import { hardStops } from "@/lib/business-logic/validation";
import { getSql } from "@/lib/db/client";
import { sumMoney } from "@/lib/money";
import { resolvePlanningState } from "./as-of";
import { writeAudit } from "./audit";
import { loadPlanningContext } from "./context";
import type { Actor } from "./plans";

export type ApprovalActor = { type: "user"; id: string } | { type: "agent"; id: "order-agent" };

export type CreatedPo = {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  status: "ready" | "pending_approval" | "approved" | "sent" | "rejected";
  grandTotal: Money;
  lines: number;
  expectedDeliveryDate: string;
  needsApproval: boolean;
};

export type ApproveResult = { purchaseOrders: CreatedPo[]; alreadyProcessed: boolean };

type LineRow = {
  id: string;
  product_id: string;
  sku: string;
  offer_id: string | null;
  qty: number;
  free_qty: number;
  in_basket: boolean;
  status: string;
  on_po: boolean;
};

async function posForIds(sql: postgres.TransactionSql | postgres.Sql, poIds: string[], approvalLimit: Money): Promise<CreatedPo[]> {
  const rows = await sql<
    { id: string; po_number: string; supplier_id: string; code: string; name: string; status: CreatedPo["status"]; grand_total: string; lines: number; expected: string }[]
  >`
    select po.id, po.po_number, po.supplier_id, s.supplier_code as code, s.name, po.status, po.grand_total::text as grand_total,
      (select count(*)::int from purchase_order_lines l where l.po_id = po.id) as lines,
      to_char(po.expected_delivery_date, 'YYYY-MM-DD') as expected
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.id = any(${poIds}::uuid[])
    order by po.grand_total desc, s.supplier_code
  `;
  return rows.map((r) => ({
    id: r.id,
    poNumber: r.po_number,
    supplierId: r.supplier_id,
    supplierCode: r.code,
    supplierName: r.name,
    status: r.status,
    grandTotal: r.grand_total,
    lines: r.lines,
    expectedDeliveryDate: r.expected,
    needsApproval: needsOwnerApproval(r.grand_total, approvalLimit),
  }));
}

export async function approveLines(
  planId: string,
  lineIds: string[],
  idempotencyKey: string,
  actor: ApprovalActor | Actor = { type: "user", id: process.env.DEMO_USER ?? "demo.owner" },
  sql: postgres.Sql = getSql(),
): Promise<ApproveResult> {
  const ids = [...new Set(lineIds)];
  if (ids.length === 0) throw new ServiceError("NO_LINES", 400, "Select at least one line to approve.");

  return sql.begin(async (tx) => {
    // 1. Lock the plan; 2. a replay of the same request returns the POs it already created or added to. The
    // request's audit row (plan.lines_approved, written in this same transaction) is the idempotency record.
    const [[plan], state, prior] = await Promise.all([
      tx<{ id: string; status: string }[]>`select id, status from purchase_plans where id = ${planId} for update`,
      resolvePlanningState(tx),
      tx<{ ids: string[] | null }[]>`
        select coalesce(
          (select array_agg(e->>'id') from audit_logs a, jsonb_array_elements(a.after_json->'purchaseOrders') e
            where a.action = 'plan.lines_approved' and a.entity_type = 'plan' and a.entity_id = ${planId}
              and a.after_json->>'idempotencyKey' = ${idempotencyKey}),
          (select array_agg(id::text) from purchase_orders where idempotency_key = ${idempotencyKey})
        ) as ids
      `,
    ]);
    if (!plan) throw notFound("Plan", planId);
    if (prior[0]?.ids?.length) return { purchaseOrders: await posForIds(tx, prior[0].ids, state.approvalLimit), alreadyProcessed: true };
    if (plan.status === "approved" || plan.status === "rejected") {
      throw new ServiceError("PLAN_LOCKED", 409, `The plan is ${plan.status}; no more lines can be approved.`);
    }

    // 3. The selected lines must be buyable, proposed or edited, and not on a PO already.
    const lines = await tx<LineRow[]>`
      select r.id, r.product_id, p.sku, r.selected_offer_id as offer_id, r.suggested_qty as qty, r.free_qty, r.in_basket, r.status,
        exists (select 1 from purchase_order_lines l where l.recommendation_id = r.id) as on_po
      from purchase_recommendations r join products p on p.id = r.product_id
      where r.plan_id = ${planId} and r.id = any(${ids}::uuid[])
      for update of r
    `;
    const missing = ids.filter((id) => !lines.some((l) => l.id === id));
    if (missing.length > 0) throw new ServiceError("LINE_NOT_FOUND", 404, "Some selected lines are not in this plan.", { lineIds: missing });
    const locked = lines.filter((l) => l.on_po || l.status === "approved_for_po");
    if (locked.length > 0) {
      throw new ServiceError("LINE_LOCKED", 409, "Some lines are already on a purchase order.", { lineIds: locked.map((l) => l.id) });
    }
    const notBuyable = lines.filter((l) => !l.in_basket || !["proposed", "edited"].includes(l.status) || !l.offer_id);
    if (notBuyable.length > 0) {
      throw new ServiceError("LINE_NOT_APPROVABLE", 409, "Only lines in the plan (proposed or edited, with a supplier) can be approved.", {
        lineIds: notBuyable.map((l) => l.id),
      });
    }

    // 4. Re-check every line against FRESH data and every hard stop.
    const ctx = await loadPlanningContext(tx, state.asOf, state.scenarioId, [...new Set(lines.map((l) => l.product_id))]);
    const skuById = new Map(ctx.skus.map((s) => [s.product.id, s]));
    const failures: { lineId: string; sku: string; codes: HardStopCode[] }[] = [];
    const priced: { line: LineRow; offer: OfferInput; totals: LineTotals; supplierId: string; lead: number }[] = [];
    for (const line of lines) {
      const sku = skuById.get(line.product_id);
      const offer = sku?.offers.find((o) => o.id === line.offer_id);
      const codes = hardStops({
        product: sku?.product,
        offer,
        supplier: offer ? sku?.suppliers[offer.supplierId] : undefined,
        qty: line.qty,
        asOf: state.asOf,
        batches: sku?.batches ?? [],
      });
      if (!sku || !offer || codes.length > 0) {
        failures.push({ lineId: line.id, sku: line.sku, codes: codes.length ? codes : ["INVALID_SKU"] });
        continue;
      }
      // The PO uses the current quote, through the same totals function as the plan.
      const totals = lineTotals({ qty: line.qty, unitPrice: offer.unitPrice!, taxRate: offer.taxRate, freightPerPack: offer.freightPerPack });
      priced.push({ line, offer, totals, supplierId: offer.supplierId, lead: offer.leadTimeDays });
    }
    if (failures.length > 0) {
      throw new ServiceError("HARD_STOP", 422, `${failures.length} line(s) fail a hard stop and cannot be approved.`, { failures });
    }

    // 5–6. One open PO per supplier per plan. An unsent PO from this plan that the Owner has not decided on yet
    // (ready / pending_approval) takes the new lines; otherwise a new PO is numbered from po_number_seq.
    const bySupplier = new Map<string, typeof priced>();
    for (const p of priced) bySupplier.set(p.supplierId, [...(bySupplier.get(p.supplierId) ?? []), p]);
    const supplierIds = [...bySupplier.keys()];
    const openPos = await tx<{ id: string; supplier_id: string; status: string; subtotal: string; tax_total: string; freight_total: string; grand_total: string; expected: string | null }[]>`
      select id, supplier_id, status, subtotal::text, tax_total::text, freight_total::text, grand_total::text,
        to_char(expected_delivery_date, 'YYYY-MM-DD') as expected
      from purchase_orders
      where source_plan_id = ${planId} and supplier_id = any(${supplierIds}::uuid[]) and status in ('ready', 'pending_approval')
      order by supplier_id, created_at
      for update
    `;
    // The oldest open PO per supplier takes the lines (FOR UPDATE cannot be combined with DISTINCT ON).
    const openBySupplier = new Map<string, (typeof openPos)[number]>();
    for (const o of openPos) if (!openBySupplier.has(o.supplier_id)) openBySupplier.set(o.supplier_id, o);
    const created: { id: string; supplierId: string; status: string; grandTotal: Money; lines: number; merged: boolean }[] = [];
    for (const [supplierId, group] of [...bySupplier].sort((a, b) => a[0].localeCompare(b[0]))) {
      const open = openBySupplier.get(supplierId);
      const subtotal = sumMoney([open?.subtotal ?? "0", ...group.map((g) => g.totals.lineSubtotal)]).toFixed(2);
      const tax = sumMoney([open?.tax_total ?? "0", ...group.map((g) => g.totals.lineTax)]).toFixed(2);
      const freight = sumMoney([open?.freight_total ?? "0", ...group.map((g) => g.totals.lineFreight)]).toFixed(2);
      const grandTotal = sumMoney([open?.grand_total ?? "0", ...group.map((g) => g.totals.lineTotal)]).toFixed(2);
      const status = needsOwnerApproval(grandTotal, state.approvalLimit) ? "pending_approval" : "ready";
      const newest = addDays(state.asOf, Math.max(...group.map((g) => g.lead)));
      const expected = open?.expected && open.expected > newest ? open.expected : newest;
      const poId = open?.id ?? crypto.randomUUID();
      // .execute() sends each raw query in array order (see plans.ts on pipelining).
      await Promise.all([
        open
          ? tx`
              update purchase_orders set status = ${status}, subtotal = ${subtotal}, tax_total = ${tax}, freight_total = ${freight},
                grand_total = ${grandTotal}, expected_delivery_date = ${expected}, approved_by = ${actor.id}, approved_at = now()
              where id = ${poId}
            `.execute()
          : tx`
              insert into purchase_orders (id, po_number, supplier_id, status, subtotal, tax_total, freight_total, grand_total,
                expected_delivery_date, source_plan_id, idempotency_key, approved_by, approved_at)
              values (${poId}, 'PO-' || to_char(now(), 'YYYYMMDD') || '-' || nextval('po_number_seq'), ${supplierId}, ${status},
                ${subtotal}, ${tax}, ${freight}, ${grandTotal}, ${expected}, ${planId}, ${idempotencyKey}, ${actor.id}, now())
            `.execute(),
        tx`
          insert into purchase_order_lines (po_id, product_id, supplier_offer_id, recommendation_id, quantity_packs, free_qty,
            unit_price, tax_rate, line_subtotal, line_tax, line_freight, line_total)
          select ${poId}::uuid, x.product_id, x.offer_id, x.recommendation_id, x.qty, x.free_qty, x.unit_price, x.tax_rate,
            x.line_subtotal, x.line_tax, x.line_freight, x.line_total
          from jsonb_to_recordset(${tx.json(
            group.map((g) => ({
              product_id: g.line.product_id,
              offer_id: g.offer.id,
              recommendation_id: g.line.id,
              qty: g.line.qty,
              free_qty: g.line.free_qty,
              unit_price: g.offer.unitPrice,
              tax_rate: g.offer.taxRate,
              line_subtotal: g.totals.lineSubtotal,
              line_tax: g.totals.lineTax,
              line_freight: g.totals.lineFreight,
              line_total: g.totals.lineTotal,
            })),
          )}) as x(product_id uuid, offer_id uuid, recommendation_id uuid, qty int, free_qty int, unit_price numeric, tax_rate numeric,
                   line_subtotal numeric, line_tax numeric, line_freight numeric, line_total numeric)
        `.execute(),
        writeAudit(
          open
            ? {
                actorType: actor.type,
                actorId: actor.id,
                action: "po.lines_added",
                entityType: "purchase_order",
                entityId: poId,
                before: { status: open.status, grandTotal: open.grand_total },
                after: { status, supplierId, grandTotal, linesAdded: group.length, planId, approvalLimit: state.approvalLimit, needsApproval: status === "pending_approval" },
              }
            : {
                actorType: actor.type,
                actorId: actor.id,
                action: "po.created",
                entityType: "purchase_order",
                entityId: poId,
                after: { status, supplierId, grandTotal, lines: group.length, planId, approvalLimit: state.approvalLimit, needsApproval: status === "pending_approval" },
              },
          tx,
        ),
      ]);
      created.push({ id: poId, supplierId, status, grandTotal, lines: group.length, merged: !!open });
    }

    // 7. Lines → approved_for_po (totals at the PO price), approvals rows, plan status, audit.
    await Promise.all([
      tx`
        update purchase_recommendations r set
          status = 'approved_for_po',
          unit_price = x.unit_price, line_subtotal = x.line_subtotal, line_tax = x.line_tax, line_freight = x.line_freight, line_total = x.line_total,
          updated_at = now()
        from jsonb_to_recordset(${tx.json(
          priced.map((g) => ({
            id: g.line.id,
            unit_price: g.offer.unitPrice,
            line_subtotal: g.totals.lineSubtotal,
            line_tax: g.totals.lineTax,
            line_freight: g.totals.lineFreight,
            line_total: g.totals.lineTotal,
          })),
        )}) as x(id uuid, unit_price numeric, line_subtotal numeric, line_tax numeric, line_freight numeric, line_total numeric)
        where r.id = x.id
      `.execute(),
      tx`
        insert into approvals (entity_type, entity_id, decision, user_id, note)
        select 'recommendation', x.id, 'approved', ${actor.id}, ${`Approved into a purchase order (${actor.type})`}
        from jsonb_to_recordset(${tx.json(priced.map((g) => ({ id: g.line.id })))}) as x(id uuid)
      `.execute(),
      tx`
        update purchase_plans set
          status = case when exists (
            select 1 from purchase_recommendations r
            where r.plan_id = ${planId} and r.in_basket and r.status in ('proposed', 'edited') and not (r.id = any(${ids}::uuid[]))
          ) then 'partially_approved' else 'approved' end,
          updated_at = now()
        where id = ${planId}
      `.execute(),
      writeAudit(
        {
          actorType: actor.type,
          actorId: actor.id,
          action: "plan.lines_approved",
          entityType: "plan",
          entityId: planId,
          after: { lineIds: ids, purchaseOrders: created.map((c) => ({ id: c.id, status: c.status, grandTotal: c.grandTotal, merged: c.merged })), idempotencyKey },
        },
        tx,
      ),
    ]);

    return { purchaseOrders: await posForIds(tx, created.map((c) => c.id), state.approvalLimit), alreadyProcessed: false };
  });
}
