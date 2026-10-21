// Read queries: confirmed incoming stock — seeded external POs ('open') and PharmaOS POs once 'sent'
// (simulated). PharmaOS POs that are ready / pending approval / approved / rejected are not incoming.
import type { IncomingInput } from "@/lib/business-logic/types";
import type { SqlHandle } from "@/lib/services/audit";
import { type ProductFilter, productIds } from "./filters";

export type IncomingRow = IncomingInput & { productId: string };

export async function listOpenIncoming(sql: SqlHandle, productId?: ProductFilter): Promise<IncomingRow[]> {
  return sql<IncomingRow[]>`
    select
      po.id as "poId",
      l.product_id as "productId",
      po.status,
      to_char(po.expected_delivery_date, 'YYYY-MM-DD') as "expectedDeliveryDate",
      l.quantity_packs as "quantityPacks",
      l.free_qty as "freeQty"
    from purchase_orders po
    join purchase_order_lines l on l.po_id = po.id
    where po.status in ('open', 'sent') and po.expected_delivery_date is not null ${productId ? sql`and l.product_id = any(${productIds(productId)}::uuid[])` : sql``}
    order by l.product_id, po.po_number
  `;
}
