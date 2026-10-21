// F4 — FEFO expiry projection (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { projectExpiry } from "@/lib/business-logic/expiry";
import { AS_OF, makeBalance, makeBatch } from "@/tests/fixtures/engine";

describe("F4 FEFO expiry", () => {
  const batches = [
    makeBatch({ id: "A", batchNumber: "BA", expiryDate: "2027-01-29", unitCost: "12" }),
    makeBatch({ id: "B", batchNumber: "BB", expiryDate: "2027-10-21", unitCost: "12" }),
  ];
  const balances = [
    makeBalance({ id: "a1", batchId: "A", onHandQty: 100 }),
    makeBalance({ id: "b1", batchId: "B", onHandQty: 50 }),
  ];
  const run = () => projectExpiry({ batches, balances, avgDailyDemand: 2, asOf: AS_OF });

  it("batch A (100 days to expiry): sellable 10 days → sold 20, at risk 80, ₹960.00", () => {
    const a = run().batches.find((b) => b.batchId === "A")!;
    expect(a.daysToExpiry).toBe(100);
    expect(a.sellableDays).toBe(10);
    expect(a.projectedSold).toBeCloseTo(20, 10);
    expect(a.atRiskQty).toBeCloseTo(80, 10);
    expect(a.atRiskValue).toBe("960.00");
  });

  it("batch B (365 days): capacity 550 − 20 = 530 → sold 50, at risk 0", () => {
    const b = run().batches.find((x) => x.batchId === "B")!;
    expect(b.daysToExpiry).toBe(365);
    expect(b.sellableDays).toBe(275);
    expect(b.projectedSold).toBeCloseTo(50, 10);
    expect(b.atRiskQty).toBeCloseTo(0, 10);
  });

  it("FEFO order and totals: eligible available 70, at-risk value ₹960.00", () => {
    const r = run();
    expect(r.batches.map((b) => b.batchId)).toEqual(["A", "B"]);
    expect(r.eligibleAvailable).toBeCloseTo(70, 10);
    expect(r.atRiskValue).toBe("960.00");
    expect(r.ineligible).toEqual([]);
  });
});
