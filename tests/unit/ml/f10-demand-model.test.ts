// F10 — demand model (implementationplan.md §6.2a, §14.1).
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/business-logic/dates";
import { computeDemand } from "@/lib/business-logic/demand";
import { baselineDaily, defaultMethod, wape } from "@/lib/ml/backtest";
import { buildFeatures, featureNames } from "@/lib/ml/features";
import { forecastRecursive } from "@/lib/ml/forecast";
import { type RidgeModel, solveRidge } from "@/lib/ml/ridge";
import { type TrainingSeries, trainModel } from "@/lib/ml/train";

const CATEGORIES = ["analgesic", "cardiac"];

describe("F10 ridge solver", () => {
  it("matches a hand-solved 2-feature problem (λ = 1)", () => {
    // X = [[1,0],[0,1],[1,1]], y = [1,2,3] → XᵀX = [[2,1],[1,2]], Xᵀy = [4,5]
    // (XᵀX + I) w = Xᵀy → [[3,1],[1,3]] w = [4,5] → w = [7/8, 11/8]
    const w = solveRidge(
      [
        [2, 1],
        [1, 2],
      ],
      [4, 5],
      1,
    );
    expect(w[0]).toBeCloseTo(0.875, 9);
    expect(w[1]).toBeCloseTo(1.375, 9);
  });
});

describe("F10 feature builder", () => {
  it("computes lags, means, std, zero share and slope from days before t only", () => {
    const history = Array.from({ length: 35 }, (_, i) => i); // 0 … 34; the last 28 are 7 … 34
    const names = featureNames(CATEGORIES);
    const f = Object.fromEntries(buildFeatures(history, 2, "cardiac", CATEGORIES).map((v, i) => [names[i], v]));
    expect(f.lag1).toBe(34);
    expect(f.lag7).toBe(28);
    expect(f.mean7).toBe(31);
    expect(f.mean28).toBe(20.5);
    expect(f.std28).toBeCloseTo(8.077747210701755, 9);
    expect(f.zeroShare28).toBe(0);
    expect(f.trend28).toBeCloseTo(1, 12);
    // Day of week: Tuesday (2) is one-hot, Monday is the reference (all zero).
    expect(f.dow_tue).toBe(1);
    expect(f.dow_sun).toBe(0);
    expect(f.cat_cardiac).toBe(1);
    expect(f.cat_analgesic).toBe(0);
    const monday = buildFeatures(history, 1, "analgesic", CATEGORIES);
    expect(names.filter((n) => n.startsWith("dow_")).every((n) => monday[names.indexOf(n)] === 0)).toBe(true);
  });

  it("measures zero share and trend on an intermittent series", () => {
    const history = Array.from({ length: 28 }, (_, i) => (i % 2 === 0 ? 0 : 2));
    const names = featureNames(CATEGORIES);
    const f = Object.fromEntries(buildFeatures(history, 0, "analgesic", CATEGORIES).map((v, i) => [names[i], v]));
    expect(f.zeroShare28).toBe(0.5);
    expect(f.mean28).toBe(1);
    expect(f.std28).toBe(1);
    expect(f.trend28).toBeCloseTo(0.007662835249042145, 12);
    expect(f.dow_sun).toBe(1);
  });

  it("needs 28 days of history", () => {
    expect(() => buildFeatures([1, 2, 3], 1, "cardiac", CATEGORIES)).toThrow();
  });
});

describe("F10 recursive forecast", () => {
  it("feeds its own predictions back as later lags, and never goes below 0", () => {
    const names = featureNames(CATEGORIES);
    const coefficients = names.map((n) => (n === "lag1" ? 1 : 0));
    const model: RidgeModel = {
      featureNames: names,
      means: names.map(() => 0),
      stds: names.map(() => 1),
      coefficients,
      intercept: 1,
      lambda: 1,
    };
    const history = Array.from({ length: 28 }, () => 5);
    // ŷ(t) = 1 + lag1 → 6, 7, 8 … only if each prediction becomes the next lag1.
    expect(forecastRecursive(model, history, 1, "cardiac", 4)).toEqual([6, 7, 8, 9]);
    const falling: RidgeModel = { ...model, intercept: -10 };
    expect(forecastRecursive(falling, history, 1, "cardiac", 3)).toEqual([0, 0, 0]);
  });
});

