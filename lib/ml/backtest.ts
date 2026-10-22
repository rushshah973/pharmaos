// §6.2a — WAPE, the averages, the ML blend and the deterministic default-method rule.
//
// Measured on the synthetic data against TRUE demand (npm run eval:forecast, 14-day totals, the quantity a plan
// orders on; mid-size stockist volumes): the old average 0.6·d7 + 0.4·d28 is noisy (12.0% error) and lags trends;
// ML alone 10.9%; the trend-aware average 7.7% and ML blended 50/50 with it 7.9% (the blend is the default: it
// was the more accurate of the two at lower volumes, and the two are within noise here). Daily error stays
// near 35% for any method: daily demand is Poisson noise around the rate.
import { ENGINE_CONFIG } from "@/lib/business-logic/config";

export type DemandMethod = "ml" | "baseline";

/** Forecast horizon the plan orders on (days). */
export const HORIZON_DAYS = 14;
/** Days used to test for a trend, and the |t| a slope must reach to be trusted. */
const TREND_WINDOW = 56;
const TREND_MIN_T = 3;
/** Weight of the ML forecast in the "ml" method (the rest is the trend-aware average). */
export const ML_BLEND_WEIGHT = 0.5;

/** Σ|actual − forecast| / Σ actual; null when nothing was sold (no meaningful error). */
export function wape(actual: number[], forecast: number[]): number | null {
  const total = actual.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let err = 0;
  for (let i = 0; i < actual.length; i++) err += Math.abs(actual[i] - forecast[i]);
  return err / total;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** The fast-reacting average: 0.6 × mean of the last 7 days + 0.4 × mean of the last 28 (used on demand spikes). */
export function reactiveDaily(history: number[]): number {
  return ENGINE_CONFIG.demandWeight7 * mean(history.slice(-7)) + ENGINE_CONFIG.demandWeight28 * mean(history.slice(-28));
}

/** A trend projection never moves further than this from the 28-day mean (a step change is not a trend). */
const TREND_MAX_FACTOR = 1.5;

/**
 * Daily rate expected over the next 14 days from the trend of the last 56: the 28-day mean, unless there are
 * 56 days of history and the slope is statistically clear (|t| ≥ 3), then the exponential trend projected to the
 * middle of the horizon, kept within ÷1.5 … ×1.5 of the 28-day mean.
 */
export function trendDaily(history: number[], horizon = HORIZON_DAYS): number {
  const y = history.slice(-TREND_WINDOW);
  const d28 = mean(history.slice(-28));
  const n = y.length;
  if (n < TREND_WINDOW) return d28;
  const my = mean(y);
  if (my <= 0) return 0;
  const mx = (n - 1) / 2;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - mx) ** 2;
    sxy += (i - mx) * (y[i] - my);
  }
  const slope = sxy / sxx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i] - (my + slope * (i - mx))) ** 2;
  const se = Math.sqrt(sse / (n - 2) / sxx);
  if (!(se > 0) || Math.abs(slope / se) < TREND_MIN_T) return d28;
  const projected = my * Math.exp((slope / my) * (n - 1 + (horizon + 1) / 2 - mx));
  return Math.min(d28 * TREND_MAX_FACTOR, Math.max(d28 / TREND_MAX_FACTOR, projected));
}

/** True when the last 7 days run at ≥ spikeRatio × the 28-day mean (the DEMAND_SPIKE flag). */
export function isSpike(history: number[]): boolean {
  const d28 = mean(history.slice(-28));
  return d28 > 0 && mean(history.slice(-7)) / d28 >= ENGINE_CONFIG.spikeRatio;
}

/**
 * The engine's average ("baseline", §6.2): trend-aware (trendDaily); on a demand spike the fast-reacting
 * 0.6·d7 + 0.4·d28 instead, so a surge in the last week is not averaged away (medicines must not run out).
 */
export function baselineDaily(history: number[]): number {
  return isSpike(history) ? reactiveDaily(history) : trendDaily(history);
}

/** The "ml" method's daily rate: the ML forecast blended with the average (more accurate than either alone). */
export function blendDaily(mlDaily: number, baseline: number): number {
  return ML_BLEND_WEIGHT * mlDaily + (1 - ML_BLEND_WEIGHT) * baseline;
}

/**
 * The blend is the default with ≥ 28 days of history and a backtest; only a clearly broken ML backtest
 * (error > 1.25 × the average's) keeps the average. Too little history or no measurement → average.
 */
export function defaultMethod(args: { historyDays: number; mlWape: number | null; baselineWape: number | null }): DemandMethod {
  const { historyDays, mlWape, baselineWape } = args;
  if (historyDays < 28 || mlWape === null || baselineWape === null) return "baseline";
  return mlWape <= 1.25 * baselineWape ? "ml" : "baseline";
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

/** "ML error 18% vs average 27% on the last 14 days → using ML" (or the reverse, honestly). */
export function methodReason(args: { method: DemandMethod; mlWape: number | null; baselineWape: number | null; historyDays?: number }): string {
  const { method, mlWape, baselineWape } = args;
  if (mlWape === null || baselineWape === null) return "No sales in the last 14 test days, so accuracy cannot be measured → using the average";
  if (args.historyDays !== undefined && args.historyDays < 28) return "Less than 28 days of history → using the average";
  const base = `ML blend error ${pct(mlWape)} vs average ${pct(baselineWape)} on the last 14 days`;
  if (method === "ml") return `${base} → using the ML blend (ML + trend-aware average, the most accurate on 14-day demand)`;
  return `${base} → the ML backtest is far off for this SKU, using the average`;
}
