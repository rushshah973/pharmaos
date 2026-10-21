// §6.8 — loss prevented per rupee and the deterministic ranking order.
import type { EngineConfig } from "./config";
import type { Criticality, Money, PriorityKey } from "./types";
import { notImplemented } from "./_stub";

export const criticalityWeight: (criticality: Criticality, config?: EngineConfig) => number = () =>
  notImplemented("criticalityWeight");

/** shortfallDays × d̄ × unit margin × w_crit, rounded to paise. */
export const lossPrevented: (
  args: { leadTimeDays: number; cover: number | null; avgDailyDemand: number; unitMargin: Money; criticality: Criticality },
  config?: EngineConfig,
) => Money = () => notImplemented("lossPrevented");

export const priorityScore: (loss: Money, lineTotal: Money) => number = () => notImplemented("priorityScore");

/** Sort comparator: priority desc → cover asc → w_crit desc → key asc. */
export const comparePriority: (a: PriorityKey, b: PriorityKey) => number = () => notImplemented("comparePriority");
