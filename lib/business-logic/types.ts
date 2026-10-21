// Decision-engine input and output types (implementationplan.md §6).
// Conventions:
//   - Money (rupees) is always a decimal string ("20.00", "20.8636") and is computed with lib/money.ts.
//   - Quantities are integer packs; demand, cover and scores are plain numbers (not money).
//   - Dates are "YYYY-MM-DD"; timestamps are ISO-8601 strings.

export type Money = string;
export type IsoDate = string;
export type IsoTimestamp = string;

// ---------------------------------------------------------------------------
// Codes (Appendix B)
// ---------------------------------------------------------------------------

export type ReasonCode =
  | "BELOW_REORDER_POINT"
  | "STOCKOUT_BEFORE_DELIVERY"
  | "CHEAPER_OFFER_TOO_SLOW"
  | "SCHEME_TAKEN"
  | "SCHEME_SKIPPED_EXPIRY"
  | "EXPIRY_REDUCED_QTY"
  | "BUDGET_DEFERRED"
  | "ALT_OFFER_FOR_BUDGET"
  | "PARTIAL_QTY_BUDGET"
  | "NO_ELIGIBLE_OFFER";

export type WarningCode =
  | "NO_DEMAND"
  | "LOW_HISTORY"
  | "DEMAND_SPIKE"
  | "AT_RISK_BATCHES"
  | "SCHEME_EXCESS_RISK"
  | "PRICE_ANOMALY"
  | "NOT_TOP_SUPPLIER"
  | "CAPACITY_REVIEW"
  | "UNMAPPED_STOCK";

export type OfferExclusionCode =
  | "SUPPLIER_NOT_APPROVED"
  | "QUOTE_EXPIRED"
  | "QUOTE_STALE"
  | "MISSING_PRICE"
  | "OFFER_INACTIVE"
  | "PRODUCT_MISMATCH"
  | "INSUFFICIENT_AVAILABILITY"
  | "INVALID_PACK_RULES"
  | "TOO_SLOW_FOR_COVER";

export type HardStopCode =
  | "INVALID_SKU"
  | "SUPPLIER_NOT_APPROVED"
  | "QUOTE_EXPIRED"
  | "QUOTE_STALE"
  | "MISSING_PRICE"
  | "INVALID_PACK_MULTIPLE"
  | "BELOW_MOQ"
  | "ABOVE_AVAILABILITY"
  | "NON_POSITIVE_QTY"
  | "OVER_BUDGET"
  | "INVALID_BUDGET"
  | "PRODUCT_RECALLED";

export type SkuStatus = "NO_DEMAND" | "STOCKOUT_RISK" | "BELOW_ROP" | "EXCESS" | "HEALTHY";

export type Criticality = "life_saving" | "chronic" | "acute" | "otc";
export type StorageClass = "ambient" | "cool" | "cold_chain";
export type QualityStatus = "released" | "quarantine" | "rejected" | "recalled";
export type ReturnPolicy = "returnable" | "non_returnable" | "unknown";
export type SupplierStatus = "approved" | "pending" | "blocked";

// ---------------------------------------------------------------------------
// Inputs (plain objects built by lib/services/context.ts; no DB types here)
// ---------------------------------------------------------------------------

export type ProductInput = {
  id: string;
  sku: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  packSize: number;
  manufacturer: string;
  category: string;
  storageClass: StorageClass;
  criticality: Criticality;
  unitMargin: Money; // per pack
  shelfLifeDays: number;
  gstRate: Money; // percent, e.g. "12.00"
  isActive: boolean;
};

export type SupplierInput = {
  id: string;
  code: string; // "SUP-03"
  name: string;
  approvedStatus: SupplierStatus;
  defaultLeadTimeDays: number;
  reliabilityScore: number | null; // 0–100; null scores 0
  paymentTermsDays: number | null; // null scores 0
};

