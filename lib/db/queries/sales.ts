// Read queries: sales history for the demand window, and each product's first sale date.
import type { IsoDate } from "@/lib/business-logic/types";
import type { SqlHandle } from "@/lib/services/audit";

export type SalesRow = { productId: string; date: IsoDate; units: number };
export type FirstSaleRow = { productId: string; firstSaleDate: IsoDate };

/** Daily sales from (asOf − days + 1) to asOf inclusive. */
export async function listSalesWindow(sql: SqlHandle, asOf: IsoDate, days: number, productId?: string): Promise<SalesRow[]> {
  return sql<SalesRow[]>`
    select
      product_id as "productId",
      to_char(sale_date, 'YYYY-MM-DD') as date,
      units_sold as units
    from sales_history
    where sale_date > ${asOf}::date - ${days}::int and sale_date <= ${asOf}::date ${productId ? sql`and product_id = ${productId}` : sql``}
    order by product_id, sale_date
  `;
}

export async function listFirstSaleDates(sql: SqlHandle, asOf: IsoDate, productId?: string): Promise<FirstSaleRow[]> {
  return sql<FirstSaleRow[]>`
    select product_id as "productId", to_char(min(sale_date), 'YYYY-MM-DD') as "firstSaleDate"
    from sales_history
    where sale_date <= ${asOf}::date ${productId ? sql`and product_id = ${productId}` : sql``}
    group by product_id
  `;
}
