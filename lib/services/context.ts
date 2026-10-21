// loadPlanningContext (plan §7.1): one fixed set of reads → the engine's planning context.
// Plain objects, money as strings. Scenario effects are applied in memory afterwards.
import { listActiveProducts, listOffers, listSuppliers } from "@/lib/db/queries/catalog";
import { listOpenIncoming } from "@/lib/db/queries/purchase-orders";
import { listFirstSaleDates, listSalesWindow } from "@/lib/db/queries/sales";
import { listBalances, listBatches } from "@/lib/db/queries/stock";
import type { IsoDate, PlanningContext, SkuContext, SupplierInput } from "@/lib/business-logic/types";
import { applyScenario } from "@/lib/scenarios/apply";
import type { SqlHandle } from "./audit";

/** The demand baseline needs the last 28 days (plan §6.2). */
const SALES_WINDOW_DAYS = 28;

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

export async function loadPlanningContext(sql: SqlHandle, asOf: IsoDate, scenarioId: string): Promise<PlanningContext> {
  const [products, suppliers, offers, sales, firstSales, batches, balances, incoming] = await Promise.all([
    listActiveProducts(sql),
    listSuppliers(sql),
    listOffers(sql),
    listSalesWindow(sql, asOf, SALES_WINDOW_DAYS),
    listFirstSaleDates(sql, asOf),
    listBatches(sql),
    listBalances(sql),
    listOpenIncoming(sql),
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

  return applyScenario({ asOf, skus }, scenarioId);
}
