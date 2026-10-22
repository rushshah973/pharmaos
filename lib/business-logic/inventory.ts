// §6.4 — confirmed incoming, stock position, cover, safety stock, ROP, target and SKU status.
import { dec } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { addDays } from "./dates";
import type { IncomingInput, IsoDate, SkuStatus } from "./types";

/** PO statuses whose stock is already on order: seeded 'open', and PharmaOS POs from 'ready' up to 'sent'. */
export const ON_ORDER_STATUSES = ["open", "ready", "pending_approval", "approved", "sent"] as const;
const ON_ORDER: ReadonlySet<string> = new Set(ON_ORDER_STATUSES);

/**
 * Σ packs (+ free) on POs already placed (ON_ORDER_STATUSES) expected on or before asOf + planning horizon.
 * Received, cancelled and rejected POs never count.
 */
export function confirmedIncoming(incoming: IncomingInput[], asOf: IsoDate, config: EngineConfig = ENGINE_CONFIG): number {
  const horizonEnd = addDays(asOf, config.planningHorizonDays);
  return incoming
    .filter((i) => ON_ORDER.has(i.status) && i.expectedDeliveryDate <= horizonEnd)
    .reduce((sum, i) => sum + i.quantityPacks + i.freeQty, 0);
}

/** Eligible available (reserved already subtracted in expiry.ts) + confirmed incoming. */
export function stockPosition(eligibleAvailable: number, confirmedIncomingQty: number): number {
  return dec(eligibleAvailable).plus(confirmedIncomingQty).toNumber();
}

/** Days of cover; null when d̄ = 0 ("No reliable demand estimate"). */
export function coverDays(stockPositionQty: number, avgDailyDemand: number): number | null {
  if (avgDailyDemand <= 0) return null;
  return dec(stockPositionQty).dividedBy(avgDailyDemand).toNumber();
}

/** max(minSafetyPacks, d̄ × safetyBufferDays). */
export function safetyStock(avgDailyDemand: number, config: EngineConfig = ENGINE_CONFIG): number {
  const byDays = dec(avgDailyDemand).times(config.safetyBufferDays);
  return (byDays.greaterThan(config.minSafetyPacks) ? byDays : dec(config.minSafetyPacks)).toNumber();
}

/** d̄ × L + safety. */
export function reorderPoint(avgDailyDemand: number, leadTimeDays: number, config: EngineConfig = ENGINE_CONFIG): number {
  return dec(avgDailyDemand).times(leadTimeDays).plus(safetyStock(avgDailyDemand, config)).toNumber();
}

/** d̄ × (L + R) + safety. */
export function targetStock(avgDailyDemand: number, leadTimeDays: number, config: EngineConfig = ENGINE_CONFIG): number {
  return dec(avgDailyDemand)
    .times(leadTimeDays + config.reviewPeriodDays)
    .plus(safetyStock(avgDailyDemand, config))
    .toNumber();
}

/**
 * Days until the stock position falls to the reorder point at today's demand — the "order by" lead (§6.4).
 * 0 when it is already at or below the ROP; null when there is no demand to project.
 */
export function daysUntilReorder(stockPositionQty: number, avgDailyDemand: number, reorderPointQty: number): number | null {
  if (avgDailyDemand <= 0) return null;
  const days = dec(stockPositionQty).minus(reorderPointQty).dividedBy(avgDailyDemand);
  return days.isNegative() ? 0 : days.toDecimalPlaces(1, 1).toNumber();
}

/** First match wins: NO_DEMAND → STOCKOUT_RISK → BELOW_ROP → EXCESS → HEALTHY. */
export function skuStatus(
  args: { avgDailyDemand: number; stockPosition: number; leadFastest: number },
  config: EngineConfig = ENGINE_CONFIG,
): SkuStatus {
  const { avgDailyDemand, stockPosition: position, leadFastest } = args;
  const cover = coverDays(position, avgDailyDemand);
  if (cover === null) return "NO_DEMAND";
  if (cover < leadFastest) return "STOCKOUT_RISK";
  if (position < reorderPoint(avgDailyDemand, leadFastest, config)) return "BELOW_ROP";
  if (dec(position).greaterThan(dec(targetStock(avgDailyDemand, leadFastest, config)).times(config.excessFactor))) return "EXCESS";
  return "HEALTHY";
}
