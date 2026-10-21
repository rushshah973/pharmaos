// Extra rule tests for §6.5–§6.8 behaviour not covered by fixtures F1–F9.
import { describe, expect, it } from "vitest";
import { orderQuantity, applyScheme } from "@/lib/business-logic/ordering";
import { comparePriority, lossPrevented, priorityScore } from "@/lib/business-logic/priority";
import { applyUrgencyRule, offerExclusions, priceAnomalies, scoreOffers } from "@/lib/business-logic/supplier-scoring";
import { planTotal, supplierTotals } from "@/lib/business-logic/totals";
import { AS_OF, makeOffer, makeSupplier } from "@/tests/fixtures/engine";

describe("§6.5 ordering rules", () => {
  it("at-risk batches reduce the order to ROP − stock (EXPIRY_REDUCED_QTY)", () => {
    // d̄ 9.2, L 4: ROP 64.4 → raw 24.4 → 30 (pack 10); target would give 90.
    const q = orderQuantity({ avgDailyDemand: 9.2, stockPosition: 40, leadTimeDays: 4, moq: 20, packMultiple: 10, hasAtRiskBatches: true });
    expect(q.qRaw).toBeCloseTo(24.4, 10);
    expect(q.q).toBe(30);
    expect(q.reasons).toEqual(["EXPIRY_REDUCED_QTY"]);
  });

  it("MOQ lifts a small rounded quantity; nothing needed → 0 (no MOQ)", () => {
    expect(orderQuantity({ avgDailyDemand: 1, stockPosition: 9, leadTimeDays: 2, moq: 20, packMultiple: 5, hasAtRiskBatches: false }).q).toBe(20);
    expect(orderQuantity({ avgDailyDemand: 1, stockPosition: 500, leadTimeDays: 2, moq: 20, packMultiple: 5, hasAtRiskBatches: false }).q).toBe(0);
  });

  it("no demand or no order → scheme not applied", () => {
    const r = applyScheme({ q: 0, packMultiple: 10, schemePaidQty: 10, schemeFreeQty: 1, stockPosition: 0, avgDailyDemand: 0, shelfLifeDays: 540, effectiveUnitCost: "10" });
    expect(r).toMatchObject({ taken: false, qty: 0, freeQty: 0, reason: null });
  });
});

describe("§6.6 supplier rules", () => {
  it("no offer fast enough → keep only the fastest and flag STOCKOUT_BEFORE_DELIVERY", () => {
    const r = applyUrgencyRule(
      [
        { offerId: "cheap-slow", leadTimeDays: 9, effectiveCost: "10.0000" },
        { offerId: "fast", leadTimeDays: 3, effectiveCost: "12.0000" },
        { offerId: "mid", leadTimeDays: 5, effectiveCost: "11.0000" },
      ],
      1,
    );
    expect(r.kept).toEqual(["fast"]);
    expect(r.dropped.map((d) => d.offerId).sort()).toEqual(["cheap-slow", "mid"]);
    expect(r.lineReasons).toEqual(expect.arrayContaining(["STOCKOUT_BEFORE_DELIVERY", "CHEAPER_OFFER_TOO_SLOW"]));
  });

  it("ties break on lower cost, then shorter lead time, then supplier code", () => {
    const base = { reliabilityScore: 80, paymentTermsDays: 30 };
    const ranked = scoreOffers([
      { offerId: "b", supplierCode: "SUP-02", effectiveCost: "10.0000", leadTimeDays: 3, ...base },
      { offerId: "a", supplierCode: "SUP-01", effectiveCost: "10.0000", leadTimeDays: 3, ...base },
    ]);
    expect(ranked.map((r) => r.offerId)).toEqual(["a", "b"]);
    expect(ranked[0].factors.cost).toBe(100); // all equal → 100
  });

  it("flags an offer priced above 1.2 × the median of the other offers", () => {
    expect(
      priceAnomalies([
        { offerId: "x", unitPrice: "10" },
        { offerId: "y", unitPrice: "11" },
        { offerId: "z", unitPrice: "14" },
      ]),
    ).toEqual(["z"]);
    expect(priceAnomalies([{ offerId: "only", unitPrice: "99" }])).toEqual([]);
  });

  it("lists every exclusion code that applies", () => {
    const codes = offerExclusions({
      offer: makeOffer({ isActive: false, productId: "other", unitPrice: null, moq: 0, availableQty: 5 }),
      supplier: makeSupplier({ approvedStatus: "pending" }),
      productId: "prod-1",
      asOf: AS_OF,
      qty: 90,
    });
    expect(codes).toEqual(
      expect.arrayContaining(["SUPPLIER_NOT_APPROVED", "OFFER_INACTIVE", "PRODUCT_MISMATCH", "MISSING_PRICE", "INVALID_PACK_RULES", "INSUFFICIENT_AVAILABILITY"]),
    );
    expect(offerExclusions({ offer: makeOffer(), supplier: makeSupplier(), productId: "prod-1", asOf: AS_OF, qty: 90 })).toEqual([]);
  });
});

