// §6.5 — candidate rule, order quantity with pack/MOQ rounding, and the scheme decision.
import { dec, roundMoney } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { reorderPoint, targetStock } from "./inventory";
import type { Money, OrderQuantity, ReasonCode, SchemeDecision } from "./types";

/** d̄ > 0 and stock position < ROP at the fastest eligible offer's lead time. */
export function isCandidate(
  args: { avgDailyDemand: number; stockPosition: number; leadFastest: number },
  config: EngineConfig = ENGINE_CONFIG,
): boolean {
  return args.avgDailyDemand > 0 && args.stockPosition < reorderPoint(args.avgDailyDemand, args.leadFastest, config);
}

/** Round a raw quantity up to the pack multiple, then up to the MOQ (only when something is needed). */
function roundToPackRules(raw: number, moq: number, packMultiple: number): number {
  if (raw <= 0) return 0;
  const packs = dec(raw).dividedBy(packMultiple).ceil().times(packMultiple).toNumber();
  return Math.max(packs, moq);
}

/**
 * Per-offer quantity: order up to target(L_offer); when the SKU already has at-risk
 * batches, only up to ROP(L_offer) (reason EXPIRY_REDUCED_QTY).
 */
export function orderQuantity(
  args: {
    avgDailyDemand: number;
    stockPosition: number;
    leadTimeDays: number;
    moq: number;
    packMultiple: number;
    hasAtRiskBatches: boolean;
  },
  config: EngineConfig = ENGINE_CONFIG,
): OrderQuantity {
  const { avgDailyDemand, stockPosition, leadTimeDays, moq, packMultiple, hasAtRiskBatches } = args;
  const reasons: ReasonCode[] = [];
  const upTo = hasAtRiskBatches
    ? reorderPoint(avgDailyDemand, leadTimeDays, config)
    : targetStock(avgDailyDemand, leadTimeDays, config);
  if (hasAtRiskBatches) reasons.push("EXPIRY_REDUCED_QTY");
  const gap = dec(upTo).minus(stockPosition);
  const qRaw = gap.isNegative() ? 0 : gap.toNumber();
  return { qRaw, q: roundToPackRules(qRaw, moq, packMultiple), reasons };
}

/**
 * Take a "P + F" scheme only if everything received sells before the new batch's
 * sell-by date (shelf life − risk window). Otherwise skip it, unless the base
 * quantity already earns free goods (then warn SCHEME_EXCESS_RISK).
 */
export function applyScheme(
  args: {
    q: number;
    packMultiple: number;
    schemePaidQty: number;
    schemeFreeQty: number;
    stockPosition: number;
    avgDailyDemand: number;
    shelfLifeDays: number;
    /** Effective cost per pack without the scheme, for expiryAvoidedValue. */
    effectiveUnitCost: Money;
  },
  config: EngineConfig = ENGINE_CONFIG,
): SchemeDecision {
  const { q, packMultiple, schemePaidQty: paid, schemeFreeQty: free, stockPosition, avgDailyDemand, shelfLifeDays } = args;
  const none: SchemeDecision = { taken: false, qty: q, freeQty: 0, reason: null, warning: null, expiryAvoidedValue: "0.00" };
  if (q <= 0 || paid <= 0 || free <= 0) return none;

  const qScheme = Math.max(q, dec(paid).dividedBy(packMultiple).ceil().times(packMultiple).toNumber());
  const freeGoods = (qty: number) => Math.floor(qty / paid) * free;
  const received = qScheme + freeGoods(qScheme);
  const sellBy = shelfLifeDays - config.expiryRiskWindowDays;
  const sellsInTime = avgDailyDemand > 0 && dec(stockPosition).plus(received).dividedBy(avgDailyDemand).lessThan(sellBy);

  if (sellsInTime) {
    return { taken: true, qty: qScheme, freeQty: freeGoods(qScheme), reason: "SCHEME_TAKEN", warning: null, expiryAvoidedValue: "0.00" };
  }
  if (q >= paid) {
    // The base quantity already earns free goods; they arrive anyway but may not sell in time.
    return { taken: true, qty: q, freeQty: freeGoods(q), reason: null, warning: "SCHEME_EXCESS_RISK", expiryAvoidedValue: "0.00" };
  }
  return {
    taken: false,
    qty: q,
    freeQty: 0,
    reason: "SCHEME_SKIPPED_EXPIRY",
    warning: null,
    expiryAvoidedValue: roundMoney(dec(qScheme - q).times(args.effectiveUnitCost)).toFixed(2),
  };
}
