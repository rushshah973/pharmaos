// §6.8 — loss prevented per rupee and the deterministic ranking order.
import { dec, roundMoney } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import type { Criticality, Money, PriorityKey } from "./types";

export function criticalityWeight(criticality: Criticality, config: EngineConfig = ENGINE_CONFIG): number {
  return config.criticalityWeights[criticality];
}

/** shortfallDays × d̄ × unit margin × w_crit, rounded to paise. shortfallDays = max(0, L − cover). */
export function lossPrevented(
  args: { leadTimeDays: number; cover: number | null; avgDailyDemand: number; unitMargin: Money; criticality: Criticality },
  config: EngineConfig = ENGINE_CONFIG,
): Money {
  if (args.cover === null || args.avgDailyDemand <= 0) return "0.00";
  const shortfall = dec(args.leadTimeDays).minus(args.cover);
  if (!shortfall.greaterThan(0)) return "0.00";
  return roundMoney(
    shortfall.times(args.avgDailyDemand).times(args.unitMargin).times(criticalityWeight(args.criticality, config)),
  ).toFixed(2);
}

/** lossPrevented / lineTotal (0 when the line total is not positive). */
export function priorityScore(loss: Money, lineTotal: Money): number {
  const total = dec(lineTotal);
  return total.greaterThan(0) ? dec(loss).dividedBy(total).toNumber() : 0;
}

/** Sort comparator: priority desc → cover asc (no cover last) → w_crit desc → key asc. */
export function comparePriority(a: PriorityKey, b: PriorityKey): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const coverA = a.cover ?? Number.POSITIVE_INFINITY;
  const coverB = b.cover ?? Number.POSITIVE_INFINITY;
  if (coverA !== coverB) return coverA - coverB;
  if (a.criticalityWeight !== b.criticalityWeight) return b.criticalityWeight - a.criticalityWeight;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}
