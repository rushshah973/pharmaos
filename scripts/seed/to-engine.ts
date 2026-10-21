// Converts generated seed rows (snake_case, as written to the DB) into engine inputs,
// so the seed's demo-case injection and validation use the real decision engine.
import type {
  BalanceInput,
  BatchInput,
  IncomingInput,
  OfferInput,
  PlanningContext,
  ProductInput,
  SkuContext,
  SupplierInput,
} from "@/lib/business-logic/types";
import type { BatchRow, OfferRow, ProductRow, SupplierRow, SyntheticDataset } from "./generate-synthetic";

export function toProduct(p: ProductRow): ProductInput {
  return {
    id: p.id,
    sku: p.sku,
    brandName: p.brand_name,
    genericName: p.generic_name,
    strength: p.strength,
    dosageForm: p.dosage_form,
    packSize: p.pack_size,
    manufacturer: p.manufacturer,
    category: p.category,
    storageClass: p.storage_class,
    criticality: p.criticality,
    unitMargin: p.unit_margin,
    shelfLifeDays: p.shelf_life_days,
    gstRate: p.gst_rate,
    isActive: p.is_active,
  };
}

export function toSupplier(s: SupplierRow): SupplierInput {
  return {
    id: s.id,
    code: s.supplier_code,
    name: s.name,
    approvedStatus: s.approved_status,
    defaultLeadTimeDays: s.default_lead_time_days,
    reliabilityScore: s.reliability_score === null ? null : Number(s.reliability_score),
    paymentTermsDays: s.payment_terms_days,
  };
}

export function toOffer(o: OfferRow): OfferInput {
  return {
    id: o.id,
    supplierId: o.supplier_id,
    productId: o.product_id,
    unitPrice: o.unit_price,
    moq: o.moq,
    packMultiple: o.pack_multiple,
    availableQty: o.available_qty,
    leadTimeDays: o.lead_time_days,
    freightPerPack: o.freight_per_pack,
    taxRate: o.tax_rate,
    schemePaidQty: o.scheme_paid_qty,
    schemeFreeQty: o.scheme_free_qty,
    quotedAt: o.quoted_at,
    validUntil: o.valid_until,
    isActive: o.is_active,
  };
}

export function toBatch(b: BatchRow): BatchInput {
  return {
    id: b.id,
    productId: b.product_id,
    batchNumber: b.batch_number,
    expiryDate: b.expiry_date,
    receivedDate: b.received_date,
    unitCost: b.unit_cost,
    qualityStatus: b.quality_status,
    returnPolicy: b.return_policy_status,
  };
}

/** Lookup tables for building one SKU's context quickly. Rebuild after mutating the dataset. */
export function buildEngineIndex(data: SyntheticDataset) {
  const group = <T>(rows: T[], key: (r: T) => string) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const k = key(r);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    }
    return m;
  };
  const poById = new Map(data.purchaseOrders.map((p) => [p.id, p]));
  return {
    suppliers: Object.fromEntries(data.suppliers.map((s) => [s.id, toSupplier(s)])) as Record<string, SupplierInput>,
    products: new Map(data.products.map((p) => [p.id, p])),
    offers: group(data.supplierOffers, (o) => o.product_id),
    batches: group(data.batches, (b) => b.product_id),
    balances: group(data.inventoryBalances, (b) => b.product_id),
    sales: group(data.salesHistory, (s) => s.product_id),
    poLines: group(data.purchaseOrderLines, (l) => l.product_id),
    poById,
  };
}
export type EngineIndex = ReturnType<typeof buildEngineIndex>;

export function skuContext(data: SyntheticDataset, ix: EngineIndex, productId: string): SkuContext {
  const asOf = data.meta.asOf;
  const sales = ix.sales.get(productId) ?? [];
  const balances: BalanceInput[] = (ix.balances.get(productId) ?? []).map((b) => ({
    id: b.id,
    batchId: b.batch_id,
    locationId: b.location_id,
    onHandQty: b.on_hand_qty,
    reservedQty: b.reserved_qty,
  }));
  const incoming: IncomingInput[] = (ix.poLines.get(productId) ?? []).flatMap((l) => {
    const po = ix.poById.get(l.po_id);
    return po
      ? [{ poId: po.id, status: po.status, expectedDeliveryDate: po.expected_delivery_date, quantityPacks: l.quantity_packs, freeQty: l.free_qty }]
      : [];
  });
  return {
    asOf,
    product: toProduct(ix.products.get(productId)!),
    offers: (ix.offers.get(productId) ?? []).map(toOffer),
    suppliers: ix.suppliers,
    batches: (ix.batches.get(productId) ?? []).map(toBatch),
    balances,
    incoming,
    sales: sales.filter((s) => s.sale_date <= asOf).map((s) => ({ date: s.sale_date, units: s.units_sold })),
    firstSaleDate: sales.reduce<string | null>((m, s) => (m === null || s.sale_date < m ? s.sale_date : m), null),
  };
}

export function datasetToContext(data: SyntheticDataset): PlanningContext {
  const ix = buildEngineIndex(data);
  return { asOf: data.meta.asOf, skus: data.products.filter((p) => p.is_active).map((p) => skuContext(data, ix, p.id)) };
}
