// §6.7 — the one totals function used for recommendations, edits, approval and PO lines.
import { dec, roundMoney, sumMoney } from "@/lib/money";
import type { LineTotals, Money, RecommendationStatus } from "./types";

/**
 * subtotal = round(q × price); tax = round(subtotal × rate / 100); freight = round(q × freight/pack);
 * total = subtotal + tax + freight. Half-up to paise at each of those three points only.
 */
export function lineTotals(args: { qty: number; unitPrice: Money; taxRate: Money; freightPerPack: Money }): LineTotals {
  const subtotal = roundMoney(dec(args.unitPrice).times(args.qty));
  const tax = roundMoney(subtotal.times(args.taxRate).dividedBy(100));
  const freight = roundMoney(dec(args.freightPerPack).times(args.qty));
  return {
    lineSubtotal: subtotal.toFixed(2),
    lineTax: tax.toFixed(2),
    lineFreight: freight.toFixed(2),
    lineTotal: subtotal.plus(tax).plus(freight).toFixed(2),
  };
}

const COUNTED: ReadonlySet<RecommendationStatus> = new Set(["proposed", "edited", "approved_for_po"]);

/** Σ lineTotal of in-basket lines with status proposed / edited / approved_for_po. */
export function planTotal(lines: { lineTotal: Money; inBasket: boolean; status: RecommendationStatus }[]): Money {
  return sumMoney(lines.filter((l) => l.inBasket && COUNTED.has(l.status)).map((l) => l.lineTotal)).toFixed(2);
}

/** budget − plan total, never below zero (the basket and edit checks keep the plan within budget). */
export function budgetRemaining(budget: Money, total: Money): Money {
  const left = roundMoney(dec(budget).minus(total));
  return (left.isNegative() ? dec(0) : left).toFixed(2);
}
