// Read queries: stock already on order — seeded external POs ('open') and every PharmaOS PO that is not rejected,
// received or cancelled: ready, pending approval, approved or sent (simulated). Counting the unsent ones too stops a
// new plan from ordering the same stock again. `excludePlanId` leaves out a plan's own POs when that plan is analysed.
import type { IncomingInput } from "@/lib/business-logic/types";
import type { SqlHandle } from "@/lib/services/audit";
import { type ProductFilter, productIds } from "./filters";

import { ON_ORDER_STATUSES } from "@/lib/business-logic/inventory";

export type IncomingRow = IncomingInput & { productId: string };

export async function listOpenIncoming(sql: SqlHandle, productId?: ProductFilter, excludePlanId?: string): Promise<IncomingRow[]> {
  return sql<IncomingRow[]>`
    select
      po.id as "poId",
      po.po_number as "poNumber",
      l.product_id as "productId",
      po.status,
      to_char(po.expected_delivery_date, 'YYYY-MM-DD') as "expectedDeliveryDate",
      l.quantity_packs as "quantityPacks",
      l.free_qty as "freeQty"
    from purchase_orders po
    join purchase_order_lines l on l.po_id = po.id
    where po.status in ${sql(ON_ORDER_STATUSES)} and po.expected_delivery_date is not null
      ${productId ? sql`and l.product_id = any(${productIds(productId)}::uuid[])` : sql``}
      ${excludePlanId ? sql`and po.source_plan_id is distinct from ${excludePlanId}` : sql``}
    order by l.product_id, po.po_number
  `;
}
