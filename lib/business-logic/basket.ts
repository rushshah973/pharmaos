// §6.9 — greedy budget basket (pass 1) and the alternative-offer / partial-quantity second pass.
// A documented heuristic, not an optimum. Guarantees Σ in-basket lineTotal ≤ budget.
import { dec } from "@/lib/money";
import { lineTotals } from "./totals";
import type { BasketCandidate, BasketLine, BasketOption, BasketResult, Money } from "./types";

/** Largest pack-valid quantity ≥ MOQ (and below the full quantity) whose line total fits `remaining`. */
function partialOption(option: BasketOption, remaining: Money): BasketOption | null {
  const { packMultiple: pm, moq } = option;
  const minK = Math.ceil(moq / pm);
  const maxK = Math.floor((option.qty - 1) / pm); // strictly smaller than the full order
  if (maxK < minK) return null;
  // Start near the affordable quantity, then step down until the exact total fits.
  const perPack = dec(option.unitPrice)
    .times(dec(1).plus(dec(option.taxRate).dividedBy(100)))
    .plus(option.freightPerPack);
  const estimate = perPack.greaterThan(0) ? dec(remaining).dividedBy(perPack).dividedBy(pm).floor().toNumber() + 1 : maxK;
  for (let k = Math.min(maxK, estimate); k >= minK; k--) {
    const qty = k * pm;
    const totals = lineTotals({ qty, unitPrice: option.unitPrice, taxRate: option.taxRate, freightPerPack: option.freightPerPack });
    if (dec(totals.lineTotal).lessThanOrEqualTo(remaining)) {
      const p = option.schemePaidQty ?? 0;
      const f = option.schemeFreeQty ?? 0;
      return { ...option, qty, freeQty: p > 0 && f > 0 ? Math.floor(qty / p) * f : 0, lineTotal: totals.lineTotal };
    }
  }
  return null;
}

/** Candidates must already be in priority order. */
export function buildBasket(candidates: BasketCandidate[], budget: Money): BasketResult {
  let remaining = dec(budget);
  const lines: BasketLine[] = [];

  // Pass 1: greedy in priority order.
  for (const c of candidates) {
    if (dec(c.option.lineTotal).lessThanOrEqualTo(remaining)) {
      lines.push({ key: c.key, inBasket: true, option: c.option, reasons: [] });
      remaining = remaining.minus(c.option.lineTotal);
    } else {
      lines.push({ key: c.key, inBasket: false, option: c.option, reasons: ["BUDGET_DEFERRED"] });
    }
  }

  // Pass 2: deferred urgent lines (priority > 0) try the next-best offer, then a partial quantity.
  candidates.forEach((c, i) => {
    const line = lines[i];
    if (line.inBasket || c.priority <= 0) return;
    const left = remaining.toFixed(2);
    const alt = c.alternatives.find((a) => dec(a.lineTotal).lessThanOrEqualTo(left));
    const chosen = alt ?? partialOption(c.option, left);
    if (!chosen) return;
    line.inBasket = true;
    line.option = chosen;
    line.reasons = [alt ? "ALT_OFFER_FOR_BUDGET" : "PARTIAL_QTY_BUDGET"];
    remaining = remaining.minus(chosen.lineTotal);
  });

  return { lines, total: dec(budget).minus(remaining).toFixed(2), remaining: remaining.toFixed(2) };
}