export type OfferInput = {
  id: string;
  supplierId: string;
  productId: string;
  unitPrice: Money | null; // per pack, before GST; null = missing price
  moq: number; // packs
  packMultiple: number; // order in multiples of N packs
  availableQty: number; // packs
  leadTimeDays: number;
  freightPerPack: Money;
  taxRate: Money; // percent
  schemePaidQty: number | null; // "10+1" → 10
  schemeFreeQty: number | null; // "10+1" → 1
  quotedAt: IsoTimestamp;
  validUntil: IsoTimestamp;
  isActive: boolean;
};

export type BatchInput = {
  id: string;
  productId: string;
  batchNumber: string;
  expiryDate: IsoDate;
  receivedDate: IsoDate;
  unitCost: Money; // per pack
  qualityStatus: QualityStatus;
  returnPolicy: ReturnPolicy;
};

export type BalanceInput = {
  id: string;
  batchId: string;
  locationId: string | null; // null = unmapped stock
  onHandQty: number;
  reservedQty: number;
};

/** A line on an external PO (status 'open' = confirmed incoming). PharmaOS drafts are never passed here. */
export type IncomingInput = {
  poId: string;
  status: "open" | "received" | "cancelled";
  expectedDeliveryDate: IsoDate;
  quantityPacks: number;
  freeQty: number;
};

export type SalesPoint = { date: IsoDate; units: number }; // packs sold that day; a missing day = 0

export type SkuContext = {
  asOf: IsoDate;
  product: ProductInput;
  offers: OfferInput[];
  suppliers: Record<string, SupplierInput>; // by supplier id
  batches: BatchInput[];
  balances: BalanceInput[];
  incoming: IncomingInput[];
  sales: SalesPoint[];
  firstSaleDate: IsoDate | null;
};

export type PlanningContext = {
  asOf: IsoDate;
  skus: SkuContext[];
};

// ---------------------------------------------------------------------------
// Intermediate results
// ---------------------------------------------------------------------------

export type DemandResult = {
  d7: number;
  d28: number;
  avgDailyDemand: number; // d̄
  windowDays: { short: 7; long: 28 };
  flags: WarningCode[]; // NO_DEMAND, LOW_HISTORY, DEMAND_SPIKE
  dailySeries: SalesPoint[]; // last 28 days, oldest first, zeros filled
};

export type BatchProjection = {
  batchId: string;
  batchNumber: string;
  expiryDate: IsoDate;
  daysToExpiry: number;
  sellableDays: number;
  available: number; // on hand − reserved, summed over bins
  projectedSold: number;
  atRiskQty: number;
  atRiskValue: Money;
  returnPolicy: ReturnPolicy;
};

export type IneligibleBatch = {
  batchId: string;
  batchNumber: string;
  reason: "quarantine" | "rejected" | "recalled" | "expired";
  onHandQty: number;
};

export type ExpiryResult = {
  batches: BatchProjection[]; // FEFO order
  eligibleAvailable: number; // Σ projectedSold
  atRiskQty: number;
  atRiskValue: Money;
  ineligible: IneligibleBatch[];
};

export type OrderQuantity = {
  qRaw: number;
  q: number; // after pack-multiple rounding and MOQ
  reasons: ReasonCode[]; // EXPIRY_REDUCED_QTY when reduced to ROP
};

export type SchemeDecision = {
  taken: boolean;
  qty: number; // paid packs
  freeQty: number;
  reason: "SCHEME_TAKEN" | "SCHEME_SKIPPED_EXPIRY" | null;
  warning: "SCHEME_EXCESS_RISK" | null;
  expiryAvoidedValue: Money; // "0.00" unless SCHEME_SKIPPED_EXPIRY
};

export type ScoreInput = {
  offerId: string;
  supplierCode: string;
  effectiveCost: Money;
  leadTimeDays: number;
  reliabilityScore: number | null;
  paymentTermsDays: number | null;
};

export type ScoreFactors = { cost: number; leadTime: number; reliability: number; terms: number };

export type ScoredOffer = ScoreInput & { factors: ScoreFactors; score: number };

