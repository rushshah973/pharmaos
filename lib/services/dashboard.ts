// Command Center metrics (implementationplan.md §7.7). Stock figures are computed live by the engine
// on the current context; spend and approvals come from the saved plans.
import type postgres from "postgres";
import { addDays } from "@/lib/business-logic/dates";
import { analyseSku } from "@/lib/business-logic/engine";
import { criticalityWeight } from "@/lib/business-logic/priority";
import type { Criticality, Money, SkuStatus } from "@/lib/business-logic/types";
import { getSql } from "@/lib/db/client";
import { sumMoney } from "@/lib/money";
import { resolvePlanningState } from "./as-of";
import { loadPlanningContext } from "./context";
import type { PlanStatus } from "./plans";

export type CriticalSku = {
  productId: string;
  sku: string;
  brandName: string;
  strength: string;
  packSize: number;
  criticality: Criticality;
  status: SkuStatus;
  cover: number | null;
  leadTimeDays: number;
  atRiskValue: Money;
  /** The SKU's line in the latest open plan, for "Open in plan". */
  planLineId: string | null;
};

/** A SKU that is fine today but will reach its reorder point within the week (the forward-looking view). */
export type ReorderSoon = {
  productId: string;
  sku: string;
  brandName: string;
  strength: string;
  packSize: number;
  reorderInDays: number;
  orderBy: string; // YYYY-MM-DD
  stockPosition: number;
  avgDailyDemand: number;
  method: "ml" | "baseline";
  leadTimeDays: number;
};

export type CommandCenter = {
  asOf: string;
  scenario: { id: string; name: string };
  /** A purchase order above this needs Owner approval before it can be sent. */
  approvalLimit: Money;
  latestPlan: { id: string; status: PlanStatus; proposedTotal: Money; createdAt: string } | null;
  proposedSpend: Money;
  totalSkus: number;
  stockoutRisk: number;
  belowReorderPoint: number;
  expiryExposure: Money;
  /** In-plan lines not yet on a purchase order (open plans). */
  linesAwaitingPo: number;
  /** Purchase orders waiting for the Owner (above the approval limit). */
  posAwaitingApproval: number;
  criticalSkus: CriticalSku[];
  /** Reaching the reorder point in the next 7 days (not urgent yet), soonest first. */
  reorderSoon: ReorderSoon[];
  reorderSoonCount: number;
  /** Packs sold per day across all SKUs (last 42 days), then the engine's demand for the next 14 days. */
  demandTrend: DemandPoint[];
  /** How many active SKUs are in each stock status. */
  statusMix: { status: SkuStatus; count: number }[];
};

export type DemandPoint = { date: string; actual: number | null; forecast: number | null };

const TREND_PAST_DAYS = 42;
const TREND_FUTURE_DAYS = 14;

const CRITICAL_LIMIT = 8;
const REORDER_HORIZON_DAYS = 7;
const SEVERITY: Record<SkuStatus, number> = { STOCKOUT_RISK: 0, BELOW_ROP: 1, EXCESS: 3, HEALTHY: 3, NO_DEMAND: 4 };

