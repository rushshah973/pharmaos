// Command Center metrics (implementationplan.md §7.7). Stock figures are computed live by the engine
// on the current context; spend and approvals come from the saved plans.
import type postgres from "postgres";
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
};

const CRITICAL_LIMIT = 8;
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
  };
}
