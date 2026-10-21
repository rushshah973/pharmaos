// F7 — scheme decision, tested in isolation (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { applyScheme } from "@/lib/business-logic/ordering";

const base = { q: 10, packMultiple: 10, schemePaidQty: 20, schemeFreeQty: 3, stockPosition: 100, shelfLifeDays: 540, effectiveUnitCost: "22.9000" };

describe("F7 scheme", () => {
  it("d̄ = 1: (100 + 23) / 1 = 123 < 450 → scheme taken (20 paid + 3 free)", () => {
    const r = applyScheme({ ...base, avgDailyDemand: 1 });
    expect(r.taken).toBe(true);
    expect(r.qty).toBe(20);
    expect(r.freeQty).toBe(3);
    expect(r.reason).toBe("SCHEME_TAKEN");
    expect(r.expiryAvoidedValue).toBe("0.00");
  });

  it("d̄ = 0.2: 615 ≥ 450 and q < P → SCHEME_SKIPPED_EXPIRY, expiryAvoided = 10 × ₹22.90 = ₹229.00", () => {
    const r = applyScheme({ ...base, avgDailyDemand: 0.2 });
    expect(r.taken).toBe(false);
    expect(r.qty).toBe(10);
    expect(r.freeQty).toBe(0);
    expect(r.reason).toBe("SCHEME_SKIPPED_EXPIRY");
    expect(r.expiryAvoidedValue).toBe("229.00");
  });

  it("q ≥ P with slow demand: free goods arrive anyway → SCHEME_EXCESS_RISK warning", () => {
    const r = applyScheme({ ...base, q: 20, avgDailyDemand: 0.2 });
    expect(r.qty).toBe(20);
    expect(r.freeQty).toBe(3);
    expect(r.warning).toBe("SCHEME_EXCESS_RISK");
    expect(r.reason).toBeNull();
  });
});
