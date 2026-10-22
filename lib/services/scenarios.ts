// Scenarios (implementationplan.md §12, architecture §7.7): run sets app_state.active_scenario_id and the effect
// applies in memory on the next context load (lib/scenarios/apply.ts); reset returns to the baseline. The seed
// tables are never changed. The ML forecast reads the scenario's sales live, so nothing is retrained.
import type postgres from "postgres";
import { ServiceError } from "@/lib/api/errors";
import { buildPlan } from "@/lib/business-logic/engine";
import { getSql } from "@/lib/db/client";
import type { ScenarioParams } from "@/lib/scenarios/apply";
import { resolvePlanningState } from "./as-of";
import { writeAudit } from "./audit";
import { loadPlanningContext } from "./context";
import type { Actor } from "./plans";

export type ScenarioView = { id: string; name: string; description: string; params: ScenarioParams; active: boolean };

const defaultActor = (): Actor => ({ type: "user", id: process.env.DEMO_USER ?? "demo.owner" });

/** Baseline first, then the rest by name; the active one is flagged. */
export async function listScenarios(sql: postgres.Sql = getSql()): Promise<{ active: string; scenarios: ScenarioView[] }> {
  const [rows, [state]] = await Promise.all([
    sql<{ id: string; name: string; description: string; params: ScenarioParams }[]>`select id, name, description, params from scenarios order by (id = 'baseline') desc, name`.execute(),
    sql<{ active: string }[]>`select active_scenario_id as active from app_state where id = 1`.execute(),
  ]);
  const active = state?.active ?? "baseline";
  return { active, scenarios: rows.map((r) => ({ ...r, active: r.id === active })) };
}

/**
 * The preferred supplier for supplier_delay: the one that wins the most lines in the baseline plan right now
 * (ties: more spend, then the supplier code). Resolved once at run time, so every context load (a full plan or
 * a single line) delays the same supplier.
 */
async function preferredSupplier(sql: postgres.Sql): Promise<{ supplierId: string; supplierCode: string; wins: number } | null> {
  const { asOf } = await resolvePlanningState(sql);
  const ctx = await loadPlanningContext(sql, asOf, "baseline");
  const plan = buildPlan(ctx);
  const tally = new Map<string, { wins: number; spend: number }>();
  for (const l of plan.lines) {
    if (!l.inBasket || !l.supplierId) continue;
    const t = tally.get(l.supplierId) ?? { wins: 0, spend: 0 };
    t.wins++;
    t.spend += Number(l.totals?.lineTotal ?? 0);
    tally.set(l.supplierId, t);
  }
  const codes = new Map(Object.values(ctx.skus[0]?.suppliers ?? {}).map((s) => [s.id, s.code]));
  const best = [...tally].sort(([a, x], [b, y]) => y.wins - x.wins || y.spend - x.spend || (codes.get(a) ?? a).localeCompare(codes.get(b) ?? b))[0];
  return best ? { supplierId: best[0], supplierCode: codes.get(best[0]) ?? best[0], wins: best[1].wins } : null;
}

export async function runScenario(id: string, actor: Actor = defaultActor(), sql: postgres.Sql = getSql()): Promise<{ active: string; scenarios: ScenarioView[] }> {
  const [scenario] = await sql<{ id: string; params: ScenarioParams }[]>`select id, params from scenarios where id = ${id}`;
  if (!scenario) throw new ServiceError("SCENARIO_NOT_FOUND", 404, `Scenario ${id} was not found.`);
  let params = scenario.params;
  if (id === "supplier_delay") {
    const preferred = await preferredSupplier(sql);
    if (!preferred) throw new ServiceError("NO_PREFERRED_SUPPLIER", 409, "The baseline plan has no lines, so there is no preferred supplier to delay.");
    params = { ...params, supplier_id: preferred.supplierId, supplier_code: preferred.supplierCode, baseline_wins: preferred.wins };
  }
  await sql.begin(async (tx) => {
    const [before] = await tx<{ active: string }[]>`select active_scenario_id as active from app_state where id = 1 for update`;
    if (id === "supplier_delay") await tx`update scenarios set params = ${tx.json(params as postgres.JSONValue)} where id = ${id}`;
    await tx`update app_state set active_scenario_id = ${id}, updated_at = now() where id = 1`;
    await writeAudit(
      { actorType: actor.type, actorId: actor.id, action: "scenario.run", entityType: "scenario", entityId: null, before: { activeScenarioId: before?.active ?? "baseline" }, after: { activeScenarioId: id, params } },
      tx,
    );
  });
  return listScenarios(sql);
}

