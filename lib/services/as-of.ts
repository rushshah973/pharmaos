import type postgres from "postgres";
import { getSql } from "@/lib/db/client";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The engine's "today" (architecture.md §5.5), as YYYY-MM-DD:
 * DEMO_AS_OF_DATE env → app_state.as_of_date → max(sales_history.sale_date).
 * Dates are formatted inside SQL so no JS Date / timezone conversion happens.
 */
export async function resolveAsOfDate(sql: postgres.Sql = getSql()): Promise<string> {
  const fromEnv = process.env.DEMO_AS_OF_DATE?.trim();
  if (fromEnv) {
    if (!ISO_DATE.test(fromEnv)) {
      throw new Error(`DEMO_AS_OF_DATE must be YYYY-MM-DD, got "${fromEnv}".`);
    }
    return fromEnv;
  }

  const [row] = await sql<{ app_date: string | null; max_sale: string | null }[]>`
    select
      (select to_char(as_of_date, 'YYYY-MM-DD') from app_state where id = 1) as app_date,
      (select to_char(max(sale_date), 'YYYY-MM-DD') from sales_history) as max_sale
  `;
  if (row?.app_date) return row.app_date;
  if (row?.max_sale) return row.max_sale;

  // No sales yet (before the first seed): fall back to today's UTC date.
  return new Date().toISOString().slice(0, 10);
}
