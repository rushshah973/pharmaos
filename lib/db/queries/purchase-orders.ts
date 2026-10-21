// Read queries: confirmed external POs (status 'open') with their lines, as incoming stock.
// PharmaOS draft POs are never incoming, so they are not selected here.
import type { IncomingInput } from "@/lib/business-logic/types";
import type { SqlHandle } from "@/lib/services/audit";

export type IncomingRow = IncomingInput & { productId: string };

export async function listOpenIncoming(sql: SqlHandle, productId?: string): Promise<IncomingRow[]> {
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
    where po.status = 'open' and po.expected_delivery_date is not null ${productId ? sql`and l.product_id = ${productId}` : sql``}
    order by l.product_id, po.po_number
  `;
}
