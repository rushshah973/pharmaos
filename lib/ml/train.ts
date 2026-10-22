// §6.2a — train the global ridge model, pick λ on a validation slice, refit, and backtest every SKU.
// Pure and deterministic: the same series give the same model.
import { HISTORY_DAYS, buildFeatures, featureNames } from "./features";
import { baselineDaily, blendDaily, defaultMethod, type DemandMethod, reactiveDaily, wape } from "./backtest";
import { forecastRecursive } from "./forecast";
import { type RidgeModel, fitRidge } from "./ridge";

export type TrainingSeries = {
  productId: string;
  category: string;
  /** Packs sold per day, oldest first, every SKU on the same calendar (index 0 = the same date for all). */
  values: number[];
  /** Index of the SKU's first sale day (days before it are not history). */
  firstIndex: number;
};

export type SkuBacktest = { productId: string; mlWape: number | null; baselineWape: number | null; defaultMethod: DemandMethod; historyDays: number };

export type TrainResult = {
  model: RidgeModel;
  perSku: SkuBacktest[];
  metrics: {
    mlWape: number | null;
    baselineWape: number | null;
    skusUsingMl: number;
    trainRows: number;
    validation: { lambda: number; wape: number | null }[];
    /** Error on 14-day totals (what a plan orders), pooled over SKUs, on the holdout vs recorded sales. */
    horizon?: { blend: number | null; ml: number | null; average: number | null; oldAverage: number | null };
  };
};

export const LAMBDA_GRID = [0.1, 1, 10, 100] as const;

function rows(series: TrainingSeries[], firstDow: number, categories: string[], from: number, to: number) {
  const X: number[][] = [];
  const y: number[] = [];
  for (const s of series) {
    for (let t = Math.max(from, s.firstIndex + HISTORY_DAYS); t < to; t++) {
      X.push(buildFeatures(s.values.slice(0, t), (firstDow + t) % 7, s.category, categories));
      y.push(s.values[t]);
    }
  }
  return { X, y };
}

/** Pooled WAPE across SKUs: Σ|errors| / Σ actuals. */
function pooled(pairs: { actual: number[]; forecast: number[] }[]): number | null {
  return wape(
    pairs.flatMap((p) => p.actual),
    pairs.flatMap((p) => p.forecast),
  );
}

/** `firstDow` = day of week (0 = Sunday) of index 0. */
export function trainModel(args: { series: TrainingSeries[]; firstDow: number; holdoutDays?: number; lambdas?: readonly number[] }): TrainResult {
  const H = args.holdoutDays ?? 14;
  const lambdas = args.lambdas ?? LAMBDA_GRID;
  const series = [...args.series].sort((a, b) => a.productId.localeCompare(b.productId));
  const N = Math.min(...series.map((s) => s.values.length));
  const categories = [...new Set(series.map((s) => s.category))].sort();
  const names = featureNames(categories);
  const holdoutStart = N - H;
  const validationStart = holdoutStart - H;
  if (validationStart <= HISTORY_DAYS) throw new Error(`Need more than ${HISTORY_DAYS + 2 * H} days of sales to train, got ${N}.`);

  const recursiveFrom = (model: RidgeModel, start: number) =>
    series
      .filter((s) => start - s.firstIndex >= HISTORY_DAYS)
      .map((s) => ({
        actual: s.values.slice(start, start + H),
        forecast: forecastRecursive(model, s.values.slice(0, start), (args.firstDow + start) % 7, s.category, H),
      }));

  // 1. λ: fit on days before the validation slice, score the 14 validation days recursively.
  const early = rows(series, args.firstDow, categories, 0, validationStart);
  const validation = lambdas.map((lambda) => ({ lambda, wape: pooled(recursiveFrom(fitRidge(early.X, early.y, lambda, names), validationStart)) }));
  const best = validation.reduce((a, b) => ((b.wape ?? Infinity) < (a.wape ?? Infinity) ? b : a));

  // 2. Refit on every training day (all but the holdout) with the chosen λ.
  const train = rows(series, args.firstDow, categories, 0, holdoutStart);
  const model = fitRidge(train.X, train.y, best.lambda, names);

  // 3. Backtest each SKU on the holdout: ML recursive vs the baseline held flat from the holdout start.
  const perSku: SkuBacktest[] = [];
  const mlPairs: { actual: number[]; forecast: number[] }[] = [];
  const basePairs: { actual: number[]; forecast: number[] }[] = [];
  const totals = { actual: [] as number[], blend: [] as number[], ml: [] as number[], average: [] as number[], oldAverage: [] as number[] };
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  for (const s of series) {
    const historyDays = holdoutStart - s.firstIndex;
    const actual = s.values.slice(holdoutStart, N);
    const history = s.values.slice(0, holdoutStart);
    const canForecast = historyDays >= HISTORY_DAYS;
    const own = history.slice(Math.max(0, s.firstIndex));
    const baseDaily = baselineDaily(own);
    const pureMl = canForecast ? forecastRecursive(model, history, (args.firstDow + holdoutStart) % 7, s.category, H) : null;
    // The "ml" method is the blend: each day's ML forecast mixed with the average (as the engine uses it).
    const ml = pureMl ? pureMl.map((v) => blendDaily(v, baseDaily)) : null;
    const base = new Array<number>(H).fill(baseDaily);
    if (pureMl) {
      totals.actual.push(sum(actual));
      totals.blend.push(sum(ml!));
      totals.ml.push(sum(pureMl));
      totals.average.push(baseDaily * H);
      totals.oldAverage.push(reactiveDaily(own) * H);
    }
    const mlWape = ml ? wape(actual, ml) : null;
    const baselineWape = wape(actual, base);
    if (ml) {
      mlPairs.push({ actual, forecast: ml });
      basePairs.push({ actual, forecast: base });
    }
    perSku.push({ productId: s.productId, mlWape, baselineWape, defaultMethod: defaultMethod({ historyDays, mlWape, baselineWape }), historyDays });
  }

  return {
    model,
    perSku,
    metrics: {
      mlWape: pooled(mlPairs),
      baselineWape: pooled(basePairs),
      skusUsingMl: perSku.filter((s) => s.defaultMethod === "ml").length,
      trainRows: train.X.length,
      validation,
      horizon: {
        blend: wape(totals.actual, totals.blend),
        ml: wape(totals.actual, totals.ml),
        average: wape(totals.actual, totals.average),
        oldAverage: wape(totals.actual, totals.oldAverage),
      },
    },
  };
}
