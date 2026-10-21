// Train, store and load the ML demand model (implementationplan.md §6.2a). The maths is in lib/ml (pure);
// this service only reads sales, writes forecast_models / sku_forecast_metrics and audits.
import type postgres from "postgres";
import { addDays, daysBetween } from "@/lib/business-logic/dates";
import { getSql } from "@/lib/db/client";
import type { DemandMethod } from "@/lib/ml/backtest";
import type { RidgeModel } from "@/lib/ml/ridge";
import { type TrainResult, trainModel } from "@/lib/ml/train";
import { resolvePlanningState } from "./as-of";
import { type SqlHandle, writeAudit } from "./audit";

/** Days of sales used for training: 28 of history + 14 validation + 14 holdout + the training days. */
export const TRAINING_DAYS = 90;

export type StoredModel = RidgeModel & {
  id: string;
  trainedAt: string;
  asOf: string;
  trainRows: number;
  holdoutDays: number;
  metrics: TrainResult["metrics"];
};

export type SkuMetric = { mlWape: number | null; baselineWape: number | null; defaultMethod: DemandMethod };

const dayOfWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export async function trainAndStoreModel(
  actor: { type: "system" | "user"; id: string } = { type: "system", id: "train-forecast" },
  sql: postgres.Sql = getSql(),
): Promise<{ model: StoredModel; perSku: TrainResult["perSku"]; ms: number }> {
  const t0 = performance.now();
  const { asOf } = await resolvePlanningState(sql);
  const start = addDays(asOf, -(TRAINING_DAYS - 1));
  const [products, sales, firsts] = await Promise.all([
    sql<{ id: string; category: string }[]>`select id, category from products where is_active order by id`,
    sql<{ product_id: string; date: string; units: number }[]>`
      select product_id, to_char(sale_date, 'YYYY-MM-DD') as date, units_sold as units
      from sales_history where sale_date >= ${start}::date and sale_date <= ${asOf}::date
    `,
    sql<{ product_id: string; first: string }[]>`
      select product_id, to_char(min(sale_date), 'YYYY-MM-DD') as first from sales_history where sale_date <= ${asOf}::date group by product_id
    `,
  ]);

  const values = new Map(products.map((p) => [p.id, new Array<number>(TRAINING_DAYS).fill(0)]));
  for (const s of sales) {
    const v = values.get(s.product_id);
    if (v) v[daysBetween(start, s.date)] += s.units;
  }
  const firstBy = new Map(firsts.map((f) => [f.product_id, f.first]));
  const series = products.map((p) => {
    const first = firstBy.get(p.id);
    return {
      productId: p.id,
      category: p.category,
      values: values.get(p.id)!,
      firstIndex: first ? Math.max(0, daysBetween(start, first)) : TRAINING_DAYS,
    };
  });

  const result = trainModel({ series, firstDow: dayOfWeek(start) });
  const { model, metrics, perSku } = result;
  const modelId = crypto.randomUUID();

  await sql.begin(async (tx) => {
    // .execute() sends each raw query in array order (see plans.ts on pipelining).
    await Promise.all([
      tx`
        insert into forecast_models (id, as_of_date, feature_names, means, stds, coefficients, intercept, lambda, train_rows, holdout_days, metrics)
        values (
          ${modelId}, ${asOf},
          ${tx.json(model.featureNames)}, ${tx.json(model.means)}, ${tx.json(model.stds)}, ${tx.json(model.coefficients)},
          ${model.intercept}, ${model.lambda}, ${metrics.trainRows}, 14, ${tx.json(metrics as unknown as postgres.JSONValue)}
        )
      `.execute(),
      tx`
        insert into sku_forecast_metrics (model_id, product_id, ml_wape, baseline_wape, default_method)
        select ${modelId}::uuid, x.product_id, x.ml_wape, x.baseline_wape, x.default_method
        from jsonb_to_recordset(${tx.json(perSku.map((s) => ({ product_id: s.productId, ml_wape: s.mlWape, baseline_wape: s.baselineWape, default_method: s.defaultMethod })))})
          as x(product_id uuid, ml_wape double precision, baseline_wape double precision, default_method text)
      `.execute(),
      writeAudit(
        {
          actorType: actor.type,
          actorId: actor.id,
          action: "model.trained",
          entityType: "forecast_model",
          entityId: modelId,
          after: { asOf, lambda: model.lambda, trainRows: metrics.trainRows, mlWape: metrics.mlWape, baselineWape: metrics.baselineWape, skusUsingMl: metrics.skusUsingMl, skus: perSku.length },
        },
        tx,
      ),
    ]);
  });

  const stored = await loadLatestModel(sql);
  return { model: stored!.model, perSku, ms: Math.round(performance.now() - t0) };
}

type ModelRow = {
  id: string;
  trained_at: string;
  as_of: string;
  feature_names: string[];
  means: number[];
  stds: number[];
  coefficients: number[];
  intercept: number;
  lambda: number;
  train_rows: number;
  holdout_days: number;
  metrics: TrainResult["metrics"];
};

/** The model in use (latest trained) and its per-SKU backtest, or null before the first training. */
export async function loadLatestModel(sql: SqlHandle = getSql()): Promise<{ model: StoredModel; metrics: Map<string, SkuMetric> } | null> {
  const [row] = await sql<ModelRow[]>`
    select id, to_char(trained_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as trained_at,
      to_char(as_of_date, 'YYYY-MM-DD') as as_of, feature_names, means, stds, coefficients, intercept, lambda,
      train_rows, holdout_days, metrics
    from forecast_models order by trained_at desc limit 1
  `;
  if (!row) return null;
  const rows = await sql<{ product_id: string; ml_wape: number | null; baseline_wape: number | null; default_method: DemandMethod }[]>`
    select product_id, ml_wape, baseline_wape, default_method from sku_forecast_metrics where model_id = ${row.id}
  `;
  return {
    model: {
      id: row.id,
      trainedAt: row.trained_at,
      asOf: row.as_of,
      featureNames: row.feature_names,
      means: row.means,
      stds: row.stds,
      coefficients: row.coefficients,
      intercept: row.intercept,
      lambda: row.lambda,
      trainRows: row.train_rows,
      holdoutDays: row.holdout_days,
      metrics: row.metrics,
    },
    metrics: new Map(rows.map((r) => [r.product_id, { mlWape: r.ml_wape, baselineWape: r.baseline_wape, defaultMethod: r.default_method }])),
  };
}