describe("F10 WAPE and the default-method rule", () => {
  it("WAPE = Σ|actual − forecast| / Σ actual, null when nothing sold", () => {
    expect(wape([10, 0, 5], [8, 2, 5])).toBeCloseTo(4 / 15, 12);
    expect(wape([0, 0], [1, 2])).toBeNull();
  });

  it("baseline = 0.6 × mean of the last 7 days + 0.4 × mean of the last 28", () => {
    const history = [...Array.from({ length: 21 }, () => 0), ...Array.from({ length: 7 }, () => 7)];
    expect(baselineDaily(history)).toBeCloseTo(0.6 * 7 + 0.4 * (49 / 28), 12);
  });

  it("uses ML only with ≥ 28 days of history and ML WAPE ≤ 0.95 × baseline WAPE", () => {
    expect(defaultMethod({ historyDays: 28, mlWape: 0.18, baselineWape: 0.27 })).toBe("ml");
    expect(defaultMethod({ historyDays: 40, mlWape: 0.19, baselineWape: 0.2 })).toBe("ml"); // exactly 5% better
    expect(defaultMethod({ historyDays: 40, mlWape: 0.195, baselineWape: 0.2 })).toBe("baseline"); // only 2.5% better
    expect(defaultMethod({ historyDays: 27, mlWape: 0.1, baselineWape: 0.5 })).toBe("baseline"); // too little history
    expect(defaultMethod({ historyDays: 40, mlWape: 0.2, baselineWape: 0.2 })).toBe("baseline"); // tie
    expect(defaultMethod({ historyDays: 40, mlWape: 0, baselineWape: 0 })).toBe("baseline"); // tie at zero
    expect(defaultMethod({ historyDays: 40, mlWape: null, baselineWape: null })).toBe("baseline");
  });
});

describe("F10 training", () => {
  // A small deterministic dataset: weekday pattern plus a trend on half the SKUs.
  const series: TrainingSeries[] = Array.from({ length: 6 }, (_, k) => ({
    productId: `p${k}`,
    category: CATEGORIES[k % 2],
    firstIndex: 0,
    values: Array.from({ length: 80 }, (_, d) => Math.max(0, Math.round(4 + (d % 7 === 0 ? 3 : 0) + (k % 2 ? d * 0.05 : 0) + ((d * 7 + k * 3) % 5) - 2))),
  }));

  it("is deterministic: the same rows give identical coefficients", () => {
    const a = trainModel({ series, firstDow: 1 });
    const b = trainModel({ series, firstDow: 1 });
    expect(a.model.coefficients).toEqual(b.model.coefficients);
    expect(a.model.intercept).toBe(b.model.intercept);
    expect(a.model.lambda).toBe(b.model.lambda);
    expect(a.perSku).toEqual(b.perSku);
  });

  it("picks λ from the fixed grid and backtests every SKU", () => {
    const r = trainModel({ series, firstDow: 1 });
    expect([0.1, 1, 10, 100]).toContain(r.model.lambda);
    expect(r.perSku).toHaveLength(series.length);
    expect(r.metrics.trainRows).toBe(series.length * (80 - 14 - 28));
    for (const s of r.perSku) expect(["ml", "baseline"]).toContain(s.defaultMethod);
  });
});

describe("F10 engine demand method", () => {
  const asOf = "2026-10-21";
  const sales = Array.from({ length: 28 }, (_, i) => ({ date: addDays(asOf, -i), units: 4 }));
  const forecast = {
    mlDaily: 6,
    series14: Array.from({ length: 14 }, () => 6),
    mlWape: 0.2,
    baselineWape: 0.4,
    defaultMethod: "ml" as const,
    explain: { intercept: 4, top: [] },
  };

  it("uses the baseline without a model", () => {
    const d = computeDemand(sales, asOf, "2026-01-01");
    expect(d.method).toBe("baseline");
    expect(d.methodChosenBy).toBe("no-model");
    expect(d.avgDailyDemand).toBe(4);
    expect(d.forecast14).toEqual([]);
  });

  it("uses ML when the default rule picked it, with the honest reason", () => {
    const d = computeDemand(sales, asOf, "2026-01-01", undefined, forecast);
    expect(d.method).toBe("ml");
    expect(d.avgDailyDemand).toBe(6);
    expect(d.baseline).toBe(4);
    expect(d.methodReason).toBe("ML error 20% vs average 40% on the last 14 days → using ML");
    expect(d.forecast14[0]).toEqual({ date: "2026-10-22", units: 6 });
  });

  it("honours a Demand Agent override", () => {
    const d = computeDemand(sales, asOf, "2026-01-01", undefined, { ...forecast, override: { method: "baseline", reason: "Spike is a one-off festival order" } });
    expect(d.method).toBe("baseline");
    expect(d.methodChosenBy).toBe("demand-agent");
    expect(d.avgDailyDemand).toBe(4);
  });
});