export async function getCommandCenter(sql: postgres.Sql = getSql()): Promise<CommandCenter> {
  // Two waves: planning state, settings, latest plan and approvals; then the context and the latest plan's lines.
  const [{ asOf, scenarioId, approvalLimit }, [state], [latest], [pending]] = await Promise.all([
    resolvePlanningState(sql),
    sql<{ scenario_name: string }[]>`
      select s.name as scenario_name
      from app_state a join scenarios s on s.id = a.active_scenario_id where a.id = 1
    `,
    sql<{ id: string; status: PlanStatus; proposed_total: string; created_at: string }[]>`
      select id, status, proposed_total::text as proposed_total,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from purchase_plans where status <> 'rejected'
      order by created_at desc limit 1
    `,
    sql<{ lines: number; pos: number }[]>`
      select
        (select count(*)::int
           from purchase_recommendations r join purchase_plans p on p.id = r.plan_id
          where r.in_basket and r.status in ('proposed', 'edited') and p.status in ('draft', 'partially_approved')) as lines,
        (select count(*)::int from purchase_orders where status = 'pending_approval') as pos
    `,
  ]);
  const [ctx, planLines] = await Promise.all([
    loadPlanningContext(sql, asOf, scenarioId),
    latest
      ? sql<{ product_id: string; id: string }[]>`select product_id, id from purchase_recommendations where plan_id = ${latest.id}`
      : Promise.resolve([]),
  ]);
  const analysed = ctx.skus.map((s) => ({ product: s.product, a: analyseSku(s) }));
  const lineByProduct = new Map(planLines.map((l) => [l.product_id, l.id]));

  // Critical: stockout risk, then below reorder point, then any SKU with stock at expiry risk; lowest cover first,
  // then the more critical medicine, then the longer wait for delivery.
  const severity = (x: (typeof analysed)[number]) =>
    SEVERITY[x.a.status] < 3 ? SEVERITY[x.a.status] : Number(x.a.expiry.atRiskValue) > 0 ? 2 : SEVERITY[x.a.status];
  const criticalSkus = analysed
    .filter((x) => severity(x) <= 2)
    .sort(
      (x, y) =>
        severity(x) - severity(y) ||
        (x.a.cover ?? Infinity) - (y.a.cover ?? Infinity) ||
        criticalityWeight(y.product.criticality) - criticalityWeight(x.product.criticality) ||
        y.a.leadFastest - x.a.leadFastest ||
        x.a.sku.localeCompare(y.a.sku),
    )
    .slice(0, CRITICAL_LIMIT)
    .map(({ product, a }) => ({
      productId: product.id,
      sku: product.sku,
      brandName: product.brandName,
      strength: product.strength,
      packSize: product.packSize,
      criticality: product.criticality,
      status: a.status,
      cover: a.cover,
      leadTimeDays: a.leadFastest,
      atRiskValue: a.expiry.atRiskValue,
      planLineId: lineByProduct.get(product.id) ?? null,
    }));

  // Forward-looking: SKUs above their reorder point today that will cross it within a week at forecast demand.
  const soon = analysed
    .filter(({ a }) => !a.candidate && a.reorderInDays !== null && a.reorderInDays > 0 && a.reorderInDays <= REORDER_HORIZON_DAYS)
    .sort((x, y) => x.a.reorderInDays! - y.a.reorderInDays! || x.a.sku.localeCompare(y.a.sku));
  const reorderSoon = soon.slice(0, CRITICAL_LIMIT).map(({ product, a }) => ({
    productId: product.id,
    sku: product.sku,
    brandName: product.brandName,
    strength: product.strength,
    packSize: product.packSize,
    reorderInDays: a.reorderInDays!,
    orderBy: addDays(asOf, Math.floor(a.reorderInDays!)),
    stockPosition: a.stockPosition,
    avgDailyDemand: a.demand.avgDailyDemand,
    method: a.demand.method,
    leadTimeDays: a.leadFastest,
  }));

  // Demand trend: actual packs per day from the sales window, then each SKU's planning demand (the ML series where
  // the engine uses ML, its daily average otherwise) summed per future day.
  const sold = new Map<string, number>();
  for (const s of ctx.skus) for (const p of s.sales) sold.set(p.date, (sold.get(p.date) ?? 0) + p.units);
  const future = Array.from({ length: TREND_FUTURE_DAYS }, () => 0);
  const skuById = new Map(ctx.skus.map((s) => [s.product.id, s]));
  for (const { a } of analysed) {
    const sku = skuById.get(a.productId);
    const series = a.demand.method === "ml" ? sku?.forecast?.series14 : undefined;
    for (let i = 0; i < TREND_FUTURE_DAYS; i++) future[i] += series?.[i] ?? a.demand.avgDailyDemand;
  }
  const demandTrend: DemandPoint[] = [
    ...Array.from({ length: TREND_PAST_DAYS }, (_, i) => {
      const date = addDays(asOf, i - TREND_PAST_DAYS + 1);
      return { date, actual: Math.round(sold.get(date) ?? 0), forecast: i === TREND_PAST_DAYS - 1 ? Math.round(sold.get(date) ?? 0) : null };
    }),
    ...future.map((v, i) => ({ date: addDays(asOf, i + 1), actual: null, forecast: Math.round(v) })),
  ];
  const statuses: SkuStatus[] = ["STOCKOUT_RISK", "BELOW_ROP", "HEALTHY", "EXCESS", "NO_DEMAND"];
  const statusMix = statuses.map((status) => ({ status, count: analysed.filter((x) => x.a.status === status).length }));

  return {
    asOf,
    scenario: { id: scenarioId, name: state?.scenario_name ?? "Baseline" },
    approvalLimit,
    latestPlan: latest ? { id: latest.id, status: latest.status, proposedTotal: latest.proposed_total, createdAt: latest.created_at } : null,
    proposedSpend: latest?.proposed_total ?? "0.00",
    totalSkus: analysed.length,
    stockoutRisk: analysed.filter((x) => x.a.status === "STOCKOUT_RISK").length,
    belowReorderPoint: analysed.filter((x) => x.a.status === "BELOW_ROP").length,
    expiryExposure: sumMoney(analysed.map((x) => x.a.expiry.atRiskValue)).toFixed(2),
    linesAwaitingPo: pending?.lines ?? 0,
    posAwaitingApproval: pending?.pos ?? 0,
    criticalSkus,
    reorderSoon,
    reorderSoonCount: soon.length,
    demandTrend,
    statusMix,
  };
}
