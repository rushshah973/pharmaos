// Small builders for engine fixtures (implementationplan.md §14.1). Plain objects only.
import type {
  BalanceInput,
  BatchInput,
  IncomingInput,
  OfferInput,
  PlanningContext,
  ProductInput,
  SalesPoint,
  SkuContext,
  SupplierInput,
} from "@/lib/business-logic/types";

export const AS_OF = "2026-10-21";

export function addDaysUtc(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** 28 days of sales ending on asOf: `last7` (oldest → newest) plus 21 earlier days summing to `earlierSum`. */
export function salesSeries(asOf: string, last7: number[], earlierSum: number): SalesPoint[] {
  const earlier = Array.from({ length: 21 }, (_, i) => Math.floor(earlierSum / 21) + (i < earlierSum % 21 ? 1 : 0));
  const values = [...earlier, ...last7];
  return values.map((units, i) => ({ date: addDaysUtc(asOf, i - 27), units }));
}

/** Constant daily sales for `days` days ending on asOf. */
export function flatSales(asOf: string, perDay: number, days = 90): SalesPoint[] {
  return Array.from({ length: days }, (_, i) => ({ date: addDaysUtc(asOf, i - (days - 1)), units: perDay }));
}

export function makeSupplier(over: Partial<SupplierInput> = {}): SupplierInput {
  return {
    id: "sup-a",
    code: "SUP-01",
    name: "Test Supplier A",
    approvedStatus: "approved",
    defaultLeadTimeDays: 4,
    reliabilityScore: 90,
    paymentTermsDays: 30,
    ...over,
  };
}

export function makeProduct(over: Partial<ProductInput> = {}): ProductInput {
  return {
    id: "prod-1",
    sku: "PHX-TEST-1",
    brandName: "Testcip 500",
    genericName: "Paracetamol",
    strength: "500mg",
    dosageForm: "tablet",
    packSize: 10,
    manufacturer: "Test Pharma",
    category: "analgesic",
    storageClass: "ambient",
    criticality: "acute",
    unitMargin: "2.00",
    shelfLifeDays: 730,
    gstRate: "12.00",
    isActive: true,
    ...over,
  };
}

export function makeOffer(over: Partial<OfferInput> = {}): OfferInput {
  return {
    id: "off-a",
    supplierId: "sup-a",
    productId: "prod-1",
    unitPrice: "20.0000",
    moq: 20,
    packMultiple: 10,
    availableQty: 1000,
    leadTimeDays: 4,
    freightPerPack: "0.50",
    taxRate: "12.00",
    schemePaidQty: null,
    schemeFreeQty: null,
    quotedAt: `${addDaysUtc(AS_OF, -3)}T10:00:00.000Z`,
    validUntil: `${addDaysUtc(AS_OF, 20)}T10:00:00.000Z`,
    isActive: true,
    ...over,
  };
}

export function makeBatch(over: Partial<BatchInput> = {}): BatchInput {
  return {
    id: "bat-1",
    productId: "prod-1",
    batchNumber: "B000001",
    expiryDate: addDaysUtc(AS_OF, 600),
    receivedDate: addDaysUtc(AS_OF, -60),
    unitCost: "18.0000",
    qualityStatus: "released",
    returnPolicy: "unknown",
    ...over,
  };
}

export function makeBalance(over: Partial<BalanceInput> = {}): BalanceInput {
  return { id: "bal-1", batchId: "bat-1", locationId: "bin-1", onHandQty: 40, reservedQty: 0, ...over };
}

export function makeIncoming(over: Partial<IncomingInput> = {}): IncomingInput {
  return { poId: "po-1", status: "open", expectedDeliveryDate: addDaysUtc(AS_OF, 5), quantityPacks: 0, freeQty: 0, ...over };
}

/** A complete SKU: one approved supplier, one offer, one batch with 40 packs, 90 days of sales. */
export function makeSku(over: Partial<SkuContext> = {}): SkuContext {
  const supplier = makeSupplier();
  return {
    asOf: AS_OF,
    product: makeProduct(),
    offers: [makeOffer()],
    suppliers: { [supplier.id]: supplier },
    batches: [makeBatch()],
    balances: [makeBalance()],
    incoming: [],
    sales: flatSales(AS_OF, 9),
    firstSaleDate: addDaysUtc(AS_OF, -89),
    ...over,
  };
}

/** Three SKUs with different urgency, for plan-level tests. */
export function makeContext(): PlanningContext {
  const urgent = makeSku();
  const slow = makeSku({
    product: makeProduct({ id: "prod-2", sku: "PHX-TEST-2", criticality: "chronic" }),
    offers: [makeOffer({ id: "off-b", productId: "prod-2", leadTimeDays: 3 })],
    batches: [makeBatch({ id: "bat-2", productId: "prod-2" })],
    balances: [makeBalance({ id: "bal-2", batchId: "bat-2", onHandQty: 15 })],
    sales: flatSales(AS_OF, 2),
  });
  const healthy = makeSku({
    product: makeProduct({ id: "prod-3", sku: "PHX-TEST-3" }),
    offers: [makeOffer({ id: "off-c", productId: "prod-3" })],
    batches: [makeBatch({ id: "bat-3", productId: "prod-3" })],
    balances: [makeBalance({ id: "bal-3", batchId: "bat-3", onHandQty: 400 })],
    sales: flatSales(AS_OF, 3),
  });
  return { asOf: AS_OF, skus: [urgent, slow, healthy] };
}
