// §6.4 — confirmed incoming, stock position, cover, safety stock, ROP, target and SKU status.
import { dec } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { addDays, daysBetween } from "./dates";
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

/**
 * Days until stock runs out, with each PO counted on the day it arrives (not as if it were on the shelf now):
 * available stock falls by d̄ a day and jumps by each delivery on its expected date. With no gap before a
 * delivery this equals position ÷ d̄; when stock runs out before a PO arrives it is that earlier day.
 * Null when d̄ = 0. POs are the ones confirmedIncoming() counts (on order, due within the horizon).
 */
export function runOutDays(
  eligibleAvailable: number,
  incoming: IncomingInput[],
  avgDailyDemand: number,
  asOf: IsoDate,
  config: EngineConfig = ENGINE_CONFIG,
): number | null {
  if (avgDailyDemand <= 0) return null;
  const horizonEnd = addDays(asOf, config.planningHorizonDays);
  const arrivals = incoming
    .filter((i) => ON_ORDER.has(i.status) && i.expectedDeliveryDate <= horizonEnd)
    // An overdue PO (expected before today, not yet received) is treated as arriving today.
    .map((i) => ({ day: Math.max(0, daysBetween(asOf, i.expectedDeliveryDate)), qty: i.quantityPacks + i.freeQty }))
    .sort((a, b) => a.day - b.day);
  const d = dec(avgDailyDemand);
  let t = dec(0);
  let stock = dec(Math.max(0, eligibleAvailable));
  for (const a of arrivals) {
    const emptyAt = t.plus(stock.dividedBy(d));
    if (emptyAt.lessThan(a.day)) return emptyAt.toNumber();
    stock = stock.minus(d.times(dec(a.day).minus(t))).plus(a.qty);
    t = dec(a.day);
  }
  return t.plus(stock.dividedBy(d)).toNumber();
}

/**
 * Bridge top-up for a delivery gap: the shelf empties at `cover` and the PO on order arrives on `arrivalDay`.
 * An offer delivering on day L covers the days from max(cover, L) to the arrival: d̄ × that span, rounded to
 * the pack rules. Zero when the offer cannot arrive before the PO does.
 */
export function bridgeQuantity(args: { avgDailyDemand: number; cover: number; arrivalDay: number; leadTimeDays: number }): number {
  const { avgDailyDemand, cover, arrivalDay, leadTimeDays } = args;
  if (avgDailyDemand <= 0 || leadTimeDays >= arrivalDay) return 0;
  const days = dec(arrivalDay).minus(Math.max(cover, leadTimeDays));
  return days.greaterThan(0) ? dec(avgDailyDemand).times(days).toNumber() : 0;
}

/** Days of cover from the stock position (incoming counted as if on hand); null when d̄ = 0. */
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

/**
 * First match wins: NO_DEMAND → STOCKOUT_RISK → BELOW_ROP → EXCESS → HEALTHY. `cover` is the run-out day
 * (runOutDays); without it, position ÷ d̄. Stockout risk = the shelf is empty before the fastest supplier can
 * deliver, including when it empties before an existing PO arrives.
 */
export function skuStatus(
  args: { avgDailyDemand: number; stockPosition: number; leadFastest: number; cover?: number | null; shortBeforeDelivery?: boolean },
  config: EngineConfig = ENGINE_CONFIG,
): SkuStatus {
  const { avgDailyDemand, stockPosition: position, leadFastest } = args;
  const cover = args.cover !== undefined ? args.cover : coverDays(position, avgDailyDemand);
  if (cover === null) return "NO_DEMAND";
  if (cover < leadFastest || args.shortBeforeDelivery) return "STOCKOUT_RISK";
  if (position < reorderPoint(avgDailyDemand, leadFastest, config)) return "BELOW_ROP";
  if (dec(position).greaterThan(dec(targetStock(avgDailyDemand, leadFastest, config)).times(config.excessFactor))) return "EXCESS";
  return "HEALTHY";
}
