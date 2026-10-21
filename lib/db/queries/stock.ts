// Read queries: batches (all quality states) and inventory balances (mapped and unmapped).
import type { BalanceInput, BatchInput } from "@/lib/business-logic/types";
import type { SqlHandle } from "@/lib/services/audit";
import { type ProductFilter, productIds } from "./filters";

export type BalanceRow = BalanceInput & { productId: string };

export async function listBatches(sql: SqlHandle, productId?: ProductFilter): Promise<BatchInput[]> {
  return sql<BatchInput[]>`
    select
      b.id,
      b.product_id as "productId",
      b.batch_number as "batchNumber",
      to_char(b.expiry_date, 'YYYY-MM-DD') as "expiryDate",
      to_char(b.received_date, 'YYYY-MM-DD') as "receivedDate",
      b.unit_cost::text as "unitCost",
      b.quality_status as "qualityStatus",
      b.return_policy_status as "returnPolicy"
    from batches b
    join products p on p.id = b.product_id and p.is_active ${productId ? sql`and p.id = any(${productIds(productId)}::uuid[])` : sql``}
    order by b.product_id, b.expiry_date, b.batch_number
  `;
}

export async function listBalances(sql: SqlHandle, productId?: ProductFilter): Promise<BalanceRow[]> {
  return sql<BalanceRow[]>`
    select
      id,
      product_id as "productId",
      batch_id as "batchId",
      location_id as "locationId",
      on_hand_qty as "onHandQty",
      reserved_qty as "reservedQty"
    from inventory_balances
    where true ${productId ? sql`and product_id = any(${productIds(productId)}::uuid[])` : sql``}
    order by product_id, batch_id, id
  `;
}
