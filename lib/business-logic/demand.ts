// §6.2 — demand baseline d̄ = 0.6·d7 + 0.4·d28, plus NO_DEMAND / LOW_HISTORY / DEMAND_SPIKE flags.
import { dec } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { addDays, daysBetween } from "./dates";
import type { DemandResult, IsoDate, SalesPoint, WarningCode } from "./types";

const SHORT_WINDOW = 7;
const LONG_WINDOW = 28;

export function computeDemand(
  sales: SalesPoint[],
  asOf: IsoDate,
  firstSaleDate: IsoDate | null,
  config: EngineConfig = ENGINE_CONFIG,
): DemandResult {
  // Packs sold per day (several points for one day are added; a missing day = 0).
  const byDate = new Map<IsoDate, number>();
  for (const s of sales) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.units);

  const dailySeries: SalesPoint[] = [];
  let sum7 = dec(0);
  let sum28 = dec(0);
  for (let ago = LONG_WINDOW - 1; ago >= 0; ago--) {
    const date = addDays(asOf, -ago);
    const units = byDate.get(date) ?? 0;
    dailySeries.push({ date, units });
    sum28 = sum28.plus(units);
    if (ago < SHORT_WINDOW) sum7 = sum7.plus(units);
  }

  const d7 = sum7.dividedBy(SHORT_WINDOW);
  const d28 = sum28.dividedBy(LONG_WINDOW);
  const avg = d7.times(config.demandWeight7).plus(d28.times(config.demandWeight28));

  const flags: WarningCode[] = [];
  if (avg.isZero()) flags.push("NO_DEMAND");
  if (firstSaleDate === null || daysBetween(firstSaleDate, asOf) < LONG_WINDOW) flags.push("LOW_HISTORY");
  if (d28.greaterThan(0) && d7.dividedBy(d28).greaterThanOrEqualTo(config.spikeRatio)) flags.push("DEMAND_SPIKE");

  return {
    d7: d7.toNumber(),
    d28: d28.toNumber(),
    avgDailyDemand: avg.toNumber(),
    windowDays: { short: SHORT_WINDOW, long: LONG_WINDOW },
    flags,
    dailySeries,
  };
}
