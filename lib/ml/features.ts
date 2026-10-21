// §6.2a — features for one (SKU, day t), built only from the days before t. Plain numbers: this is demand, not money.

/** Days of history every feature row needs. */
export const HISTORY_DAYS = 28;

const BASE = ["lag1", "lag7", "mean7", "mean28", "std28", "zeroShare28", "trend28"] as const;
/** Day-of-week one-hot; Monday is the reference (all zero). Index = JS getUTCDay() (0 = Sunday). */
const DOW: Record<number, string | null> = { 0: "dow_sun", 1: null, 2: "dow_tue", 3: "dow_wed", 4: "dow_thu", 5: "dow_fri", 6: "dow_sat" };
const DOW_NAMES = ["dow_tue", "dow_wed", "dow_thu", "dow_fri", "dow_sat", "dow_sun"];

export function featureNames(categories: string[]): string[] {
  return [...BASE, ...DOW_NAMES, ...categories.map((c) => `cat_${c}`)];
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** OLS slope of the values against 0 … n−1. */
function slope(ys: number[]): number {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * `history` = packs sold per day before t, oldest first (at least 28 days); `dow` = day of week of t.
 * Returns values in `featureNames(categories)` order.
 */
export function buildFeatures(history: number[], dow: number, category: string, categories: string[]): number[] {
  if (history.length < HISTORY_DAYS) throw new Error(`buildFeatures needs ${HISTORY_DAYS} days of history, got ${history.length}`);
  const last28 = history.slice(-HISTORY_DAYS);
  const last7 = history.slice(-7);
  const m28 = mean(last28);
  const std28 = Math.sqrt(mean(last28.map((v) => (v - m28) ** 2)));
  const base = [
    history[history.length - 1],
    history[history.length - 7],
    mean(last7),
    m28,
    std28,
    last28.filter((v) => v === 0).length / HISTORY_DAYS,
    slope(last28),
  ];
  const dowName = DOW[dow];
  const dows = DOW_NAMES.map((n) => (n === dowName ? 1 : 0));
  const cats = categories.map((c) => (c === category ? 1 : 0));
  return [...base, ...dows, ...cats];
}
