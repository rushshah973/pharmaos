// Goods receipt: when stock arrives, a sent PharmaOS PO (or a seeded in-transit PO, status 'open') is received.
// Per line: packs received (up to ordered + free; a short delivery is allowed), batch number, expiry date and
// the bin it goes to (suggested by the put-away rule, §6.13). One transaction creates the batches and stock
// balances, records received_qty, marks the PO 'received' and writes audit po.received. Received stock no
// longer counts as incoming and becomes available stock for the engine at once. Never touches a supplier.
import type postgres from "postgres";
import { ServiceError } from "@/lib/api/errors";
import { addDays } from "@/lib/business-logic/dates";
import { type PutawayBin, planPutaway } from "@/lib/business-logic/putaway";
import type { StorageClass } from "@/lib/business-logic/types";
import { getSql } from "@/lib/db/client";
import { resolvePlanningState } from "./as-of";
import { type SqlHandle, writeAudit } from "./audit";
import type { Actor } from "./plans";

/** Stock is not accepted with fewer days to expiry than this (chemists refuse short-dated stock). */
export const MIN_DAYS_TO_EXPIRY = 90;
const RECEIVABLE = ["sent", "open"] as const;

export type ReceiptLineDraft = {
  lineId: string;
  productId: string;
  sku: string;
  brandName: string;
  strength: string;
  storageClass: StorageClass;
  ordered: number;
  freeQty: number;
  qty: number;
  batchNumber: string;
  expiryDate: string;
  binId: string | null;
  binCode: string | null;
  /** Active bins of the product's storage class with room for this line, most free space first (max 40). */
  binOptions: { binId: string; binCode: string; free: number }[];
};

export type ReceiptDraft = { poId: string; poNumber: string; status: string; supplierName: string; asOf: string; minExpiry: string; lines: ReceiptLineDraft[] };

type LineRow = { lineId: string; productId: string; sku: string; brandName: string; strength: string; storageClass: StorageClass; shelfLifeDays: number; ordered: number; freeQty: number; unitPrice: string };

