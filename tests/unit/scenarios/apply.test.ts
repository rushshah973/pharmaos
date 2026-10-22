// §12 scenarios: each one changes exactly the field the table says, in memory; baseline changes nothing.
import { describe, expect, it } from "vitest";
import { analyseSku } from "@/lib/business-logic/engine";
import type { PlanningContext } from "@/lib/business-logic/types";
import { DEMO_CASES, applyScenario } from "@/lib/scenarios/apply";
import { AS_OF, addDaysUtc, flatSales, makeBalance, makeBatch, makeOffer, makeProduct, makeSku, makeSupplier } from "@/tests/fixtures/engine";

const ctxOf = (...skus: ReturnType<typeof makeSku>[]): PlanningContext => ({ asOf: AS_OF, skus });
const unitsOn = (ctx: PlanningContext, i: number, date: string) => ctx.skus[i].sales.find((s) => s.date === date)?.units;

describe("§12 scenarios (in memory)", () => {
  it("baseline returns the context unchanged", () => {
    const ctx = ctxOf(makeSku());
    expect(applyScenario(ctx, "baseline")).toBe(ctx);
    expect(applyScenario(ctx, { id: "baseline", params: { multiplier: 9 } })).toBe(ctx);
  });

  it("demand_spike: last 5 days × 3 for the demo-case spike SKUs only; d̄ and the 7-day vs 28-day ratio rise", () => {
    const spike = makeSku({ product: makeProduct({ sku: DEMO_CASES.spike[0] }), sales: flatSales(AS_OF, 10) });
    const other = makeSku({ product: makeProduct({ id: "prod-2", sku: "PHX-OTHER" }), sales: flatSales(AS_OF, 10) });
    const out = applyScenario(ctxOf(spike, other), { id: "demand_spike", params: { days: 5, multiplier: 3 } });
    expect(unitsOn(out, 0, AS_OF)).toBe(30);
    expect(unitsOn(out, 0, addDaysUtc(AS_OF, -4))).toBe(30);
    expect(unitsOn(out, 0, addDaysUtc(AS_OF, -5))).toBe(10);
    expect(unitsOn(out, 1, AS_OF)).toBe(10);
    const before = analyseSku(spike);
    const after = analyseSku(out.skus[0]);
    expect(after.demand.avgDailyDemand).toBeGreaterThan(before.demand.avgDailyDemand);
    expect(after.demand.d7 / after.demand.d28).toBeGreaterThan(before.demand.d7 / before.demand.d28);
    expect(after.qty).toBeGreaterThanOrEqual(before.qty);
  });

  it("seasonal_surge: last 10 days × 4 for analgesic, antibiotic and respiratory SKUs; other categories untouched", () => {
    const fever = makeSku({ product: makeProduct({ category: "antibiotic" }), sales: flatSales(AS_OF, 5) });
    const heart = makeSku({ product: makeProduct({ id: "prod-2", sku: "PHX-CARD", category: "cardiac" }), sales: flatSales(AS_OF, 5) });
    const out = applyScenario(ctxOf(fever, heart), { id: "seasonal_surge", params: { days: 10, multiplier: 4, categories: ["analgesic", "antibiotic", "respiratory"] } });
    expect(unitsOn(out, 0, addDaysUtc(AS_OF, -9))).toBe(20);
    expect(unitsOn(out, 0, addDaysUtc(AS_OF, -10))).toBe(5);
    expect(unitsOn(out, 1, AS_OF)).toBe(5);
    expect(analyseSku(out.skus[0]).demand.avgDailyDemand).toBeGreaterThan(analyseSku(fever).demand.avgDailyDemand);
  });

  it("supplier_delay: the resolved supplier's offers get +5 days lead and +8% price; others unchanged", () => {
    const slow = makeSupplier({ id: "sup-a" });
    const fast = makeSupplier({ id: "sup-b", code: "SUP-B" });
    const sku = makeSku({
      suppliers: { "sup-a": slow, "sup-b": fast },
      offers: [makeOffer({ id: "o-a", supplierId: "sup-a", unitPrice: "100.0000", leadTimeDays: 2 }), makeOffer({ id: "o-b", supplierId: "sup-b", unitPrice: "105.0000", leadTimeDays: 3 })],
    });
    const out = applyScenario(ctxOf(sku), { id: "supplier_delay", params: { supplier_id: "sup-a", lead_time_add_days: 5, price_change_pct: 8 } }).skus[0];
    expect(out.offers[0]).toMatchObject({ leadTimeDays: 7, unitPrice: "108.0000" });
    expect(out.offers[1]).toMatchObject({ leadTimeDays: 3, unitPrice: "105.0000" });
    expect(out.suppliers["sup-a"].defaultLeadTimeDays).toBe(slow.defaultLeadTimeDays + 5);
    // Without a resolved supplier nothing changes.
    expect(applyScenario(ctxOf(sku), { id: "supplier_delay", params: {} }).skus[0]).toBe(sku);
  });

  it("expiry_risk: the demo SKU's largest batch now expires as-of + 60 days, so stock becomes at risk", () => {
    const sku = makeSku({
      product: makeProduct({ sku: DEMO_CASES.expiry[0] }),
      sales: flatSales(AS_OF, 1),
      batches: [makeBatch({ id: "small" }), makeBatch({ id: "big" })],
      balances: [makeBalance({ id: "b1", batchId: "small", onHandQty: 10 }), makeBalance({ id: "b2", batchId: "big", onHandQty: 300 })],
    });
    const out = applyScenario(ctxOf(sku), { id: "expiry_risk", params: { days_to_expiry: 60 } }).skus[0];
    expect(out.batches.find((b) => b.id === "big")!.expiryDate).toBe(addDaysUtc(AS_OF, 60));
    expect(out.batches.find((b) => b.id === "small")!.expiryDate).toBe(sku.batches[0].expiryDate);
    expect(Number(analyseSku(out).expiry.atRiskValue)).toBeGreaterThan(Number(analyseSku(sku).expiry.atRiskValue));
  });

  it("the same SKU gets the same effect in a single-SKU context and in the full context", () => {
    const a = makeSku({ product: makeProduct({ sku: DEMO_CASES.spike[0] }), sales: flatSales(AS_OF, 10) });
    const b = makeSku({ product: makeProduct({ id: "prod-2", sku: "PHX-OTHER" }), sales: flatSales(AS_OF, 10) });
    const s = { id: "demand_spike", params: {} };
    expect(applyScenario(ctxOf(a), s).skus[0]).toEqual(applyScenario(ctxOf(a, b), s).skus[0]);
  });
});
