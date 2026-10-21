// Owner approval and (simulated) sending of PharmaOS purchase orders (implementationplan.md §7.6a).
// Each action is one transaction with the PO row locked. Sending is SIMULATED: no email, no API call —
// nothing leaves the app; a sent PO only changes status and then counts as incoming stock in later plans.
import type postgres from "postgres";
import { ServiceError } from "@/lib/api/errors";
import { getSql } from "@/lib/db/client";
import { writeAudit } from "./audit";

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
      to_char(po.sent_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "sentAt", po.sent_by as "sentBy"
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