export async function resetScenario(actor: Actor = defaultActor(), sql: postgres.Sql = getSql()): Promise<{ active: string; scenarios: ScenarioView[] }> {
  await sql.begin(async (tx) => {
    const [before] = await tx<{ active: string }[]>`select active_scenario_id as active from app_state where id = 1 for update`;
    await tx`update app_state set active_scenario_id = 'baseline', updated_at = now() where id = 1`;
    await writeAudit({ actorType: actor.type, actorId: actor.id, action: "scenario.reset", entityType: "scenario", entityId: null, before: { activeScenarioId: before?.active ?? "baseline" }, after: { activeScenarioId: "baseline" } }, tx);
  });
  return listScenarios(sql);
}

/** PATCH /api/settings: the Owner approval limit (a PO above it waits for the Owner). Audited. */
export async function updateApprovalLimit(limit: number, actor: Actor = defaultActor(), sql: postgres.Sql = getSql()): Promise<{ poApprovalLimit: string }> {
  return sql.begin(async (tx) => {
    const [before] = await tx<{ limit: string }[]>`select po_approval_limit::text as limit from app_state where id = 1 for update`;
    const value = limit.toFixed(2);
    await tx`update app_state set po_approval_limit = ${value}, updated_at = now() where id = 1`;
    await writeAudit(
      { actorType: actor.type, actorId: actor.id, action: "settings.approval_limit_changed", entityType: "settings", entityId: null, before: { poApprovalLimit: before?.limit ?? null }, after: { poApprovalLimit: value } },
      tx,
    );
    return { poApprovalLimit: value };
  });
}

export type DataSummary = {
  asOf: string;
  seed: number;
  seededAt: string | null;
  tables: { table: string; rows: number }[];
  sources: { id: string; name: string; url: string | null; sourceType: string; usedFor: string; licenceNote: string | null; retrievedAt: string | null }[];
};

const SUMMARY_TABLES = ["products", "suppliers", "supplier_offers", "sales_history", "batches", "inventory_locations", "inventory_balances", "purchase_orders", "purchase_order_lines"] as const;

/** Rows per seeded table, the as-of date, the seed, and every reference source (data_sources). */
export async function getDataSummary(sql: postgres.Sql = getSql()): Promise<DataSummary> {
  const counts = SUMMARY_TABLES.map((t) => `(select count(*)::int from ${t}) as "${t}"`).join(", ");
  const [[row], [state], sources, { asOf }] = await Promise.all([
    sql.unsafe<Record<string, number>[]>(`select ${counts}`),
    sql<{ seed: number; seededAt: string | null }[]>`
      select synthetic_seed as seed, to_char(seeded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "seededAt" from app_state where id = 1
    `.execute(),
    sql<DataSummary["sources"]>`
      select id, name, url, source_type as "sourceType", used_for as "usedFor", licence_note as "licenceNote", to_char(retrieved_at, 'YYYY-MM-DD') as "retrievedAt"
      from data_sources order by name
    `.execute(),
    resolvePlanningState(sql),
  ]);
  return {
    asOf,
    seed: state?.seed ?? 42,
    seededAt: state?.seededAt ?? null,
    tables: SUMMARY_TABLES.map((t) => ({ table: t, rows: row?.[t] ?? 0 })),
    sources,
  };
}