export type UrgencyResult = {
  kept: string[]; // offer ids
  dropped: { offerId: string; code: "TOO_SLOW_FOR_COVER" }[];
  lineReasons: ReasonCode[]; // CHEAPER_OFFER_TOO_SLOW, STOCKOUT_BEFORE_DELIVERY
};

export type LineTotals = { lineSubtotal: Money; lineTax: Money; lineFreight: Money; lineTotal: Money };

export type OfferEvaluation = {
  offerId: string;
  supplierId: string;
  supplierCode: string;
  exclusions: OfferExclusionCode[]; // empty = eligible
  order: OrderQuantity | null;
  scheme: SchemeDecision | null;
  effectiveCost: Money | null;
  totals: LineTotals | null;
  factors: ScoreFactors | null;
  score: number | null;
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type SkuAnalysis = {
  productId: string;
  sku: string;
  status: SkuStatus;
  demand: DemandResult;
  expiry: ExpiryResult;
  incomingQty: number;
  stockPosition: number;
  cover: number | null; // null when d̄ = 0
  leadFastest: number;
  reorderPoint: number; // at leadFastest
  targetStock: number; // at leadFastest
  candidate: boolean;
  offers: OfferEvaluation[];
  chosen: OfferEvaluation | null;
  qty: number;
  freeQty: number;
  totals: LineTotals | null;
  lossPrevented: Money;
  priority: number;
  reasons: ReasonCode[];
  warnings: WarningCode[];
  hardStops: HardStopCode[];
  evidence: Record<string, unknown>; // every input and intermediate, stored as evidence_json
};

export type PlanLine = {
  productId: string;
  sku: string;
  rank: number; // 1 = top
  status: SkuStatus;
  cover: number | null;
  offerId: string | null;
  supplierId: string | null;
  qty: number;
  freeQty: number;
  unitPrice: Money | null;
  totals: LineTotals | null;
  lossPrevented: Money;
  priority: number;
  inBasket: boolean;
  reasons: ReasonCode[];
  warnings: WarningCode[];
  evidence: Record<string, unknown>;
};

export type ImpactCard = {
  skusAtRisk: number;
  stockoutsCovered: number;
  marginProtected: Money;
  expiryExposure: Money;
  expiryAvoided: Money;
  cashCommitted: Money;
  budgetRemaining: Money;
  deferredCount: number;
  deferredRisk: Money;
  lossPreventedPerRupee: number | null; // null when the plan total is 0
};

export type PlanResult = {
  asOf: IsoDate;
  budget: Money;
  lines: PlanLine[]; // candidates only, ranked
  skuStatuses: { productId: string; sku: string; status: SkuStatus; atRiskValue: Money }[];
  planTotal: Money;
  budgetRemaining: Money;
  impact: ImpactCard;
};

// ---------------------------------------------------------------------------
// Basket inputs (§6.9)
// ---------------------------------------------------------------------------

/** A priced option for a line: the chosen offer or a next-best alternative. */
export type BasketOption = {
  offerId: string;
  qty: number;
  freeQty: number;
  unitPrice: Money;
  taxRate: Money;
  freightPerPack: Money;
  moq: number;
  packMultiple: number;
  lineTotal: Money;
};

export type BasketCandidate = {
  key: string; // usually the SKU
  priority: number;
  cover: number | null;
  criticalityWeight: number;
  option: BasketOption; // best-scored offer
  alternatives: BasketOption[]; // next-best eligible offers, in score order
};

export type BasketLine = {
  key: string;
  inBasket: boolean;
  option: BasketOption; // what is (or would be) bought
  reasons: ReasonCode[]; // BUDGET_DEFERRED, ALT_OFFER_FOR_BUDGET, PARTIAL_QTY_BUDGET
};

export type BasketResult = { lines: BasketLine[]; total: Money; remaining: Money };

export type RecommendationStatus = "proposed" | "edited" | "approved_for_po" | "rejected" | "deferred";

/** Key used to rank candidate lines deterministically (§6.8). */
export type PriorityKey = { key: string; priority: number; cover: number | null; criticalityWeight: number };
