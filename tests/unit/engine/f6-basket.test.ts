// F6 — budget basket (implementationplan.md §14.1).
import { describe, expect, it } from "vitest";
import { buildBasket } from "@/lib/business-logic/basket";
import type { BasketCandidate, BasketOption } from "@/lib/business-logic/types";

function option(over: Partial<BasketOption>): BasketOption {
  return { offerId: "o", qty: 10, freeQty: 0, unitPrice: "100.00", taxRate: "0", freightPerPack: "0", moq: 10, packMultiple: 1, lineTotal: "1000.00", ...over };
}
function candidate(key: string, priority: number, opt: BasketOption, alternatives: BasketOption[] = []): BasketCandidate {
  return { key, priority, cover: 1, criticalityWeight: 1, option: opt, alternatives };
}

describe("F6 basket", () => {
  const L1 = candidate("L1", 5, option({ offerId: "o1", qty: 30, unitPrice: "100.00", lineTotal: "3000.00" }));
  const L3 = candidate("L3", 3, option({ offerId: "o3", qty: 15, unitPrice: "100.00", lineTotal: "1500.00" }));

  it("pass 1: L1 in (rem 2,000), L2 deferred, L3 in (rem 500); L2 stays deferred when no pack-valid qty fits ₹500", () => {
    // Cheapest pack-valid L2 quantity is MOQ 10 × ₹250 = ₹2,500 > ₹500.
    const L2 = candidate("L2", 4, option({ offerId: "o2", qty: 10, unitPrice: "250.00", lineTotal: "2500.00", moq: 10, packMultiple: 1 }));
    const r = buildBasket([L1, L2, L3], "5000.00");
    const by = Object.fromEntries(r.lines.map((l) => [l.key, l]));
    expect(by.L1.inBasket).toBe(true);
    expect(by.L2.inBasket).toBe(false);
    expect(by.L2.reasons).toContain("BUDGET_DEFERRED");
    expect(by.L3.inBasket).toBe(true);
    expect(r.total).toBe("4500.00");
    expect(r.remaining).toBe("500.00");
  });

  it("pass 2: L2 takes a partial pack-valid quantity when one ≥ MOQ costs ≤ ₹500", () => {
    const L2 = candidate("L2", 4, option({ offerId: "o2", qty: 50, unitPrice: "50.00", lineTotal: "2500.00", moq: 5, packMultiple: 5 }));
    const r = buildBasket([L1, L2, L3], "5000.00");
    const l2 = r.lines.find((l) => l.key === "L2")!;
    expect(l2.inBasket).toBe(true);
    expect(l2.reasons).toContain("PARTIAL_QTY_BUDGET");
    expect(l2.option.qty).toBe(10);
    expect(l2.option.lineTotal).toBe("500.00");
    expect(r.total).toBe("5000.00");
    expect(r.remaining).toBe("0.00");
  });

  it("pass 2: L2 switches to the next-best offer when it fits", () => {
    const L2 = candidate("L2", 4, option({ offerId: "o2", qty: 10, unitPrice: "250.00", lineTotal: "2500.00" }), [
      option({ offerId: "o2-alt", qty: 10, unitPrice: "45.00", lineTotal: "450.00" }),
    ]);
    const r = buildBasket([L1, L2, L3], "5000.00");
    const l2 = r.lines.find((l) => l.key === "L2")!;
    expect(l2.inBasket).toBe(true);
    expect(l2.reasons).toContain("ALT_OFFER_FOR_BUDGET");
    expect(l2.option.offerId).toBe("o2-alt");
  });

  it("the total never exceeds the budget", () => {
    const L2 = candidate("L2", 4, option({ offerId: "o2", qty: 50, unitPrice: "50.00", lineTotal: "2500.00", moq: 5, packMultiple: 5 }));
    const r = buildBasket([L1, L2, L3], "5000.00");
    expect(Number(r.total)).toBeLessThanOrEqual(5000);
  });
});
