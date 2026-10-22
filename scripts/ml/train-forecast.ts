// npm run train:forecast — train the ML demand model on the seeded sales, backtest every SKU on the last
// 14 days, store it and print the honest result (implementationplan.md §6.2a). Also run at the end of `npm run seed`.
import { config } from "dotenv";
import postgres from "postgres";
import { trainAndStoreModel } from "@/lib/services/forecast-model";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

export async function trainForecast(sql: postgres.Sql) {
  const { model, perSku, ms } = await trainAndStoreModel({ type: "system", id: "train-forecast" }, sql);
  const m = model.metrics;
  console.log(`\nDemand model trained in ${ms} ms (as of ${model.asOf}, synthetic demo data)`);
  console.log(`  rows ${m.trainRows.toLocaleString("en-IN")} · features ${model.featureNames.length} · λ ${model.lambda}`);
  console.log(`  λ validation (last 14 days before the holdout): ${m.validation.map((v) => `λ ${v.lambda} → ${pct(v.wape)}`).join(" · ")}`);
  console.log(`  holdout (last 14 days, never seen in training), daily error: ML blend ${pct(m.mlWape)} vs average ${pct(m.baselineWape)}`);
  if (m.horizon)
    console.log(
      `  14-day demand error (what a plan orders on): ML blend ${pct(m.horizon.blend)} · ML alone ${pct(m.horizon.ml)} · trend-aware average ${pct(m.horizon.average)} · old 0.6·d7+0.4·d28 ${pct(m.horizon.oldAverage)}`,
    );
  console.log(`  SKUs using ML: ${m.skusUsingMl} of ${perSku.length} (the rest keep the average because ML did not win for them)`);
  return model;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local).");
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    await trainForecast(sql);
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("train-forecast.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
