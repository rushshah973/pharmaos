// Read queries: products, suppliers and supplier offers, mapped to engine inputs.
// Money stays as strings (numeric → text); timestamps are formatted in SQL as UTC ISO strings.
import type { OfferInput, ProductInput, SupplierInput } from "@/lib/business-logic/types";
import type { SqlHandle } from "@/lib/services/audit";
import { type ProductFilter, productIds } from "./filters";

/** All active products, or just one when `productId` is given (line edits re-analyse one SKU). */
export async function listActiveProducts(sql: SqlHandle, productId?: ProductFilter): Promise<ProductInput[]> {
  return sql<ProductInput[]>`
    select
      id, sku,
      brand_name as "brandName",
      generic_name as "genericName",
      strength,
      dosage_form as "dosageForm",
      pack_size as "packSize",
      manufacturer, category,
      storage_class as "storageClass",
      criticality,
      unit_margin::text as "unitMargin",
      shelf_life_days as "shelfLifeDays",
      gst_rate::text as "gstRate",
      is_active as "isActive"
    from products
    where is_active ${productId ? sql`and id = any(${productIds(productId)}::uuid[])` : sql``}
    order by sku
  `;
}

export async function listSuppliers(sql: SqlHandle): Promise<SupplierInput[]> {
  return sql<SupplierInput[]>`
    select
      id,
      supplier_code as code,
      name,
      approved_status as "approvedStatus",
      default_lead_time_days as "defaultLeadTimeDays",
      reliability_score::float8 as "reliabilityScore",
      payment_terms_days as "paymentTermsDays"
    from suppliers
    order by supplier_code
  `;
}

export async function listOffers(sql: SqlHandle, productId?: ProductFilter): Promise<OfferInput[]> {
  return sql<OfferInput[]>`
    select
      o.id,
      o.supplier_id as "supplierId",
      o.product_id as "productId",
      o.unit_price::text as "unitPrice",
      o.moq,
      o.pack_multiple as "packMultiple",
      o.available_qty as "availableQty",
      o.lead_time_days as "leadTimeDays",
      o.freight_per_pack::text as "freightPerPack",
      o.tax_rate::text as "taxRate",
      o.scheme_paid_qty as "schemePaidQty",
      o.scheme_free_qty as "schemeFreeQty",
      to_char(o.quoted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "quotedAt",
      to_char(o.valid_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "validUntil",
      o.is_active as "isActive"
    from supplier_offers o
    join products p on p.id = o.product_id and p.is_active ${productId ? sql`and p.id = any(${productIds(productId)}::uuid[])` : sql``}
    order by o.product_id, o.id
  `;
}
