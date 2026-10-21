// F8 — edge cases, one test each (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { buildBasket } from "@/lib/business-logic/basket";
import { analyseSku } from "@/lib/business-logic/engine";
import { projectExpiry } from "@/lib/business-logic/expiry";
import { confirmedIncoming, stockPosition } from "@/lib/business-logic/inventory";
import { offerExclusions } from "@/lib/business-logic/supplier-scoring";
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
      budget: "200000.00",
      planTotal: "1000.00",
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

  it("budget boundary: a line total exactly equal to the remaining budget is included", () => {
    const r = buildBasket(
      [
        {
          key: "L1",
          priority: 1,
          cover: 1,
          criticalityWeight: 1,
          option: { offerId: "o", qty: 10, freeQty: 0, unitPrice: "100.00", taxRate: "0", freightPerPack: "0", moq: 10, packMultiple: 10, lineTotal: "1000.00" },
          alternatives: [],
        },
      ],
      "1000.00",
    );
    expect(r.lines[0].inBasket).toBe(true);
    expect(r.remaining).toBe("0.00");
  });
});
