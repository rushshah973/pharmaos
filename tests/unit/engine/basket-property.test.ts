// Property test for §6.9: for 200 seeded random baskets, Σ in-basket lineTotal ≤ budget.
import { describe, expect, it } from "vitest";
import { dec, sumMoney } from "@/lib/money";
import { buildBasket } from "@/lib/business-logic/basket";
import { lineTotals } from "@/lib/business-logic/totals";
import type { BasketCandidate, BasketOption } from "@/lib/business-logic/types";
import { createRng } from "@/scripts/seed/prng";

function randomOption(rng: ReturnType<typeof createRng>, id: string): BasketOption {
  const packMultiple = rng.pick([1, 5, 10]);
  const moq = rng.pick([1, 5, 10, 20]);
  const qty = Math.max(moq, packMultiple * rng.int(1, 40));
  const roundedQty = Math.ceil(qty / packMultiple) * packMultiple;
  const unitPrice = rng.float(5, 400).toFixed(4);
  const taxRate = rng.pick(["5.00", "12.00"]);
  const freightPerPack = rng.float(0, 1.5).toFixed(2);
  const scheme = rng.chance(0.2) ? rng.pick([[10, 1], [20, 3]] as const) : null;
  return {
    offerId: id,
    qty: roundedQty,
    freeQty: scheme ? Math.floor(roundedQty / scheme[0]) * scheme[1] : 0,
    unitPrice,
    taxRate,
    freightPerPack,
    moq,
    packMultiple,
    lineTotal: lineTotals({ qty: roundedQty, unitPrice, taxRate, freightPerPack }).lineTotal,
    schemePaidQty: scheme?.[0] ?? null,
    schemeFreeQty: scheme?.[1] ?? null,
  };
}

describe("basket property", () => {
  it("never exceeds the budget across 200 seeded random baskets", () => {
    const rng = createRng(2026);
    for (let run = 0; run < 200; run++) {
      const n = rng.int(1, 40);
      const candidates: BasketCandidate[] = Array.from({ length: n }, (_, i) => ({
        key: `L${i}`,
        priority: rng.chance(0.6) ? rng.float(0.001, 2) : 0,
        cover: rng.float(0, 30),
        criticalityWeight: rng.pick([0.7, 1, 1.5, 2]),
        option: randomOption(rng, `o${i}`),
        alternatives: Array.from({ length: rng.int(0, 2) }, (_, k) => randomOption(rng, `o${i}-alt${k}`)),
      }));
      const budget = rng.float(0, 60000).toFixed(2);
      const r = buildBasket(candidates, budget);

      const inBasket = r.lines.filter((l) => l.inBasket).map((l) => l.option.lineTotal);
      const sum = sumMoney(inBasket);
      expect(sum.lessThanOrEqualTo(budget)).toBe(true);
      expect(r.total).toBe(sum.toFixed(2));
      expect(r.remaining).toBe(dec(budget).minus(sum).toFixed(2));
      expect(r.lines).toHaveLength(n);
      for (const l of r.lines) {
        // Every bought option still respects pack rules and MOQ.
        if (!l.inBasket) continue;
        expect(l.option.qty % l.option.packMultiple).toBe(0);
        expect(l.option.qty).toBeGreaterThanOrEqual(l.option.moq);
      }
    }
  });
});
