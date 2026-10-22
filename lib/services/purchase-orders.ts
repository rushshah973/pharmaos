// Owner approval and (simulated) sending of PharmaOS purchase orders (implementationplan.md §7.6a).
// Each action is one transaction with the PO row locked. Sending is SIMULATED: no email, no API call —
// nothing leaves the app; a sent PO only changes status. From 'ready' on, its stock counts as on order in later plans.
import type postgres from "postgres";
import { ServiceError } from "@/lib/api/errors";
import { getSql } from "@/lib/db/client";
import { type SqlHandle, writeAudit } from "./audit";

type SqlRead = SqlHandle;

export type PoStatus = "open" | "received" | "cancelled" | "ready" | "pending_approval" | "approved" | "sent" | "rejected";

export type PoSummary = {
  id: string;
  poNumber: string;
  status: PoStatus;
  supplierCode: string;
  supplierName: string;
  grandTotal: string;
  sentAt: string | null;
  sentBy: string | null;
};

type Who = { id: string };
const owner = (): Who => ({ id: process.env.DEMO_USER ?? "demo.owner" });

async function lockPo(tx: postgres.TransactionSql, poId: string): Promise<PoSummary> {
  const [row] = await tx<PoSummary[]>`
    select po.id, po.po_number as "poNumber", po.status, s.supplier_code as "supplierCode", s.name as "supplierName",
      po.grand_total::text as "grandTotal",
      to_char(po.sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "sentAt", po.sent_by as "sentBy",
      po.data_source as "dataSource"
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.id = ${poId}
    for update of po
  `;
  if (!row) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${poId} was not found.`);
  return row;
}

const locked = (po: PoSummary) => new ServiceError("PO_LOCKED", 409, `${po.poNumber} is ${po.status.replace("_", " ")} and cannot change.`);

/** Owner approval: pending_approval → approved. */
export async function approvePo(poId: string, opts: { note?: string } = {}, who: Who = owner(), sql: postgres.Sql = getSql()): Promise<PoSummary> {
  return sql.begin(async (tx) => {
    const po = await lockPo(tx, poId);
    if (po.status !== "pending_approval") throw locked(po);
    await Promise.all([
      tx`update purchase_orders set status = 'approved' where id = ${poId}`.execute(),
      tx`insert into approvals (entity_type, entity_id, decision, user_id, note) values ('purchase_order', ${poId}, 'approved', ${who.id}, ${opts.note?.trim() || null})`.execute(),
      writeAudit(
        { actorType: "user", actorId: who.id, action: "po.approved", entityType: "purchase_order", entityId: poId, before: { status: po.status }, after: { status: "approved", grandTotal: po.grandTotal }, reason: opts.note?.trim() || null },
        tx,
      ),
    ]);
    return { ...po, status: "approved" };
  });
}

/** Owner rejection: pending_approval → rejected (reason ≥ 3). Its lines stay approved_for_po (not re-planned). */
export async function rejectPo(poId: string, reason: string, who: Who = owner(), sql: postgres.Sql = getSql()): Promise<PoSummary> {
  const why = reason.trim();
  if (why.length < 3) throw new ServiceError("REASON_REQUIRED", 400, "Give a reason (at least 3 characters) to reject the purchase order.");
  return sql.begin(async (tx) => {
    const po = await lockPo(tx, poId);
    if (po.status !== "pending_approval") throw locked(po);
    await Promise.all([
      tx`update purchase_orders set status = 'rejected' where id = ${poId}`.execute(),
      tx`insert into approvals (entity_type, entity_id, decision, user_id, note) values ('purchase_order', ${poId}, 'rejected', ${who.id}, ${why})`.execute(),
      writeAudit(
        { actorType: "user", actorId: who.id, action: "po.rejected", entityType: "purchase_order", entityId: poId, before: { status: po.status }, after: { status: "rejected" }, reason: why },
        tx,
      ),
    ]);
    return { ...po, status: "rejected" };
  });
}

/** Send (simulated): ready | approved → sent. Above the limit and not yet approved → 409 APPROVAL_REQUIRED. */
export async function sendPo(poId: string, who: Who = owner(), sql: postgres.Sql = getSql()): Promise<PoSummary> {
  return sql.begin(async (tx) => {
    const po = await lockPo(tx, poId);
    if (po.status === "pending_approval") {
      throw new ServiceError("APPROVAL_REQUIRED", 409, `${po.poNumber} is above the Owner approval limit and needs Owner approval before it can be sent.`);
    }
    if (po.status !== "ready" && po.status !== "approved") throw locked(po);
    const [[row]] = await Promise.all([
      tx<{ sent_at: string }[]>`
        update purchase_orders set status = 'sent', sent_at = now(), sent_by = ${who.id} where id = ${poId}
        returning to_char(sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as sent_at
      `,
      writeAudit(
        {
          actorType: "user",
          actorId: who.id,
          action: "po.sent",
          entityType: "purchase_order",
          entityId: poId,
          before: { status: po.status },
          after: { status: "sent", simulated: true, note: "Marked as sent — simulated, nothing was emailed" },
        },
        tx,
      ),
    ]);
    return { ...po, status: "sent", sentAt: row.sent_at, sentBy: who.id };
  });
}

// ---------------------------------------------------------------------------
// Reads and CSV export (§10.3, §7.7)
// ---------------------------------------------------------------------------

export type PoFilter = "all" | "awaiting" | "ready" | "sent" | "external";

export type PoListItem = {
  id: string;
  poNumber: string;
  status: PoStatus;
  supplierCode: string;
  supplierName: string;
  lines: number;
  grandTotal: string;
  sourcePlanId: string | null;
  createdAt: string;
  expectedDeliveryDate: string | null;
  /** PharmaOS-created (from a plan) or seeded history from the stockist's earlier process. */
  origin: "pharmaos" | "external";
  /** The PO's largest lines (by value), for the list: which products this PO is for. */
  products: { sku: string; brandName: string; strength: string; qty: number }[];
};

/** Top lines of a PO by value (shared by the list and the detail query). */
const PRODUCTS_SQL = `coalesce((
  select json_agg(x) from (
    select p.sku, p.brand_name as "brandName", p.strength, l.quantity_packs as qty
    from purchase_order_lines l join products p on p.id = l.product_id
    where l.po_id = po.id order by l.line_total desc, p.sku limit 3
  ) x), '[]'::json)`;

const PHARMAOS_STATUSES = ["ready", "pending_approval", "approved", "sent", "rejected"];

/** Newest first. "external" = the seeded purchase history (open / received / cancelled). */
export async function listPurchaseOrders(filter: PoFilter = "all", limit = 100, sql: SqlRead = getSql()): Promise<PoListItem[]> {
  const where =
    filter === "awaiting"
      ? sql`po.status = 'pending_approval'`
      : filter === "ready"
        ? sql`po.status in ('ready', 'approved')`
        : filter === "sent"
          ? sql`po.status = 'sent'`
          : filter === "external"
            ? sql`po.source_plan_id is null`
            : sql`true`;
  return sql<PoListItem[]>`
    select po.id, po.po_number as "poNumber", po.status, s.supplier_code as "supplierCode", s.name as "supplierName",
      (select count(*)::int from purchase_order_lines l where l.po_id = po.id) as lines,
      po.grand_total::text as "grandTotal", po.source_plan_id as "sourcePlanId",
      to_char(po.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
      to_char(po.expected_delivery_date, 'YYYY-MM-DD') as "expectedDeliveryDate",
      case when po.source_plan_id is null then 'external' else 'pharmaos' end as origin,
      ${sql.unsafe(PRODUCTS_SQL)} as products
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where ${where}
    order by (po.status = any(${PHARMAOS_STATUSES})) desc, po.created_at desc, po.po_number desc
    limit ${Math.min(Math.max(Math.trunc(limit), 1), 500)}
  `;
}

/** How many items sit at each step of the approval → PO → Owner → send flow (PharmaOS POs; lines from the latest open plan). */
export type PoPipeline = { linesAwaitingPo: number; ready: number; awaitingOwner: number; sent: number; rejected: number };

export async function getPoPipeline(sql: SqlRead = getSql()): Promise<PoPipeline> {
  const [r] = await sql<PoPipeline[]>`
    select
      (select count(*)::int from purchase_recommendations rec
        where rec.in_basket and rec.status in ('proposed', 'edited')
          and rec.plan_id = (select id from purchase_plans where status in ('draft', 'partially_approved') order by created_at desc limit 1)) as "linesAwaitingPo",
      count(*) filter (where po.status in ('ready', 'approved'))::int as ready,
      count(*) filter (where po.status = 'pending_approval')::int as "awaitingOwner",
      count(*) filter (where po.status = 'sent')::int as sent,
      count(*) filter (where po.status = 'rejected')::int as rejected
    from purchase_orders po
    where po.source_plan_id is not null
  `;
  return r ?? { linesAwaitingPo: 0, ready: 0, awaitingOwner: 0, sent: 0, rejected: 0 };
}

export async function countAwaitingApproval(sql: SqlRead = getSql()): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from purchase_orders where status = 'pending_approval'`;
  return r?.n ?? 0;
}

export type PoLine = {
  id: string;
  sku: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  packSize: number;
  manufacturer: string;
  qty: number;
  freeQty: number;
  unitPrice: string;
  taxRate: string;
  lineSubtotal: string;
  lineTax: string;
  lineFreight: string;
  lineTotal: string;
};

export type PoDetail = PoListItem & {
  subtotal: string;
  taxTotal: string;
  freightTotal: string;
  supplierPaymentTermsDays: number | null;
  approvedBy: string | null; // who approved the plan lines into this PO
  approvedAt: string | null;
  ownerDecision: { decision: "approved" | "rejected"; by: string; at: string; note: string | null } | null;
  sentAt: string | null;
  sentBy: string | null;
  needsOwnerApproval: boolean; // created above the limit (pending_approval, or approved / rejected / sent after a decision)
  /** The record's data_source label (R8): synthetic_demo for every seeded or app-created PO. */
  dataSource: string;
  lineItems: PoLine[];
};

export async function getPurchaseOrder(poId: string, sql: SqlRead = getSql()): Promise<PoDetail> {
  const [head] = await sql<(Omit<PoDetail, "lineItems" | "ownerDecision" | "needsOwnerApproval"> & { lines: number })[]>`
    select po.id, po.po_number as "poNumber", po.status, s.supplier_code as "supplierCode", s.name as "supplierName",
      s.payment_terms_days as "supplierPaymentTermsDays",
      (select count(*)::int from purchase_order_lines l where l.po_id = po.id) as lines,
      po.subtotal::text as subtotal, po.tax_total::text as "taxTotal", po.freight_total::text as "freightTotal",
      po.grand_total::text as "grandTotal", po.source_plan_id as "sourcePlanId",
      to_char(po.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
      to_char(po.expected_delivery_date, 'YYYY-MM-DD') as "expectedDeliveryDate",
      case when po.source_plan_id is null then 'external' else 'pharmaos' end as origin,
      ${sql.unsafe(PRODUCTS_SQL)} as products,
      po.approved_by as "approvedBy",
      to_char(po.approved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "approvedAt",
      to_char(po.sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "sentAt", po.sent_by as "sentBy"
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.id = ${poId}
  `;
  if (!head) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${poId} was not found.`);
  const [lineItems, decisions] = await Promise.all([
    sql<PoLine[]>`
      select l.id, p.sku, p.brand_name as "brandName", p.generic_name as "genericName", p.strength, p.dosage_form as "dosageForm",
        p.pack_size as "packSize", p.manufacturer, l.quantity_packs as qty, l.free_qty as "freeQty",
        l.unit_price::text as "unitPrice", l.tax_rate::text as "taxRate", l.line_subtotal::text as "lineSubtotal",
        l.line_tax::text as "lineTax", l.line_freight::text as "lineFreight", l.line_total::text as "lineTotal"
      from purchase_order_lines l join products p on p.id = l.product_id
      where l.po_id = ${poId}
      order by p.sku
    `,
    sql<{ decision: "approved" | "rejected"; user_id: string; at: string; note: string | null }[]>`
      select decision, user_id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, note
      from approvals where entity_type = 'purchase_order' and entity_id = ${poId} order by created_at desc limit 1
    `,
  ]);
  const d = decisions[0];
  return {
    ...head,
    lineItems,
    ownerDecision: d ? { decision: d.decision, by: d.user_id, at: d.at, note: d.note } : null,
    needsOwnerApproval: head.status === "pending_approval" || !!d,
  };
}

/** RFC 4180 field: quote when needed, double inner quotes. */
const csvField = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of a PO in any status. The status does not change; audit po.exported. */
export async function exportPo(poId: string, who: Who = owner(), sql: postgres.Sql = getSql()): Promise<{ filename: string; csv: string }> {
  const po = await getPurchaseOrder(poId, sql);
  const header = ["po_number", "status", "supplier_code", "supplier_name", "sku", "brand", "strength", "dosage_form", "manufacturer", "pack_size", "qty_packs", "free_qty", "unit_price", "gst_rate", "line_subtotal", "line_gst", "line_freight", "line_total"];
  const rows = po.lineItems.map((l) =>
    [po.poNumber, po.status, po.supplierCode, po.supplierName, l.sku, l.brandName, l.strength, l.dosageForm, l.manufacturer, l.packSize, l.qty, l.freeQty, l.unitPrice, l.taxRate, l.lineSubtotal, l.lineTax, l.lineFreight, l.lineTotal].map(csvField).join(","),
  );
  const totals = [
    ["", "", "", "", "", "", "", "", "", "", "", "", "", "TOTAL", po.subtotal, po.taxTotal, po.freightTotal, po.grandTotal].map(csvField).join(","),
    csvField(po.status === "sent" ? `Marked as sent ${po.sentAt ?? ""} (simulated: nothing was emailed)` : "NOT SENT — synthetic demo data"),
  ];
  await writeAudit(
    { actorType: "user", actorId: who.id, action: "po.exported", entityType: "purchase_order", entityId: poId, after: { format: "csv", status: po.status, lines: po.lineItems.length } },
    sql,
  );
  return { filename: `${po.poNumber}.csv`, csv: [header.join(","), ...rows, ...totals].join("\r\n") + "\r\n" };
}
