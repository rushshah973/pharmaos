// Applies a scenario's changes to a loaded planning context, in memory only (plan §12). The seed tables are never
// touched: Reset is instant and the baseline is always exact. Affected SKUs are picked per SKU (from the demo-case
// lists, a category or a supplier id), never from the whole context, so a single-SKU context (a line edit) sees
// the same effect as a full plan. Scenarios change the sales before the ML forecast reads them (§6.2a), so the
// forecast moves with the scenario without retraining. Pure and deterministic.
import { addDays } from "@/lib/business-logic/dates";
import type { PlanningContext, SkuContext } from "@/lib/business-logic/types";
import { dec } from "@/lib/money";
import demoCases from "@/data/synthetic/demo-cases.json";

export type ScenarioId = "baseline" | "demand_spike" | "supplier_delay" | "seasonal_surge" | "expiry_risk";
export type ScenarioParams = Record<string, unknown>;
export type Scenario = { id: string; params?: ScenarioParams };

/** The demo-case SKUs the seed planted (data/synthetic/demo-cases.json), used when the params name none. */
export const DEMO_CASES = demoCases as { spike: string[]; expiry: string[] };

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const list = (v: unknown, fallback: string[]) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : fallback);

/** Multiply the last `days` days of sales (as-of inclusive) by `multiplier`, rounded to whole packs. */
function boostSales(sku: SkuContext, days: number, multiplier: number): SkuContext {
  const from = addDays(sku.asOf, -(days - 1));
  return { ...sku, sales: sku.sales.map((s) => (s.date >= from && s.date <= sku.asOf ? { ...s, units: Math.round(s.units * multiplier) } : s)) };
}

function applyToSku(sku: SkuContext, scenario: Scenario): SkuContext {
  const p = scenario.params ?? {};
  switch (scenario.id) {
    case "demand_spike": {
      const skus = new Set(list(p.skus, DEMO_CASES.spike));
      return skus.has(sku.product.sku) ? boostSales(sku, num(p.days, 5), num(p.multiplier, 3)) : sku;
    }
    case "seasonal_surge": {
      const cats = new Set(list(p.categories, ["analgesic", "antibiotic", "respiratory"]));
      return cats.has(sku.product.category) ? boostSales(sku, num(p.days, 10), num(p.multiplier, 4)) : sku;
    }
    case "supplier_delay": {
      // The preferred supplier is resolved when the scenario is run (most wins in the baseline plan) and saved
      // in params.supplier_id; without it there is nothing to delay.
      const supplierId = typeof p.supplier_id === "string" ? p.supplier_id : null;
      if (!supplierId) return sku;
      const addLead = num(p.lead_time_add_days, 5);
      const factor = dec(1).plus(dec(num(p.price_change_pct, 8)).dividedBy(100));
      const supplier = sku.suppliers[supplierId];
      return {
        ...sku,
        offers: sku.offers.map((o) =>
          o.supplierId === supplierId
            ? { ...o, leadTimeDays: o.leadTimeDays + addLead, unitPrice: o.unitPrice === null ? null : dec(o.unitPrice).times(factor).toDecimalPlaces(4).toFixed(4) }
            : o,
        ),
        suppliers: supplier ? { ...sku.suppliers, [supplierId]: { ...supplier, defaultLeadTimeDays: supplier.defaultLeadTimeDays + addLead } } : sku.suppliers,
      };
    }
    case "expiry_risk": {
      const target = typeof p.sku === "string" ? p.sku : DEMO_CASES.expiry[0];
      if (sku.product.sku !== target) return sku;
      // Its largest released, unexpired batch (by packs on hand) now expires `days_to_expiry` days after as-of: just
      // past the 90-day sell-by window, so a little still sells and the rest is at risk (the reorder is capped).
      const onHand = new Map<string, number>();
      for (const b of sku.balances) onHand.set(b.batchId, (onHand.get(b.batchId) ?? 0) + b.onHandQty);
      const batch = sku.batches
        .filter((b) => b.qualityStatus === "released" && b.expiryDate > sku.asOf && (onHand.get(b.id) ?? 0) > 0)
        .sort((a, b) => (onHand.get(b.id) ?? 0) - (onHand.get(a.id) ?? 0) || a.id.localeCompare(b.id))[0];
      if (!batch) return sku;
      const expiryDate = addDays(sku.asOf, num(p.days_to_expiry, 92));
      return { ...sku, batches: sku.batches.map((b) => (b.id === batch.id ? { ...b, expiryDate, receivedDate: b.receivedDate < expiryDate ? b.receivedDate : addDays(expiryDate, -1) } : b)) };
    }
    default:
      return sku;
  }
}

export function applyScenario(ctx: PlanningContext, scenario: Scenario | string): PlanningContext {
  const s = typeof scenario === "string" ? { id: scenario } : scenario;
  if (s.id === "baseline") return ctx;
  return { ...ctx, skus: ctx.skus.map((sku) => applyToSku(sku, s)) };
}
