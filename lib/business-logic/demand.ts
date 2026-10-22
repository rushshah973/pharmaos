// §6.2 — demand: baseline 0.6·d7 + 0.4·d28, the ML forecast (§6.2a) when it won the backtest, and the
// NO_DEMAND / LOW_HISTORY / DEMAND_SPIKE flags.
import { dec } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { addDays, daysBetween } from "./dates";
import { baselineDaily, blendDaily, methodReason as mlMethodReason } from "@/lib/ml/backtest";
import type { DemandMethod, DemandResult, IsoDate, SalesPoint, SkuForecast, WarningCode } from "./types";

const SHORT_WINDOW = 7;
const LONG_WINDOW = 28;

export function computeDemand(
  sales: SalesPoint[],
  asOf: IsoDate,
  firstSaleDate: IsoDate | null,
  config: EngineConfig = ENGINE_CONFIG,
  forecast?: SkuForecast,
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
  // The average: trend-aware over the last 56 days (the reactive 0.6·d7 + 0.4·d28 on a spike), see lib/ml/backtest.
  const history56 = Array.from({ length: 56 }, (_, i) => byDate.get(addDays(asOf, i - 55)) ?? 0);
  const firstIdx = firstSaleDate === null ? 56 : Math.max(0, 55 - daysBetween(firstSaleDate, asOf));
  const baseline = dec(baselineDaily(history56.slice(firstIdx)));

  // §6.2a: d̄ is the chosen method's value — the Demand Agent's decision, else the default rule, else the baseline.
  const historyDays = firstSaleDate === null ? 0 : daysBetween(firstSaleDate, asOf) + 1;
  let method: DemandMethod = "baseline";
  let methodChosenBy: DemandResult["methodChosenBy"] = "no-model";
  let methodReason = "No demand model trained yet → using the average";
  if (forecast) {
    method = forecast.override?.method ?? forecast.defaultMethod;
    methodChosenBy = forecast.override ? "demand-agent" : "default";
    methodReason = forecast.override
      ? forecast.override.reason
      : mlMethodReason({ method, mlWape: forecast.mlWape, baselineWape: forecast.baselineWape, historyDays });
  }
  const avg = method === "ml" && forecast ? dec(blendDaily(forecast.mlDaily, baseline.toNumber())) : baseline;

  const flags: WarningCode[] = [];
  if (avg.isZero()) flags.push("NO_DEMAND");
  if (firstSaleDate === null || daysBetween(firstSaleDate, asOf) < LONG_WINDOW) flags.push("LOW_HISTORY");
  if (d28.greaterThan(0) && d7.dividedBy(d28).greaterThanOrEqualTo(config.spikeRatio)) flags.push("DEMAND_SPIKE");

  return {
    d7: d7.toNumber(),
    d28: d28.toNumber(),
    baseline: baseline.toNumber(),
    ml: forecast ? forecast.mlDaily : null,
    method,
    methodReason,
    methodChosenBy,
    mlWape: forecast?.mlWape ?? null,
    baselineWape: forecast?.baselineWape ?? null,
    forecast14: forecast ? forecast.series14.map((units, i) => ({ date: addDays(asOf, i + 1), units })) : [],
    mlExplain: forecast?.explain ?? null,
    avgDailyDemand: avg.toNumber(),
    windowDays: { short: SHORT_WINDOW, long: LONG_WINDOW },
    flags,
    dailySeries,
  };
}
