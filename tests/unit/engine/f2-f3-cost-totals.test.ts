// F2 — effective cost with scheme; F3 — line totals (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { effectiveUnitCost } from "@/lib/business-logic/supplier-scoring";
import { lineTotals } from "@/lib/business-logic/totals";

describe("F2 effective cost", () => {
  const base = { unitPrice: "20", taxRate: "12", freightPerPack: "0.50", schemePaidQty: 10, schemeFreeQty: 1 };

  it("10+1 scheme taken: 20 × 1.12 × 10/11 + 0.50 = ₹20.8636", () => {
    expect(effectiveUnitCost({ ...base, schemeTaken: true })).toBe("20.8636");
  });

  it("without the scheme: ₹22.9000", () => {
    expect(effectiveUnitCost({ ...base, schemeTaken: false })).toBe("22.9000");
    expect(effectiveUnitCost({ ...base, schemePaidQty: null, schemeFreeQty: null, schemeTaken: false })).toBe("22.9000");
  });
});

describe("F3 totals", () => {
  it("q 90 × ₹20, GST 12%, freight ₹0.50 → 1800.00 / 216.00 / 45.00 / 2061.00", () => {
    expect(lineTotals({ qty: 90, unitPrice: "20", taxRate: "12", freightPerPack: "0.50" })).toEqual({
      lineSubtotal: "1800.00",
      lineTax: "216.00",
      lineFreight: "45.00",
      lineTotal: "2061.00",
    });
  });
});
