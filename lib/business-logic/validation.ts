// §6.11 — hard stops (block approval) and soft warnings (allowed with a note).
import { dec } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { daysBetween } from "./dates";
import type { BatchInput, HardStopCode, IsoDate, OfferInput, ProductInput, SupplierInput, WarningCode } from "./types";

/** Every hard stop for one line (block approval). There is no budget: spend is controlled by the PO approval limit. */
export function hardStops(
  args: {
    product: ProductInput | undefined;
    offer: OfferInput | undefined;
    supplier: SupplierInput | undefined;
    qty: number;
    asOf: IsoDate;
    batches: BatchInput[];
  },
  config: EngineConfig = ENGINE_CONFIG,
): HardStopCode[] {
  const { product, offer, supplier, qty, asOf, batches } = args;
  const stops = new Set<HardStopCode>();

  if (!product || !product.isActive || (offer && offer.productId !== product.id)) stops.add("INVALID_SKU");
  if (!supplier || supplier.approvedStatus !== "approved") stops.add("SUPPLIER_NOT_APPROVED");
  if (!offer || offer.unitPrice === null || !dec(offer.unitPrice).greaterThan(0)) stops.add("MISSING_PRICE");
  if (offer) {
    if (offer.validUntil.slice(0, 10) < asOf) stops.add("QUOTE_EXPIRED");
    if (daysBetween(offer.quotedAt.slice(0, 10), asOf) > config.quoteStaleDays) stops.add("QUOTE_STALE");
    if (qty > 0 && (offer.packMultiple <= 0 || qty % offer.packMultiple !== 0)) stops.add("INVALID_PACK_MULTIPLE");
    if (qty > 0 && qty < offer.moq) stops.add("BELOW_MOQ");
    if (qty > offer.availableQty) stops.add("ABOVE_AVAILABILITY");
  }
  if (!Number.isInteger(qty) || qty <= 0) stops.add("NON_POSITIVE_QTY");
  if (product && batches.some((b) => b.productId === product.id && b.qualityStatus === "recalled")) stops.add("PRODUCT_RECALLED");

  return [...stops];
}

/** Soft warnings in a fixed order; overriding them needs a note. */
export function softWarnings(args: {
  hasAtRiskBatches: boolean;
  chosenIsTopScored: boolean;
  demandFlags: WarningCode[];
  schemeWarning: WarningCode | null;
  priceAnomaly: boolean;
  capacityReview: boolean;
  hasUnmappedStock: boolean;
}): WarningCode[] {
  const out: WarningCode[] = [...args.demandFlags];
  if (args.hasAtRiskBatches) out.push("AT_RISK_BATCHES");
  if (!args.chosenIsTopScored) out.push("NOT_TOP_SUPPLIER");
  if (args.schemeWarning) out.push(args.schemeWarning);
  if (args.priceAnomaly) out.push("PRICE_ANOMALY");
  if (args.capacityReview) out.push("CAPACITY_REVIEW");
  if (args.hasUnmappedStock) out.push("UNMAPPED_STOCK");
  return [...new Set(out)];
}
