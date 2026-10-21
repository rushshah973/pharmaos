// §6.2a — recursive multi-day forecast: each day's prediction becomes the next day's lag.
import { buildFeatures } from "./features";
import { type RidgeModel, predict } from "./ridge";

/** Categories in model order, read from its `cat_*` feature names. */
export const modelCategories = (model: RidgeModel) => model.featureNames.filter((n) => n.startsWith("cat_")).map((n) => n.slice(4));

/**
 * `history` = packs sold per day up to the day before the first forecast day, oldest first (≥ 28 days);
 * `firstDow` = day of week (0 = Sunday) of the first forecast day. Predictions are never below 0.
 */
export function forecastRecursive(model: RidgeModel, history: number[], firstDow: number, category: string, horizon = 14): number[] {
  const categories = modelCategories(model);
  const series = [...history];
  const out: number[] = [];
  for (let h = 0; h < horizon; h++) {
    const y = Math.max(0, predict(model, buildFeatures(series, (firstDow + h) % 7, category, categories)));
    out.push(y);
    series.push(y);
  }
  return out;
}
