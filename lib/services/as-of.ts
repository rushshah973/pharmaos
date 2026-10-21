import { getSql } from "@/lib/db/client";
import type { SqlHandle } from "./audit";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The engine's "today" (architecture.md §5.5), as YYYY-MM-DD:
 * DEMO_AS_OF_DATE env → app_state.as_of_date → max(sales_history.sale_date).
 * Dates are formatted inside SQL so no JS Date / timezone conversion happens.
 */
export async function resolveAsOfDate(sql: SqlHandle = getSql()): Promise<string> {
  return (await resolvePlanningState(sql)).asOf;
}

/** As-of date and active scenario in one round trip (the database is far away; every trip counts). */
export async function resolvePlanningState(sql: SqlHandle = getSql()): Promise<{ asOf: string; scenarioId: string }> {
  const fromEnv = process.env.DEMO_AS_OF_DATE?.trim();
  if (fromEnv && !ISO_DATE.test(fromEnv)) {
    throw new Error(`DEMO_AS_OF_DATE must be YYYY-MM-DD, got "${fromEnv}".`);
  }

  const [row] = await sql<{ app_date: string | null; max_sale: string | null; scenario: string | null }[]>`
    select
      (select to_char(as_of_date, 'YYYY-MM-DD') from app_state where id = 1) as app_date,
      ${fromEnv ? sql`null::text` : sql`(select to_char(max(sale_date), 'YYYY-MM-DD') from sales_history)`} as max_sale,
      (select active_scenario_id from app_state where id = 1) as scenario
  `;
  const scenarioId = row?.scenario ?? "baseline";
  if (fromEnv) return { asOf: fromEnv, scenarioId };
  if (row?.app_date) return { asOf: row.app_date, scenarioId };
  if (row?.max_sale) return { asOf: row.max_sale, scenarioId };

  // No sales yet (before the first seed): fall back to today's UTC date.
  return { asOf: new Date().toISOString().slice(0, 10), scenarioId };
}
