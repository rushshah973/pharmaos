// Expiry reduction rule (plan §6.5, revised at P11): at-risk batches cap the order at ROP,
// except on STOCKOUT_RISK lines; only skipped schemes count as expiry avoided.
import { describe, expect, it } from "vitest";
import { analyseSku, buildPlan } from "@/lib/business-logic/engine";
import { AS_OF, addDaysUtc, makeBalance, makeBatch, makeSku } from "@/tests/fixtures/engine";

// d̄ = 9/day, offer lead 4, MOQ 20, pack 10 → safety 45, ROP 81, target 207.
// One batch of 100 packs whose sell-by date is `sellableDays` away: it sells 9 × sellableDays, the rest is at risk.
function skuWithNearExpiryBatch(sellableDays: number) {
  return makeSku({
    batches: [makeBatch({ id: "near", batchNumber: "BNEAR", expiryDate: addDaysUtc(AS_OF, 90 + sellableDays) })],
    balances: [makeBalance({ id: "n1", batchId: "near", onHandQty: 100 })],
  });
}

describe("expiry reduction", () => {
  it("a STOCKOUT_RISK line with at-risk stock is ordered up to target, not cut to ROP", () => {
    const a = analyseSku(skuWithNearExpiryBatch(2)); // eligible 18 → cover 2 < lead 4
    expect(a.status).toBe("STOCKOUT_RISK");
    expect(a.expiry.atRiskQty).toBeCloseTo(82, 10);
    expect(a.reasons).not.toContain("EXPIRY_REDUCED_QTY");
    expect(a.qty).toBe(190); // target 207 − 18 = 189 → 190
    expect(a.warnings).toContain("AT_RISK_BATCHES");
    expect(a.expiryAvoidedValue).toBe("0.00");
  });

  it("a BELOW_ROP (not urgent) line with at-risk stock is still cut to ROP", () => {
    const a = analyseSku(skuWithNearExpiryBatch(6)); // eligible 54 → cover 6 ≥ 4, 54 < ROP 81
    expect(a.status).toBe("BELOW_ROP");
    expect(a.reasons).toContain("EXPIRY_REDUCED_QTY");
    expect(a.qty).toBe(30); // ROP 81 − 54 = 27 → 30 (full order would be 207 − 54 = 153 → 160)
    expect(a.expiryAvoidedValue).toBe("0.00"); // reduced quantity is not counted as expiry avoided
  });

  it("the Impact Card counts no expiry avoided for reduced quantities", () => {
    const plan = buildPlan({ asOf: AS_OF, skus: [skuWithNearExpiryBatch(6)] });
    expect(plan.lines[0].reasons).toContain("EXPIRY_REDUCED_QTY");
    expect(plan.impact.expiryAvoided).toBe("0.00");
  });
});