async function loadPo(sql: SqlHandle, poId: string, lock = false) {
  const [po] = await sql<{ id: string; poNumber: string; status: string; supplierId: string; supplierName: string }[]>`
    select po.id, po.po_number as "poNumber", po.status, po.supplier_id as "supplierId", s.name as "supplierName"
    from purchase_orders po join suppliers s on s.id = po.supplier_id
    where po.id = ${poId} ${lock ? sql`for update of po` : sql``}
  `;
  if (!po) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${poId} was not found.`);
  return po;
}

function loadLines(sql: SqlHandle, poId: string) {
  return sql<LineRow[]>`
    select l.id as "lineId", l.product_id as "productId", p.sku, p.brand_name as "brandName", p.strength,
      p.storage_class as "storageClass", p.shelf_life_days as "shelfLifeDays",
      l.quantity_packs as ordered, l.free_qty as "freeQty", l.unit_price::text as "unitPrice"
    from purchase_order_lines l join products p on p.id = l.product_id
    where l.po_id = ${poId}
    order by p.sku
  `.execute();
}

async function loadBins(sql: SqlHandle): Promise<PutawayBin[]> {
  const rows = await sql<(Omit<PutawayBin, "productIds"> & { productIds: string[] | null })[]>`
    select l.id, l.bin_code as "binCode", l.aisle, l.storage_class as "storageClass", l.capacity_units as "capacityUnits", l.status,
      coalesce((select sum(b.on_hand_qty) from inventory_balances b where b.location_id = l.id), 0)::int as used,
      (select array_agg(distinct b.product_id::text) from inventory_balances b where b.location_id = l.id and b.on_hand_qty > 0) as "productIds"
    from inventory_locations l order by l.bin_code
  `.execute();
  return rows.map((r) => ({ ...r, productIds: r.productIds ?? [] }));
}

const batchNumber = (poNumber: string, i: number) => `R${poNumber.replace(/\D/g, "").slice(-6)}${String(i + 1).padStart(2, "0")}`;

/** What the Receive goods dialog starts from: every line at its full quantity, a fresh batch, a suggested bin. */
export async function getReceiptDraft(poId: string, sql: postgres.Sql = getSql()): Promise<ReceiptDraft> {
  const [po, lines, bins, { asOf }] = await Promise.all([loadPo(sql, poId), loadLines(sql, poId), loadBins(sql), resolvePlanningState(sql)]);
  if (!(RECEIVABLE as readonly string[]).includes(po.status)) {
    throw new ServiceError("PO_NOT_RECEIVABLE", 409, `Only a sent or in-transit PO can be received; ${po.poNumber} is ${po.status}.`);
  }
  const placements = planPutaway(
    lines.map((l) => ({ productId: l.productId, storageClass: l.storageClass, packs: l.ordered + l.freeQty })),
    bins,
  );
  return {
    poId: po.id,
    poNumber: po.poNumber,
    status: po.status,
    supplierName: po.supplierName,
    asOf,
    minExpiry: addDays(asOf, MIN_DAYS_TO_EXPIRY),
    lines: lines.map((l, i) => {
      const qty = l.ordered + l.freeQty;
      const p = placements[i];
      return {
        lineId: l.lineId,
        productId: l.productId,
        sku: l.sku,
        brandName: l.brandName,
        strength: l.strength,
        storageClass: l.storageClass,
        ordered: l.ordered,
        freeQty: l.freeQty,
        qty,
        batchNumber: batchNumber(po.poNumber, i),
        // A fresh lot: about a year of shelf life left (never beyond the product's shelf life).
        expiryDate: addDays(asOf, Math.min(365, Math.max(MIN_DAYS_TO_EXPIRY + 30, Math.round(l.shelfLifeDays * 0.8)))),
        binId: p.binId,
        binCode: p.binCode,
        binOptions: bins
          .filter((b) => b.status === "active" && b.storageClass === l.storageClass && b.capacityUnits - b.used >= qty)
          .sort((a, b) => b.capacityUnits - b.used - (a.capacityUnits - a.used) || a.binCode.localeCompare(b.binCode))
          .slice(0, 40)
          .map((b) => ({ binId: b.id, binCode: b.binCode, free: b.capacityUnits - b.used })),
      };
    }),
  };
}

export type ReceiptInput = { lines: { lineId: string; qty: number; batchNumber: string; expiryDate: string; binId: string }[]; note?: string };

export type ReceiptResult = { poId: string; poNumber: string; status: "received"; packs: number; shortLines: number; bins: string[] };

export async function receivePurchaseOrder(
  poId: string,
  input: ReceiptInput,
  actor: Actor = { type: "user", id: process.env.DEMO_USER ?? "demo.owner" },
  sql: postgres.Sql = getSql(),
): Promise<ReceiptResult> {
  const { asOf } = await resolvePlanningState(sql);
  return sql.begin(async (tx) => {
    const po = await loadPo(tx, poId, true);
    if (!(RECEIVABLE as readonly string[]).includes(po.status)) {
      throw new ServiceError("PO_NOT_RECEIVABLE", 409, `Only a sent or in-transit PO can be received; ${po.poNumber} is ${po.status}.`);
    }
    const [lines, bins] = await Promise.all([loadLines(tx, poId), loadBins(tx)]);
    const byLine = new Map(lines.map((l) => [l.lineId, l]));
    const binById = new Map(bins.map((b) => [b.id, b]));
    const given = new Map(input.lines.map((l) => [l.lineId, l]));
    const minExpiry = addDays(asOf, MIN_DAYS_TO_EXPIRY);
    const problems: { lineId: string; sku: string; code: string; message: string }[] = [];
    const extra = input.lines.filter((l) => !byLine.has(l.lineId));
    if (extra.length) throw new ServiceError("LINE_NOT_ON_PO", 400, "Some lines are not on this purchase order.", { lineIds: extra.map((l) => l.lineId) });

    const used = new Map(bins.map((b) => [b.id, b.used]));
    const batchKeys = new Set<string>();
    for (const l of lines) {
      const r = given.get(l.lineId);
      if (!r) {
        problems.push({ lineId: l.lineId, sku: l.sku, code: "LINE_MISSING", message: "Every line needs a received quantity (0 if nothing arrived)." });
        continue;
      }
      const max = l.ordered + l.freeQty;
      if (!Number.isInteger(r.qty) || r.qty < 0 || r.qty > max) problems.push({ lineId: l.lineId, sku: l.sku, code: "QTY_OUT_OF_RANGE", message: `Received packs must be 0–${max} (ordered ${l.ordered}${l.freeQty ? ` + ${l.freeQty} free` : ""}).` });
      if (r.qty === 0) continue;
      if (!/^[A-Za-z0-9-]{3,24}$/.test(r.batchNumber.trim())) problems.push({ lineId: l.lineId, sku: l.sku, code: "BATCH_NUMBER", message: "Batch number: 3–24 letters, digits or dashes." });
      const key = `${l.productId}:${r.batchNumber.trim().toUpperCase()}`;
      if (batchKeys.has(key)) problems.push({ lineId: l.lineId, sku: l.sku, code: "BATCH_DUPLICATE", message: "The same batch number is used twice for this SKU." });
      batchKeys.add(key);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.expiryDate) || r.expiryDate < minExpiry) problems.push({ lineId: l.lineId, sku: l.sku, code: "SHORT_DATED", message: `Expiry must be on or after ${minExpiry} (at least ${MIN_DAYS_TO_EXPIRY} days of shelf life).` });
      const bin = binById.get(r.binId);
      if (!bin || bin.status !== "active") problems.push({ lineId: l.lineId, sku: l.sku, code: "BIN_NOT_ACTIVE", message: "Choose an active bin." });
      else if (bin.storageClass !== l.storageClass) problems.push({ lineId: l.lineId, sku: l.sku, code: "BIN_WRONG_STORAGE", message: `${bin.binCode} is ${bin.storageClass}; this SKU needs ${l.storageClass} storage.` });
      else if (bin.capacityUnits - (used.get(bin.id) ?? 0) < r.qty) problems.push({ lineId: l.lineId, sku: l.sku, code: "BIN_FULL", message: `${bin.binCode} has room for ${bin.capacityUnits - (used.get(bin.id) ?? 0)} packs.` });
      else used.set(bin.id, (used.get(bin.id) ?? 0) + r.qty);
    }
    const existing = batchKeys.size
      ? await tx<{ key: string }[]>`
          select product_id::text || ':' || upper(batch_number) as key from batches
          where product_id::text || ':' || upper(batch_number) = any(${[...batchKeys]}::text[])
        `
      : [];
    for (const e of existing) {
      const l = lines.find((x) => e.key.startsWith(`${x.productId}:`))!;
      problems.push({ lineId: l.lineId, sku: l.sku, code: "BATCH_EXISTS", message: "This SKU already has a batch with that number." });
    }
    if (problems.length) throw new ServiceError("RECEIPT_INVALID", 422, `${problems.length} problem${problems.length === 1 ? "" : "s"} with the receipt; nothing was received.`, { problems });
    const packs = lines.reduce((n, l) => n + given.get(l.lineId)!.qty, 0);
    if (packs === 0) throw new ServiceError("NOTHING_RECEIVED", 422, "No packs were received. Enter what arrived, or leave the PO as it is.");

    const placed: string[] = [];
    let shortLines = 0;
    for (const l of lines) {
      const r = given.get(l.lineId)!;
      if (r.qty < l.ordered + l.freeQty) shortLines++;
      await tx`update purchase_order_lines set received_qty = ${r.qty} where id = ${l.lineId}`;
      if (r.qty === 0) continue;
      const [batch] = await tx<{ id: string }[]>`
        insert into batches (product_id, batch_number, expiry_date, received_date, supplier_id, unit_cost, quality_status, return_policy_status, data_source)
        values (${l.productId}, ${r.batchNumber.trim().toUpperCase()}, ${r.expiryDate}, ${asOf}, ${po.supplierId}, ${l.unitPrice}, 'released', 'unknown', 'synthetic_demo')
        returning id
      `;
      await tx`insert into inventory_balances (product_id, batch_id, location_id, on_hand_qty, reserved_qty, data_source) values (${l.productId}, ${batch.id}, ${r.binId}, ${r.qty}, 0, 'synthetic_demo')`;
      placed.push(binById.get(r.binId)!.binCode);
    }
    await tx`update purchase_orders set status = 'received', received_at = now(), received_by = ${actor.id} where id = ${poId}`;
    await writeAudit(
      {
        actorType: actor.type,
        actorId: actor.id,
        action: "po.received",
        entityType: "purchase_order",
        entityId: poId,
        before: { status: po.status },
        after: {
          status: "received",
          packs,
          shortLines,
          lines: lines.map((l) => {
            const r = given.get(l.lineId)!;
            return { sku: l.sku, ordered: l.ordered + l.freeQty, received: r.qty, batch: r.qty ? r.batchNumber.trim().toUpperCase() : null, expiry: r.qty ? r.expiryDate : null, bin: r.qty ? binById.get(r.binId)!.binCode : null };
          }),
        },
        reason: input.note?.trim() || null,
      },
      tx,
    );
    return { poId, poNumber: po.poNumber, status: "received" as const, packs, shortLines, bins: [...new Set(placed)] };
  });
}
