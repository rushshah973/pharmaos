// F8 — edge cases, one test each (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { analyseSku } from "@/lib/business-logic/engine";
import { projectExpiry } from "@/lib/business-logic/expiry";
import { confirmedIncoming, runOutDays, stockPosition } from "@/lib/business-logic/inventory";
import { offerExclusions } from "@/lib/business-logic/supplier-scoring";
import { needsOwnerApproval } from "@/lib/business-logic/totals";
import { hardStops } from "@/lib/business-logic/validation";
import {
  AS_OF,
  addDaysUtc,
  flatSales,
  makeBalance,
  makeBatch,
  makeIncoming,
  makeOffer,
  makeProduct,
  makeSku,
  makeSupplier,
} from "@/tests/fixtures/engine";

describe("F8 edge cases", () => {
  it("zero demand → no plan line, status NO_DEMAND, warning NO_DEMAND", () => {
    const a = analyseSku(makeSku({ sales: flatSales(AS_OF, 0) }));
    expect(a.candidate).toBe(false);
    expect(a.status).toBe("NO_DEMAND");
    expect(a.cover).toBeNull();
    expect(a.warnings).toContain("NO_DEMAND");
  });

  it("an incoming PO beyond the 14-day horizon is excluded (and received/cancelled POs never count)", () => {
    const incoming = [
      makeIncoming({ poId: "in", expectedDeliveryDate: addDaysUtc(AS_OF, 10), quantityPacks: 30, freeQty: 2 }),
      makeIncoming({ poId: "late", expectedDeliveryDate: addDaysUtc(AS_OF, 15), quantityPacks: 50 }),
      makeIncoming({ poId: "rcv", status: "received", expectedDeliveryDate: addDaysUtc(AS_OF, -2), quantityPacks: 99 }),
      makeIncoming({ poId: "cxl", status: "cancelled", expectedDeliveryDate: addDaysUtc(AS_OF, 3), quantityPacks: 77 }),
    ];
    expect(confirmedIncoming(incoming, AS_OF)).toBe(32);
  });

  it("run-out counts each PO on its delivery day: stock that empties before a PO arrives is a gap", () => {
    // 10 packs, 5/day → empty on day 2; a 100-pack PO on day 4 arrives too late.
    const late = [makeIncoming({ status: "ready", expectedDeliveryDate: addDaysUtc(AS_OF, 4), quantityPacks: 100 })];
    expect(runOutDays(10, late, 5, AS_OF)).toBe(2);
    // The same PO on day 1 arrives in time: 10 − 5 + 100 = 105 packs on day 1 → empty on day 22.
    const early = [makeIncoming({ status: "sent", expectedDeliveryDate: addDaysUtc(AS_OF, 1), quantityPacks: 100 })];
    expect(runOutDays(10, early, 5, AS_OF)).toBe(22);
    // No POs: position ÷ d̄. No demand: null. Received POs never count.
    expect(runOutDays(30, [], 6, AS_OF)).toBe(5);
    expect(runOutDays(30, [], 0, AS_OF)).toBeNull();
    expect(runOutDays(10, [makeIncoming({ status: "received", expectedDeliveryDate: addDaysUtc(AS_OF, 1), quantityPacks: 100 })], 5, AS_OF)).toBe(2);
  });

  it("runs out before its PO arrives → stockout risk and a bridge top-up for the gap days only (never the full order again)", () => {
    // 40 packs at 9/day → empty on day ~4.4; 400 packs arrive on day 6. A 2-day supplier can bridge day 4.4 → 6.
    const sku = makeSku({ incoming: [makeIncoming({ status: "ready", expectedDeliveryDate: addDaysUtc(AS_OF, 6), quantityPacks: 400 })] });
    const a = analyseSku(sku);
    expect(a.shortBeforeDelivery).toBe(true);
    expect(a.status).toBe("STOCKOUT_RISK");
    expect(a.cover!).toBeCloseTo(40 / 9, 5);
    expect(a.candidate).toBe(true);
    expect(a.reasons).toContain("BRIDGE_UNTIL_DELIVERY");
    expect(a.reasons).not.toContain("BELOW_REORDER_POINT");
    // d̄ × (6 − 4.44) ≈ 14 packs before pack rounding: a top-up, not the target quantity.
    expect(a.chosen!.order!.qRaw).toBeCloseTo(9 * (6 - 40 / 9), 5);
    expect(a.qty).toBeLessThan(60);
  });

  it("no bridge when no supplier can deliver before the PO already on order", () => {
    const sku = makeSku({
      offers: [makeOffer({ leadTimeDays: 6 })],
      incoming: [makeIncoming({ status: "sent", expectedDeliveryDate: addDaysUtc(AS_OF, 6), quantityPacks: 400 })],
    });
    const a = analyseSku(sku);
    expect(a.status).toBe("STOCKOUT_RISK");
    expect(a.candidate).toBe(false);
    expect(a.reasons).not.toContain("NO_ELIGIBLE_OFFER");
  });

  it("unsent PharmaOS POs (ready, awaiting the Owner, approved) count as on order, so a new plan does not buy the same stock again", () => {
    const d = addDaysUtc(AS_OF, 5);
    const incoming = [
      makeIncoming({ poId: "r", status: "ready", expectedDeliveryDate: d, quantityPacks: 10 }),
      makeIncoming({ poId: "p", status: "pending_approval", expectedDeliveryDate: d, quantityPacks: 20 }),
      makeIncoming({ poId: "a", status: "approved", expectedDeliveryDate: d, quantityPacks: 30 }),
      makeIncoming({ poId: "s", status: "sent", expectedDeliveryDate: d, quantityPacks: 40 }),
    ];
    expect(confirmedIncoming(incoming, AS_OF)).toBe(100);
  });

  it("reserved stock is subtracted exactly once", () => {
    const batches = [makeBatch({ id: "b1" })];
    const balances = [
      makeBalance({ id: "x1", batchId: "b1", onHandQty: 30, reservedQty: 5 }),
      makeBalance({ id: "x2", batchId: "b1", locationId: "bin-2", onHandQty: 20, reservedQty: 5 }),
    ];
    const r = projectExpiry({ batches, balances, avgDailyDemand: 1, asOf: AS_OF });
    expect(r.eligibleAvailable).toBe(40);
    expect(stockPosition(r.eligibleAvailable, 0)).toBe(40);
  });

  it("quarantine and expired batches are excluded from available stock", () => {
    const batches = [
      makeBatch({ id: "q", batchNumber: "BQ", qualityStatus: "quarantine" }),
      makeBatch({ id: "e", batchNumber: "BE", expiryDate: addDaysUtc(AS_OF, -1), receivedDate: addDaysUtc(AS_OF, -400) }),
      makeBatch({ id: "ok", batchNumber: "BOK" }),
    ];
    const balances = [
      makeBalance({ id: "1", batchId: "q", onHandQty: 30 }),
      makeBalance({ id: "2", batchId: "e", onHandQty: 20 }),
      makeBalance({ id: "3", batchId: "ok", onHandQty: 10 }),
    ];
    const r = projectExpiry({ batches, balances, avgDailyDemand: 1, asOf: AS_OF });
    expect(r.eligibleAvailable).toBe(10);
    expect(r.ineligible.map((i) => i.reason).sort()).toEqual(["expired", "quarantine"]);
  });

  it("qty 85 with pack multiple 10 → INVALID_PACK_MULTIPLE", () => {
    const stops = hardStops({
      product: makeProduct(),
      offer: makeOffer({ packMultiple: 10, moq: 10 }),
      supplier: makeSupplier(),
      qty: 85,
      asOf: AS_OF,
      batches: [makeBatch()],
    });
    expect(stops).toContain("INVALID_PACK_MULTIPLE");
  });

  it("a stale quote (older than 14 days) is excluded", () => {
    const offer = makeOffer({ quotedAt: `${addDaysUtc(AS_OF, -20)}T10:00:00.000Z` });
    expect(offerExclusions({ offer, supplier: makeSupplier(), productId: "prod-1", asOf: AS_OF, qty: 90 })).toContain("QUOTE_STALE");
  });

  it("an expired quote (valid_until before as-of) is excluded", () => {
    const offer = makeOffer({ validUntil: `${addDaysUtc(AS_OF, -1)}T10:00:00.000Z` });
    expect(offerExclusions({ offer, supplier: makeSupplier(), productId: "prod-1", asOf: AS_OF, qty: 90 })).toContain("QUOTE_EXPIRED");
  });

  it("a blocked supplier is excluded", () => {
    const supplier = makeSupplier({ approvedStatus: "blocked" });
    expect(offerExclusions({ offer: makeOffer(), supplier, productId: "prod-1", asOf: AS_OF, qty: 90 })).toContain("SUPPLIER_NOT_APPROVED");
  });

  it("approval boundary: a PO of exactly ₹4,00,000 is sent without approval; one paisa more needs the Owner", () => {
    expect(needsOwnerApproval("400000.00", "400000.00")).toBe(false);
    expect(needsOwnerApproval("400000.01", "400000.00")).toBe(true);
  });
});