describe("§6.7 totals", () => {
  it("plan total counts only in-plan proposed / edited / approved lines", () => {
    const total = planTotal([
      { lineTotal: "100.10", inBasket: true, status: "proposed" },
      { lineTotal: "200.20", inBasket: true, status: "edited" },
      { lineTotal: "300.30", inBasket: true, status: "approved_for_po" },
      { lineTotal: "999.00", inBasket: false, status: "proposed" },
      { lineTotal: "888.00", inBasket: true, status: "rejected" },
      { lineTotal: "777.00", inBasket: true, status: "deferred" },
    ]);
    expect(total).toBe("600.60");
  });

  it("projects one PO per supplier from counted lines and flags those above the approval limit", () => {
    const pos = supplierTotals(
      [
        { supplierId: "S1", lineTotal: "250000.00", inBasket: true, status: "proposed" },
        { supplierId: "S1", lineTotal: "150000.01", inBasket: true, status: "edited" },
        { supplierId: "S2", lineTotal: "400000.00", inBasket: true, status: "proposed" },
        { supplierId: "S2", lineTotal: "90000.00", inBasket: true, status: "rejected" },
        { supplierId: "S3", lineTotal: "10.00", inBasket: false, status: "proposed" },
        { supplierId: null, lineTotal: "0.00", inBasket: false, status: "proposed" },
      ],
      "400000.00",
    );
    expect(pos).toEqual([
      { supplierId: "S1", lines: 2, total: "400000.01", needsApproval: true },
      { supplierId: "S2", lines: 1, total: "400000.00", needsApproval: false },
    ]);
  });
});

describe("§6.8 priority", () => {
  it("loss prevented = shortfall × d̄ × margin × w_crit; zero when cover ≥ lead time", () => {
    // L 4, cover 2 → 2 days × 5/day × ₹3 × 1.5 (chronic) = ₹45.00
    expect(lossPrevented({ leadTimeDays: 4, cover: 2, avgDailyDemand: 5, unitMargin: "3.00", criticality: "chronic" })).toBe("45.00");
    expect(lossPrevented({ leadTimeDays: 4, cover: 6, avgDailyDemand: 5, unitMargin: "3.00", criticality: "chronic" })).toBe("0.00");
    expect(priorityScore("45.00", "900.00")).toBeCloseTo(0.05, 10);
    expect(priorityScore("45.00", "0.00")).toBe(0);
  });

  it("sorts by priority desc → cover asc → w_crit desc → key asc", () => {
    const keys = [
      { key: "C", priority: 0, cover: 5, criticalityWeight: 1 },
      { key: "B", priority: 0.2, cover: 9, criticalityWeight: 1 },
      { key: "A", priority: 0, cover: 5, criticalityWeight: 2 },
      { key: "D", priority: 0, cover: 3, criticalityWeight: 0.7 },
      { key: "E", priority: 0, cover: 5, criticalityWeight: 1 },
    ];
    expect([...keys].sort(comparePriority).map((k) => k.key)).toEqual(["B", "D", "A", "C", "E"]);
  });
});
