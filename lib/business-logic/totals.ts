// §6.7 — the one totals function used for recommendations, edits, approval and PO lines.
import type { LineTotals, Money, RecommendationStatus } from "./types";
import { notImplemented } from "./_stub";

export const lineTotals: (args: { qty: number; unitPrice: Money; taxRate: Money; freightPerPack: Money }) => LineTotals = () =>
  notImplemented("lineTotals");

/** Σ lineTotal of in-basket lines with status proposed / edited / approved_for_po. */
export const planTotal: (lines: { lineTotal: Money; inBasket: boolean; status: RecommendationStatus }[]) => Money = () =>
  notImplemented("planTotal");

export const budgetRemaining: (budget: Money, total: Money) => Money = () => notImplemented("budgetRemaining");
