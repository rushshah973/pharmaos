// Read helpers for the Ask PharmaOS tools (implementationplan.md §9.2). Every number comes from the database or the
// pure engine; nothing here writes. The tools in lib/agents/tools.ts are thin adapters over these functions.
import { ServiceError } from "@/lib/api/errors";
import { getSql } from "@/lib/db/client";
import { ENGINE_CONFIG } from "@/lib/business-logic/config";
import { addDays } from "@/lib/business-logic/dates";
import { analyseSku, buildPlan } from "@/lib/business-logic/engine";
import type { SkuAnalysis, SkuContext } from "@/lib/business-logic/types";
import { type PlanningState, resolvePlanningState } from "./as-of";
import type { SqlHandle } from "./audit";
import { loadPlanningContext } from "./context";

export type SkuFacts = { state: PlanningState; sku: SkuContext; analysis: SkuAnalysis };

/** Exact SKU code (case-insensitive) → the engine's analysis on fresh data, the active scenario applied. */
export async function analyseSkuCode(code: string, sql: SqlHandle = getSql()): Promise<SkuFacts> {
  const [[product], state] = await Promise.all([
    sql<{ id: string }[]>`select id from products where upper(sku) = upper(${code.trim()}) and is_active`,
    resolvePlanningState(sql),
  ]);
  if (!product) throw new ServiceError("SKU_NOT_FOUND", 404, `No active SKU with code ${code}. Use search_products to find the code.`);
  const ctx = await loadPlanningContext(sql, state.asOf, state.scenarioId, product.id);
  const sku = ctx.skus[0];
  if (!sku) throw new ServiceError("SKU_NOT_FOUND", 404, `SKU ${code} is not active.`);
  return { state, sku, analysis: analyseSku(sku) };
}

/** Daily packs sold for the last `days` days up to the as-of date, oldest first, missing days as 0. */
export async function salesHistory(code: string, days: number, sql: SqlHandle = getSql()) {
  const [[product], state] = await Promise.all([
    sql<{ id: string; sku: string; brandName: string }[]>`select id, sku, brand_name as "brandName" from products where upper(sku) = upper(${code.trim()})`,
    resolvePlanningState(sql),
  ]);
  if (!product) throw new ServiceError("SKU_NOT_FOUND", 404, `No SKU with code ${code}.`);
  const from = addDays(state.asOf, -(days - 1));
  const rows = await sql<{ date: string; units: number }[]>`
    select to_char(sale_date, 'YYYY-MM-DD') as date, sum(units_sold)::int as units
    from sales_history where product_id = ${product.id} and sale_date between ${from} and ${state.asOf}
    group by sale_date order by sale_date
  `;
  const byDate = new Map(rows.map((r) => [r.date, r.units]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    return { date, units: byDate.get(date) ?? 0 };
  });
  return { sku: product.sku, brandName: product.brandName, asOf: state.asOf, days, totalUnits: series.reduce((n, d) => n + d.units, 0), series };
}

/** Past purchase prices: batch costs as received and lines on earlier purchase orders, newest first. */
export async function priceHistory(code: string, sql: SqlHandle = getSql()) {
  const [product] = await sql<{ id: string; sku: string }[]>`select id, sku from products where upper(sku) = upper(${code.trim()})`;
  if (!product) throw new ServiceError("SKU_NOT_FOUND", 404, `No SKU with code ${code}.`);
  const [batches, poLines] = await Promise.all([
    sql<{ batchNumber: string; receivedDate: string; unitCost: string; supplierCode: string | null }[]>`
      select b.batch_number as "batchNumber", to_char(b.received_date, 'YYYY-MM-DD') as "receivedDate", b.unit_cost::text as "unitCost", s.supplier_code as "supplierCode"
      from batches b left join suppliers s on s.id = b.supplier_id
      where b.product_id = ${product.id} order by b.received_date desc limit 12
    `.execute(),
    sql<{ poNumber: string; date: string; unitPrice: string; supplierCode: string; status: string }[]>`
      select po.po_number as "poNumber", to_char(po.created_at, 'YYYY-MM-DD') as date, l.unit_price::text as "unitPrice", s.supplier_code as "supplierCode", po.status
      from purchase_order_lines l join purchase_orders po on po.id = l.po_id join suppliers s on s.id = po.supplier_id
      where l.product_id = ${product.id} order by po.created_at desc limit 12
    `.execute(),
  ]);
  return { sku: product.sku, batchCosts: batches, poPrices: poLines };
}

/** Top expiry exposure across all SKUs (the engine's FEFO projection), largest ₹ at risk first. */
export async function expiryExposureTop(limit = 20, sql: SqlHandle = getSql()) {
  const state = await resolvePlanningState(sql);
  const ctx = await loadPlanningContext(sql, state.asOf, state.scenarioId);
  const rows = ctx.skus
    .map((s) => ({ s, a: analyseSku(s) }))
    .filter(({ a }) => Number(a.expiry.atRiskValue) > 0)
    .sort((x, y) => Number(y.a.expiry.atRiskValue) - Number(x.a.expiry.atRiskValue))
    .slice(0, limit)
    .map(({ s, a }) => ({
      sku: s.product.sku,
      brandName: s.product.brandName,
      strength: s.product.strength,
      status: a.status,
      atRiskQty: a.expiry.atRiskQty,
      atRiskValue: a.expiry.atRiskValue,
      batches: a.expiry.batches.filter((b) => b.atRiskQty > 0).map((b) => ({ batchNumber: b.batchNumber, expiryDate: b.expiryDate, atRiskQty: b.atRiskQty, atRiskValue: b.atRiskValue })),
    }));
  return { asOf: state.asOf, skusAtRisk: rows.length, rows };
}

/** A fresh plan on the current context, NOT saved: what "Create purchase plan" would propose right now. */
export async function planPreview(sql: SqlHandle = getSql()) {
  const state = await resolvePlanningState(sql);
  const ctx = await loadPlanningContext(sql, state.asOf, state.scenarioId);
  const result = buildPlan(ctx, { ...ENGINE_CONFIG, poApprovalLimit: state.approvalLimit });
  const codes = new Map(ctx.skus[0] ? Object.values(ctx.skus[0].suppliers).map((s) => [s.id, s.code]) : []);
  const lines = result.lines.filter((l) => l.inBasket);
  return {
    asOf: state.asOf,
    scenarioId: state.scenarioId,
    planTotal: result.planTotal,
    approvalLimit: result.approvalLimit,
    lineCount: lines.length,
    impact: result.impact,
    supplierPos: result.supplierTotals.map((t) => ({ supplierCode: codes.get(t.supplierId) ?? t.supplierId, lines: t.lines, total: t.total, ownerApproval: t.needsApproval ? "required" : "not required" })),
    topLines: lines.slice(0, 15).map((l) => ({ rank: l.rank, sku: l.sku, status: l.status, cover: l.cover, qty: l.qty, freeQty: l.freeQty, supplierCode: codes.get(l.supplierId ?? "") ?? null, lineTotal: l.totals?.lineTotal ?? null, reasons: l.reasons })),
  };
}

/** Bin id for a bin code ("C-L-03-2"). */
export async function binIdForCode(code: string, sql: SqlHandle = getSql()): Promise<string> {
  const [row] = await sql<{ id: string }[]>`select id from inventory_locations where upper(bin_code) = upper(${code.trim()})`;
  if (!row) throw new ServiceError("BIN_NOT_FOUND", 404, `No bin with code ${code}.`);
  return row.id;
}
