// §6.6 — offer eligibility, effective landed cost, urgency rule, weighted score, price anomalies.
import type Decimal from "decimal.js";
import { dec, roundUnit } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { daysBetween } from "./dates";
import type {
  IsoDate,
  Money,
  OfferExclusionCode,
  OfferInput,
  ReasonCode,
  ScoreFactors,
  ScoreInput,
  ScoredOffer,
  SupplierInput,
  UrgencyResult,
} from "./types";

/** Every reason an offer cannot be used for this order (empty = eligible). */
export function offerExclusions(
  args: { offer: OfferInput; supplier: SupplierInput | undefined; productId: string; asOf: IsoDate; qty: number },
  config: EngineConfig = ENGINE_CONFIG,
): OfferExclusionCode[] {
  const { offer, supplier, productId, asOf, qty } = args;
  const codes: OfferExclusionCode[] = [];
  if (!supplier || supplier.approvedStatus !== "approved") codes.push("SUPPLIER_NOT_APPROVED");
  if (!offer.isActive) codes.push("OFFER_INACTIVE");
  if (offer.productId !== productId) codes.push("PRODUCT_MISMATCH");
  if (offer.unitPrice === null || !dec(offer.unitPrice).greaterThan(0)) codes.push("MISSING_PRICE");
  if (offer.moq <= 0 || offer.packMultiple <= 0) codes.push("INVALID_PACK_RULES");
  if (offer.validUntil.slice(0, 10) < asOf) codes.push("QUOTE_EXPIRED");
  if (daysBetween(offer.quotedAt.slice(0, 10), asOf) > config.quoteStaleDays) codes.push("QUOTE_STALE");
  if (offer.availableQty < qty) codes.push("INSUFFICIENT_AVAILABILITY");
  return codes;
}

/** grossPerPack × paidShare + freight, rounded to 4 dp. paidShare = P / (P + F) when the scheme is taken. */
export function effectiveUnitCost(args: {
  unitPrice: Money;
  taxRate: Money;
  freightPerPack: Money;
  schemePaidQty: number | null;
  schemeFreeQty: number | null;
  schemeTaken: boolean;
}): Money {
  const gross = dec(args.unitPrice).times(dec(1).plus(dec(args.taxRate).dividedBy(100)));
  const { schemePaidQty: p, schemeFreeQty: f } = args;
  const paidShare = args.schemeTaken && p && f ? dec(p).dividedBy(p + f) : dec(1);
  return roundUnit(gross.times(paidShare).plus(args.freightPerPack)).toFixed(4);
}

/**
 * If at least one offer delivers within the cover, drop the slower ones (TOO_SLOW_FOR_COVER).
 * If none does, keep only the fastest and flag STOCKOUT_BEFORE_DELIVERY.
 * Either way, dropping the cheapest offer adds CHEAPER_OFFER_TOO_SLOW to the line.
 */
export function applyUrgencyRule(
  offers: { offerId: string; leadTimeDays: number; effectiveCost: Money }[],
  cover: number | null,
): UrgencyResult {
  if (offers.length === 0 || cover === null) return { kept: offers.map((o) => o.offerId), dropped: [], lineReasons: [] };

  const lineReasons: ReasonCode[] = [];
  const fast = offers.filter((o) => o.leadTimeDays <= cover);
  let keep: typeof offers;
  if (fast.length > 0) {
    keep = fast;
  } else {
    const fastestLead = Math.min(...offers.map((o) => o.leadTimeDays));
    keep = offers.filter((o) => o.leadTimeDays === fastestLead);
    lineReasons.push("STOCKOUT_BEFORE_DELIVERY");
  }
  const kept = new Set(keep.map((o) => o.offerId));
  const dropped = offers.filter((o) => !kept.has(o.offerId)).map((o) => ({ offerId: o.offerId, code: "TOO_SLOW_FOR_COVER" as const }));

  const cheapestCost = offers.reduce((min, o) => (dec(o.effectiveCost).lessThan(min) ? dec(o.effectiveCost) : min), dec(offers[0].effectiveCost));
  const cheapestDropped = offers.some((o) => !kept.has(o.offerId) && dec(o.effectiveCost).equals(cheapestCost));
  const cheapestKept = offers.some((o) => kept.has(o.offerId) && dec(o.effectiveCost).equals(cheapestCost));
  if (cheapestDropped && !cheapestKept) lineReasons.push("CHEAPER_OFFER_TOO_SLOW");

  return { kept: offers.filter((o) => kept.has(o.offerId)).map((o) => o.offerId), dropped, lineReasons };
}

/** 100 × (max − x) / (max − min); all equal → 100. Lower is better. */
function lowerIsBetter(x: Decimal, min: Decimal, max: Decimal): Decimal {
  return max.equals(min) ? dec(100) : dec(100).times(max.minus(x)).dividedBy(max.minus(min));
}

/** Scores every offer (factors 0–100) and returns them best first. */
export function scoreOffers(offers: ScoreInput[], config: EngineConfig = ENGINE_CONFIG): ScoredOffer[] {
  if (offers.length === 0) return [];
  const costs = offers.map((o) => dec(o.effectiveCost));
  const leads = offers.map((o) => dec(o.leadTimeDays));
  const minMax = (xs: Decimal[]) => [xs.reduce((a, b) => (b.lessThan(a) ? b : a)), xs.reduce((a, b) => (b.greaterThan(a) ? b : a))];
  const [minCost, maxCost] = minMax(costs);
  const [minLead, maxLead] = minMax(leads);
  const w = config.supplierWeights;
  const cap = config.paymentTermsCapDays;

  const scored = offers.map((o, i) => {
    const cost = lowerIsBetter(costs[i], minCost, maxCost);
    const leadTime = lowerIsBetter(leads[i], minLead, maxLead);
    const reliability = o.reliabilityScore === null ? dec(0) : dec(o.reliabilityScore);
    const terms = o.paymentTermsDays === null ? dec(0) : dec(100).times(Math.min(o.paymentTermsDays, cap)).dividedBy(cap);
    const score = cost.times(w.cost).plus(leadTime.times(w.leadTime)).plus(reliability.times(w.reliability)).plus(terms.times(w.terms));
    const factors: ScoreFactors = { cost: cost.toNumber(), leadTime: leadTime.toNumber(), reliability: reliability.toNumber(), terms: terms.toNumber() };
    return { offer: o, cost: costs[i], scoreDec: score, scored: { ...o, factors, score: score.toNumber() } };
  });

  // Highest score; ties → lower effective cost → shorter lead time → supplier code.
  scored.sort(
    (a, b) =>
      b.scoreDec.comparedTo(a.scoreDec) ||
      a.cost.comparedTo(b.cost) ||
      a.offer.leadTimeDays - b.offer.leadTimeDays ||
      a.offer.supplierCode.localeCompare(b.offer.supplierCode),
  );
  return scored.map((s) => s.scored);
}

/** Offer ids priced above 1.2 × the median unit price of the SKU's other offers. */
export function priceAnomalies(offers: { offerId: string; unitPrice: Money }[]): string[] {
  const flagged: string[] = [];
  for (const o of offers) {
    const others = offers
      .filter((x) => x.offerId !== o.offerId)
      .map((x) => dec(x.unitPrice))
      .sort((a, b) => a.comparedTo(b));
    if (others.length === 0) continue;
    const mid = Math.floor(others.length / 2);
    const median = others.length % 2 ? others[mid] : others[mid - 1].plus(others[mid]).dividedBy(2);
    if (dec(o.unitPrice).greaterThan(median.times(1.2))) flagged.push(o.offerId);
  }
  return flagged;
}
