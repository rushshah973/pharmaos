// npm run eval:forecast — how accurate is demand forecasting, measured honestly on the synthetic data.
// Regenerates the seeded dataset in memory (same seed and as-of as `npm run seed`), hides the last 14 days,
// forecasts them from the days before, and compares with (a) recorded sales and (b) TRUE customer demand,
// which the generator knows (recorded sales are lower on stock-out days). Reports daily and 14-day-total
// error (the plan orders on 14-day demand), per method. Writes nothing.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { baselineDaily, blendDaily, reactiveDaily } from "@/lib/ml/backtest";
import { HISTORY_DAYS } from "@/lib/ml/features";
import { forecastRecursive } from "@/lib/ml/forecast";
import { trainModel } from "@/lib/ml/train";
import { SALES_DAYS, generate, type Profile } from "../seed/generate-synthetic";
import { injectDemoCases } from "../seed/inject-demo-cases";

const H = 14;
const asOf = process.env.DEMO_AS_OF_DATE?.trim() || "2026-10-21";
const profilePath = path.resolve("data/reference/profile.json");
const profile: Profile = existsSync(profilePath) ? JSON.parse(readFileSync(profilePath, "utf8")) : {};
const data = generate(profile, asOf, 42);
const cases = injectDemoCases(data, 42);
const injected = new Set(Object.values(cases).flat().filter((v): v is string => typeof v === "string"));

const salesBy = new Map<string, number[]>();
for (const r of data.salesHistory) (salesBy.get(r.product_id) ?? salesBy.set(r.product_id, []).get(r.product_id)!).push(r.units_sold);
const N = Math.min(...[...salesBy.values()].map((v) => v.length));
const start = N - H;
const firstDate = data.salesHistory.reduce((m, r) => (r.sale_date < m ? r.sale_date : m), "9999");
const firstDow = new Date(`${firstDate}T00:00:00Z`).getUTCDay();
const category = new Map(data.products.map((p) => [p.id, p.category]));
const skuOf = new Map(data.products.map((p) => [p.id, p.sku]));

// Train on everything before the evaluation window (the model never sees it).
const series = [...salesBy.entries()].map(([productId, values]) => ({ productId, category: category.get(productId)!, values: values.slice(0, start), firstIndex: 0 }));
const { model } = trainModel({ series, firstDow });

// True expected demand per day (the generator's rate): base × trend; a spike triples the last 5 days.
const rate = (pid: string, t: number) => {
  const { kind, basePacksPerDay: b } = data.meta.demandBySku[skuOf.get(pid)!];
  let l = b;
  if (kind === "growing") l *= 1.01 ** (t - (SALES_DAYS - 1));
  if (kind === "declining") l *= 0.99 ** (t - (SALES_DAYS - 1));
  if (kind === "spike" && t >= SALES_DAYS - 5) l *= 3;
  return l;
};
const methods = ["old average 0.6·d7 + 0.4·d28", "average (trend-aware)", "ML alone", "ML blend (default)"] as const;
type M = (typeof methods)[number];
type Acc = { rate: number; bias: number; realised: number; total: number; daily: number; dailyTotal: number };
const acc = Object.fromEntries(methods.map((m) => [m, { rate: 0, bias: 0, realised: 0, total: 0, daily: 0, dailyTotal: 0 }])) as unknown as Record<M, Acc>;
let lost = 0;
let wanted = 0;
let skus = 0;
for (const [pid, sold] of salesBy) {
  const kind = data.meta.demandBySku[skuOf.get(pid)!].kind;
  // Demo cases are hand-edited; a spike inside the test window cannot be foreseen from the days before it.
  if (injected.has(pid) || injected.has(skuOf.get(pid)!) || kind === "spike") continue;
  skus++;
  const hist = sold.slice(0, start);
  const truth = data.meta.trueDemand[pid];
  for (let t = 0; t < start; t++) {
    lost += truth[t] - hist[t];
    wanted += truth[t];
  }
  const actual = sold.slice(start, N);
  const rate14 = Array.from({ length: H }, (_, i) => rate(pid, start + i)).reduce((a, b) => a + b, 0);
  const realised14 = truth.slice(start, N).reduce((a, b) => a + b, 0);
  const avg = baselineDaily(hist);
  const ml = hist.length >= HISTORY_DAYS ? forecastRecursive(model, hist, (firstDow + start) % 7, category.get(pid)!, H) : new Array<number>(H).fill(avg);
  const daily: Record<M, number[]> = {
    "old average 0.6·d7 + 0.4·d28": new Array<number>(H).fill(reactiveDaily(hist)),
    "average (trend-aware)": new Array<number>(H).fill(avg),
    "ML alone": ml,
    "ML blend (default)": ml.map((v) => blendDaily(v, avg)),
  };
  for (const m of methods) {
    const f14 = daily[m].reduce((a, b) => a + b, 0);
    acc[m].rate += Math.abs(f14 - rate14);
    acc[m].bias += f14 - rate14;
    acc[m].total += rate14;
    acc[m].realised += Math.abs(f14 - realised14);
    for (let i = 0; i < H; i++) acc[m].daily += Math.abs(actual[i] - daily[m][i]);
    acc[m].dailyTotal += actual.reduce((a, b) => a + b, 0);
  }
}

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;
console.log(`Forecast evaluation · as of ${asOf} · last ${H} days held out · ${skus} SKUs (demo cases and future spikes excluded)`);
console.log(`Stock-outs in the history: ${pct(lost, wanted)} of customer demand went unsold (too little to bias the forecast).\n`);
console.log("method                          14-day error vs TRUE rate   bias      vs realised demand   daily error vs sales");
for (const m of methods) {
  const a = acc[m];
  console.log(`${m.padEnd(31)} ${pct(a.rate, a.total).padStart(12)}             ${pct(a.bias, a.total).padStart(6)}   ${pct(a.realised, a.total).padStart(12)}        ${pct(a.daily, a.dailyTotal).padStart(8)}`);
}
console.log("\nDaily error stays far above the 14-day error for every method: daily demand is random (Poisson) around the rate.");
