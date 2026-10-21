// §6.7 — the one totals function used for recommendations, edits, approval and PO lines.
import { dec, roundMoney, sumMoney } from "@/lib/money";
import type { LineTotals, Money, RecommendationStatus, SupplierTotal } from "./types";

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

/**
 * Projected purchase orders: counted lines grouped by supplier (one PO per supplier), each PO's grand total,
 * and whether it is strictly above the Owner approval limit. Sorted by total, largest first, then supplier id.
 */
export function supplierTotals(
  lines: { supplierId: string | null; lineTotal: Money; inBasket: boolean; status: RecommendationStatus }[],
  approvalLimit: Money,
): SupplierTotal[] {
  const by = new Map<string, { lines: number; totals: Money[] }>();
  for (const l of lines) {
    if (!l.supplierId || !l.inBasket || !COUNTED.has(l.status)) continue;
    const g = by.get(l.supplierId) ?? { lines: 0, totals: [] };
    g.lines += 1;
    g.totals.push(l.lineTotal);
    by.set(l.supplierId, g);
  }
  return [...by]
    .map(([supplierId, g]) => {
      const total = sumMoney(g.totals);
      return { supplierId, lines: g.lines, total: total.toFixed(2), needsApproval: total.greaterThan(approvalLimit) };
    })
    .sort((a, b) => dec(b.total).comparedTo(a.total) || a.supplierId.localeCompare(b.supplierId));
}

/** True when a purchase order of this grand total needs Owner approval before it is sent (strictly above). */
export function needsOwnerApproval(grandTotal: Money, approvalLimit: Money): boolean {
  return dec(grandTotal).greaterThan(approvalLimit);
}
