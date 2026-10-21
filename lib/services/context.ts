// loadPlanningContext (plan §7.1): one fixed set of reads → the engine's planning context.
// Plain objects, money as strings. Scenario effects are applied in memory afterwards.
import { listActiveProducts, listOffers, listSuppliers } from "@/lib/db/queries/catalog";
import { listOpenIncoming } from "@/lib/db/queries/purchase-orders";
import { listFirstSaleDates, listSalesWindow } from "@/lib/db/queries/sales";
import { listBalances, listBatches } from "@/lib/db/queries/stock";
import { addDays } from "@/lib/business-logic/dates";
import type { IsoDate, PlanningContext, SkuContext, SkuForecast, SupplierInput } from "@/lib/business-logic/types";
import { buildFeatures } from "@/lib/ml/features";
import { forecastRecursive, modelCategories } from "@/lib/ml/forecast";
import { contributions, type RidgeModel } from "@/lib/ml/ridge";
import { applyScenario } from "@/lib/scenarios/apply";
import type { SqlHandle } from "./audit";
import { type SkuMetric, loadLatestModel } from "./forecast-model";

/** The baseline needs the last 28 days; the ML features need 28 days of history before each forecast day (§6.2a). */
const SALES_WINDOW_DAYS = 56;

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** `productId` limits the context to one SKU or a list of SKUs (suppliers are always all loaded). */
export async function loadPlanningContext(
  sql: SqlHandle,
  asOf: IsoDate,
  scenarioId: string,
  productId?: string | string[],
): Promise<PlanningContext> {
  const [products, suppliers, offers, sales, firstSales, batches, balances, incoming, latestModel] = await Promise.all([
    listActiveProducts(sql, productId),
    listSuppliers(sql),
    listOffers(sql, productId),
    listSalesWindow(sql, asOf, SALES_WINDOW_DAYS, productId),
    listFirstSaleDates(sql, asOf, productId),
    listBatches(sql, productId),
    listBalances(sql, productId),
    listOpenIncoming(sql, productId),
    loadLatestModel(sql),
  ]);

  const supplierMap: Record<string, SupplierInput> = Object.fromEntries(suppliers.map((s) => [s.id, s]));
  const offersBy = groupBy(offers, (o) => o.productId);
  const salesBy = groupBy(sales, (s) => s.productId);
  const firstSaleBy = new Map(firstSales.map((f) => [f.productId, f.firstSaleDate]));
  const batchesBy = groupBy(batches, (b) => b.productId);
  const balancesBy = groupBy(balances, (b) => b.productId);
  const incomingBy = groupBy(incoming, (i) => i.productId);

  const skus: SkuContext[] = products.map((product) => ({
    asOf,
    product,
    offers: offersBy.get(product.id) ?? [],
    suppliers: supplierMap,
    batches: batchesBy.get(product.id) ?? [],
    balances: (balancesBy.get(product.id) ?? []).map((b) => ({
      id: b.id,
      batchId: b.batchId,
      locationId: b.locationId,
      onHandQty: b.onHandQty,
      reservedQty: b.reservedQty,
    })),
    incoming: (incomingBy.get(product.id) ?? []).map((i) => ({
      poId: i.poId,
      status: i.status,
      expectedDeliveryDate: i.expectedDeliveryDate,
      quantityPacks: i.quantityPacks,
      freeQty: i.freeQty,
    })),
    sales: (salesBy.get(product.id) ?? []).map(({ date, units }) => ({ date, units })),
    firstSaleDate: firstSaleBy.get(product.id) ?? null,
  }));

  // Scenarios change the context in memory first; the ML forecast then reads the resulting sales (§6.2a).
  const ctx = applyScenario({ asOf, skus }, scenarioId);
  if (!latestModel) return ctx;
  return { ...ctx, skus: ctx.skus.map((sku) => ({ ...sku, forecast: forecastSku(sku, latestModel.model, latestModel.metrics.get(sku.product.id)) })) };
}

/** Live 14-day ML forecast for one SKU from its last 56 days of sales (zero-filled) and the stored model. */
function forecastSku(sku: SkuContext, model: RidgeModel, metric: SkuMetric | undefined): SkuForecast {
  const byDate = new Map<string, number>();
  for (const s of sku.sales) byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.units);
  const history = Array.from({ length: SALES_WINDOW_DAYS }, (_, i) => byDate.get(addDays(sku.asOf, i - SALES_WINDOW_DAYS + 1)) ?? 0);
  const firstDow = new Date(`${addDays(sku.asOf, 1)}T00:00:00Z`).getUTCDay();
  const series14 = forecastRecursive(model, history, firstDow, sku.product.category, 14);
  const day1 = buildFeatures(history, firstDow, sku.product.category, modelCategories(model));
  return {
    mlDaily: series14.reduce((a, b) => a + b, 0) / series14.length,
    series14,
    mlWape: metric?.mlWape ?? null,
    baselineWape: metric?.baselineWape ?? null,
    defaultMethod: metric?.defaultMethod ?? "baseline",
    explain: { intercept: model.intercept, top: contributions(model, day1).slice(0, 5) },
  };
}
