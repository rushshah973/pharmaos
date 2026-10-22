// F1 — demand and quantity (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { computeDemand } from "@/lib/business-logic/demand";
import { coverDays, reorderPoint, safetyStock, targetStock } from "@/lib/business-logic/inventory";
import { isCandidate, orderQuantity } from "@/lib/business-logic/ordering";
import { AS_OF, addDaysUtc, salesSeries } from "@/tests/fixtures/engine";

describe("F1 demand and quantity", () => {
  const sales = salesSeries(AS_OF, [10, 12, 8, 10, 10, 14, 6], 224 - 70);

  it("d7 = 10, d28 = 8; under 56 days of history the average is the 28-day mean, d̄ = 8", () => {
    const d = computeDemand(sales, AS_OF, addDaysUtc(AS_OF, -40));
    expect(d.d7).toBeCloseTo(10, 10);
    expect(d.d28).toBeCloseTo(8, 10);
    expect(d.avgDailyDemand).toBeCloseTo(8, 10);
    expect(d.flags).toEqual([]);
    expect(d.dailySeries).toHaveLength(28);
  });

  it("safety 27.6, ROP 64.4, target 128.8 at L = 4", () => {
    expect(safetyStock(9.2)).toBeCloseTo(27.6, 10);
    expect(reorderPoint(9.2, 4)).toBeCloseTo(64.4, 10);
    expect(targetStock(9.2, 4)).toBeCloseTo(128.8, 10);
  });

  it("stock 40 < ROP 64.4 → candidate; qRaw 88.8 → q 90", () => {
    expect(isCandidate({ avgDailyDemand: 9.2, stockPosition: 40, leadFastest: 4 })).toBe(true);
    const q = orderQuantity({ avgDailyDemand: 9.2, stockPosition: 40, leadTimeDays: 4, moq: 20, packMultiple: 10, hasAtRiskBatches: false });
    expect(q.qRaw).toBeCloseTo(88.8, 10);
    expect(q.q).toBe(90);
    expect(q.reasons).not.toContain("EXPIRY_REDUCED_QTY");
  });

  it("cover = 40 / 9.2 = 4.3478… days", () => {
    expect(coverDays(40, 9.2)).toBeCloseTo(4.3478, 4);
  });
});
