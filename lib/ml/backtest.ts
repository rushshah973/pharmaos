// §6.2a — WAPE, the flat baseline, and the deterministic default-method rule.

export type DemandMethod = "ml" | "baseline";

/** Σ|actual − forecast| / Σ actual; null when nothing was sold (no meaningful error). */
export function wape(actual: number[], forecast: number[]): number | null {
  const total = actual.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let err = 0;
  for (let i = 0; i < actual.length; i++) err += Math.abs(actual[i] - forecast[i]);
  return err / total;
}

/** The engine's baseline (§6.2): 0.6 × mean of the last 7 days + 0.4 × mean of the last 28. */
export function baselineDaily(history: number[]): number {
  const last = (n: number) => history.slice(-n);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return 0.6 * mean(last(7)) + 0.4 * mean(last(28));
}

/** ML only with ≥ 28 days of history and an ML error at least 5% (relative) below the baseline's; ties and null → baseline. */
export function defaultMethod(args: { historyDays: number; mlWape: number | null; baselineWape: number | null }): DemandMethod {
  const { historyDays, mlWape, baselineWape } = args;
  if (historyDays < 28 || mlWape === null || baselineWape === null) return "baseline";
  return mlWape <= 0.95 * baselineWape && mlWape < baselineWape ? "ml" : "baseline";
}

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

/** "ML error 18% vs average 27% on the last 14 days → using ML" (or the reverse, honestly). */
export function methodReason(args: { method: DemandMethod; mlWape: number | null; baselineWape: number | null; historyDays?: number }): string {
  const { method, mlWape, baselineWape } = args;
  if (mlWape === null || baselineWape === null) return "No sales in the last 14 test days, so accuracy cannot be measured → using the average";
  if (args.historyDays !== undefined && args.historyDays < 28) return "Less than 28 days of history → using the average";
  const base = `ML error ${pct(mlWape)} vs average ${pct(baselineWape)} on the last 14 days`;
  if (method === "ml") return `${base} → using ML`;
  return mlWape < baselineWape ? `${base} → ML is not at least 5% better, using the average` : `${base} → using the average`;
}
