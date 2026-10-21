// F5 — supplier score and urgency rule (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { applyUrgencyRule, scoreOffers } from "@/lib/business-logic/supplier-scoring";
import type { ScoreInput } from "@/lib/business-logic/types";

const A: ScoreInput = { offerId: "A", supplierCode: "SUP-01", effectiveCost: "20.0000", leadTimeDays: 7, reliabilityScore: 90, paymentTermsDays: 30 };
const B: ScoreInput = { offerId: "B", supplierCode: "SUP-02", effectiveCost: "22.0000", leadTimeDays: 2, reliabilityScore: 80, paymentTermsDays: 45 };

describe("F5 supplier score", () => {
  it("cover 20: both fast enough → A 69.6667 beats B 51.0000", () => {
    const urgency = applyUrgencyRule(
      [A, B].map((o) => ({ offerId: o.offerId, leadTimeDays: o.leadTimeDays, effectiveCost: o.effectiveCost })),
      20,
    );
    expect(urgency.kept.sort()).toEqual(["A", "B"]);
    expect(urgency.dropped).toEqual([]);

    const [first, second] = scoreOffers([A, B]);
    expect(first.offerId).toBe("A");
    expect(first.factors.cost).toBeCloseTo(100, 6);
    expect(first.factors.leadTime).toBeCloseTo(0, 6);
    expect(first.factors.reliability).toBeCloseTo(90, 6);
    expect(first.factors.terms).toBeCloseTo(66.667, 3);
    expect(first.score).toBeCloseTo(69.6667, 4);
    expect(second.offerId).toBe("B");
    expect(second.factors).toEqual({ cost: 0, leadTime: 100, reliability: 80, terms: 100 });
    expect(second.score).toBeCloseTo(51, 6);
  });

  it("cover 4: A (lead 7) is dropped as TOO_SLOW_FOR_COVER and the line gets CHEAPER_OFFER_TOO_SLOW → B wins", () => {
    const urgency = applyUrgencyRule(
      [A, B].map((o) => ({ offerId: o.offerId, leadTimeDays: o.leadTimeDays, effectiveCost: o.effectiveCost })),
      4,
    );
    expect(urgency.kept).toEqual(["B"]);
    expect(urgency.dropped).toEqual([{ offerId: "A", code: "TOO_SLOW_FOR_COVER" }]);
    expect(urgency.lineReasons).toContain("CHEAPER_OFFER_TOO_SLOW");
    expect(scoreOffers([B])[0].offerId).toBe("B");
  });

  it("a supplier with null reliability scores 0 for reliability, not 100", () => {
    const [scored] = scoreOffers([{ ...A, reliabilityScore: null }]);
    expect(scored.factors.reliability).toBe(0);
  });
});
