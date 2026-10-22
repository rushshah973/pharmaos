// Plain-language text for reason and warning codes (implementationplan.md Appendix B).
import type { ReasonCode, WarningCode } from "@/lib/business-logic/types";

export const REASON_TEXT: Record<ReasonCode, { short: string; meaning: string }> = {
  BELOW_REORDER_POINT: { short: "Below ROP", meaning: "Stock position is below the reorder point" },
  STOCKOUT_BEFORE_DELIVERY: { short: "Delivery gap", meaning: "Stock runs out before any supplier can deliver" },
  CHEAPER_OFFER_TOO_SLOW: { short: "Faster picked", meaning: "A cheaper supplier was skipped because it delivers after the projected stockout" },
  SCHEME_TAKEN: { short: "Scheme taken", meaning: "Scheme taken; the extra stock sells before expiry" },
  SCHEME_SKIPPED_EXPIRY: { short: "Skip scheme", meaning: "Scheme skipped; the extra stock would not sell before expiry" },
  EXPIRY_REDUCED_QTY: {
    short: "Expiry cap",
    meaning: "Quantity reduced to the reorder point because existing batches are at expiry risk (never on stockout-risk lines)",
  },
  NO_ELIGIBLE_OFFER: { short: "No offer", meaning: "No approved, valid, available offer for this SKU" },
  BRIDGE_UNTIL_DELIVERY: {
    short: "Bridge order",
    meaning: "Stock runs out before the PO already on order arrives; a small top-up from a faster supplier covers the gap",
  },
};

/** Most specific first: the reason column shows the first one present. */
export const REASON_ORDER: ReasonCode[] = [
  "NO_ELIGIBLE_OFFER",
  "BRIDGE_UNTIL_DELIVERY",
  "STOCKOUT_BEFORE_DELIVERY",
  "CHEAPER_OFFER_TOO_SLOW",
  "SCHEME_SKIPPED_EXPIRY",
  "EXPIRY_REDUCED_QTY",
  "SCHEME_TAKEN",
  "BELOW_REORDER_POINT",
];

export const WARNING_TEXT: Record<WarningCode, { short: string; meaning: string }> = {
  NO_DEMAND: { short: "No demand", meaning: "Demand data quality: no sales in the demand window" },
  LOW_HISTORY: { short: "Low history", meaning: "Demand data quality: fewer than 28 days of sales history" },
  DEMAND_SPIKE: { short: "Demand spike", meaning: "Demand data quality: the last 7 days are well above the 28-day average" },
  AT_RISK_BATCHES: { short: "Batches at expiry risk", meaning: "This SKU already has batches at expiry risk" },
  SCHEME_EXCESS_RISK: { short: "Free goods risk", meaning: "Free goods may not sell before expiry" },
  PRICE_ANOMALY: { short: "Price anomaly", meaning: "This offer is more than 20% above the SKU's other offers" },
  NOT_TOP_SUPPLIER: { short: "Not top supplier", meaning: "User chose a supplier that is not the top-scored one" },
  CAPACITY_REVIEW: { short: "Capacity review", meaning: "No bin can take the proposed quantity; needs review" },
  UNMAPPED_STOCK: { short: "Unmapped stock", meaning: "Some stock of this SKU has no bin location" },
};

const HARD_STOP_TEXT: Record<string, string> = {
  INVALID_SKU: "The product is not active",
  SUPPLIER_NOT_APPROVED: "The supplier is not approved",
  QUOTE_EXPIRED: "The supplier's quote has expired",
  QUOTE_STALE: "The supplier's quote is too old",
  MISSING_PRICE: "The offer has no price",
  INVALID_PACK_MULTIPLE: "Quantity is not a multiple of the pack multiple",
  BELOW_MOQ: "Quantity is below the minimum order",
  ABOVE_AVAILABILITY: "Quantity is more than the supplier has",
  NON_POSITIVE_QTY: "Quantity must be at least one pack",
  PRODUCT_RECALLED: "The product has a recalled batch",
  OFFER_UNAVAILABLE: "The chosen offer is no longer available",
};

/** A defer reason is the owner's text, or a hard-stop code set by recalculation. */
export function deferReasonText(reason: string | null): string | null {
  if (!reason) return null;
  return HARD_STOP_TEXT[reason] ?? reason;
}
