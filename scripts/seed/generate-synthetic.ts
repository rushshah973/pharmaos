// Phase D2: generate every synthetic table in memory (implementationplan.md §5.5).
// Pure and deterministic: generate(profile, asOf, seed) always returns the same rows.
// Uses only aggregate statistics from profile.json, never reference rows.
// Nothing is written to the database here (that is write.ts, P06).
import { faker } from "@faker-js/faker";
import { dec, roundMoney, roundUnit } from "@/lib/money";
import {
  BRAND_PREFIXES,
  BRAND_SUFFIXES,
  CATEGORIES,
  COMBINATIONS,
  FORMS,
  GENERICS,
  MANUFACTURER_PARTS,
  SUPPLIER_PARTS,
  type Category,
  type Form,
} from "./catalog";
import { createRng, type Rng } from "./prng";

export const DATA_SOURCE = "synthetic_demo" as const;

// ---------------------------------------------------------------------------
// Row types: snake_case, matching db/migrations/001_init.sql. Money as strings.
// ---------------------------------------------------------------------------

export type StorageClass = "ambient" | "cool" | "cold_chain";
export type Criticality = "life_saving" | "chronic" | "acute" | "otc";

export type ProductRow = {
  id: string;
  sku: string;
  brand_name: string;
  generic_name: string;
  strength: string;
  dosage_form: Form;
  pack_size: number;
  manufacturer: string;
  category: Category;
  storage_class: StorageClass;
  criticality: Criticality;
  ptr: string;
  unit_margin: string;
  shelf_life_days: number;
  gst_rate: string;
  is_active: boolean;
  data_source: typeof DATA_SOURCE;
};

export type SupplierRow = {
  id: string;
  name: string;
  supplier_code: string;
  approved_status: "approved" | "pending" | "blocked";
  default_lead_time_days: number;
  reliability_score: string | null;
  payment_terms_days: number | null;
  data_source: typeof DATA_SOURCE;
};

export type OfferRow = {
  id: string;
  supplier_id: string;
  product_id: string;
  unit_price: string;
  moq: number;
  pack_multiple: number;
  available_qty: number;
  lead_time_days: number;
  freight_per_pack: string;
  tax_rate: string;
  scheme_paid_qty: number | null;
  scheme_free_qty: number | null;
  quoted_at: string;
  valid_until: string;
  source_type: "synthetic";
  price_type: "supplier_quote";
  is_active: boolean;
  data_source: typeof DATA_SOURCE;
};

export type SalesRow = { product_id: string; sale_date: string; units_sold: number; data_source: typeof DATA_SOURCE };

export type LocationRow = {
  id: string;
  warehouse_id: string;
  zone: string;
  aisle: string;
  rack: string;
  shelf: number;
  bin_code: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  capacity_units: number;
  storage_class: StorageClass;
  status: "active" | "inactive";
};

export type BatchRow = {
  id: string;
  product_id: string;
  batch_number: string;
  expiry_date: string;
  received_date: string;
  supplier_id: string;
  unit_cost: string;
  quality_status: "released" | "quarantine" | "rejected" | "recalled";
  return_policy_status: "returnable" | "non_returnable" | "unknown";
  data_source: typeof DATA_SOURCE;
};

export type BalanceRow = {
  id: string;
  product_id: string;
  batch_id: string;
  location_id: string | null;
  on_hand_qty: number;
  reserved_qty: number;
  data_source: typeof DATA_SOURCE;
};

export type PurchaseOrderRow = {
  id: string;
  po_number: string;
  supplier_id: string;
  status: "open" | "received" | "cancelled";
  subtotal: string;
  tax_total: string;
  freight_total: string;
  grand_total: string;
  expected_delivery_date: string;
  source_plan_id: null;
  idempotency_key: null;
  approved_by: null;
  approved_at: null;
  created_at: string;
  data_source: typeof DATA_SOURCE;
};

export type PurchaseOrderLineRow = {
  id: string;
  po_id: string;
  product_id: string;
  supplier_offer_id: string;
  recommendation_id: null;
  quantity_packs: number;
  free_qty: number;
  unit_price: string;
  tax_rate: string;
  line_subtotal: string;
  line_tax: string;
  line_freight: string;
  line_total: string;
};

export type DemandKind = "stable" | "intermittent" | "growing" | "declining" | "spike";

export type SyntheticDataset = {
  products: ProductRow[];
  suppliers: SupplierRow[];
  supplierOffers: OfferRow[];
  salesHistory: SalesRow[];
  inventoryLocations: LocationRow[];
  batches: BatchRow[];
  inventoryBalances: BalanceRow[];
  purchaseOrders: PurchaseOrderRow[];
  purchaseOrderLines: PurchaseOrderLineRow[];
  meta: {
    asOf: string;
    seed: number;
    /** Per SKU: demand kind and base packs/day, for inject-demo-cases.ts (P06). */
    demandBySku: Record<string, { kind: DemandKind; basePacksPerDay: number }>;
    /** Per SKU: the target days of cover used to size stock. */
    coverDaysBySku: Record<string, number>;
    /**
     * Per product id: true customer demand per day (oldest first, the same days as salesHistory). Recorded sales
     * are what stock allowed, so they are lower on stock-out days. In memory only (forecast evaluation); never written.
     */
    trueDemand: Record<string, number[]>;
    profileUsed: { catalogue: boolean; sales: boolean };
  };
};

// ---------------------------------------------------------------------------
// Profile (only the aggregate fields the generator reads; any may be missing)
// ---------------------------------------------------------------------------

type Missing = { missing: true };
type Quantiles = Record<string, number>;
export type Profile = {
  dosageFormShare?: Record<string, number> | Missing;
  packQuantityShareByForm?: Record<string, Record<string, number>> | Missing;
  categoryShare?: Record<string, number> | Missing;
  priceQuantilesByCategory?: Record<string, Quantiles | null> | Missing;
  compositionCountShare?: { single: number; combination: number } | Missing;
  dailyDemandQuantiles?: Quantiles | Missing;
  zeroDayShare?: number | Missing;
  expiryDaysLeftQuantiles?: Quantiles | Missing;
  weekdayFactors?: Record<string, number> | Missing;
};

function present<T>(v: T | Missing | undefined | null): T | null {
  if (v == null) return null;
  if (typeof v === "object" && "missing" in (v as object)) return null;
  return v as T;
}

export type GenerateOptions = {
  /** Lower-case names the generator must not produce (reference brand/manufacturer/supplier names). */
  forbiddenNames?: ReadonlySet<string>;
};

// ---------------------------------------------------------------------------
// Constants from plan §5.5
// ---------------------------------------------------------------------------

export const PRODUCT_COUNT = 500;
export const SALES_DAYS = 90;
/** Demo capacity proxy per bin, in packs (sized so 500 SKUs at about three weeks of stock fit in 240 bins). */
const BIN_CAPACITY = { min: 800, max: 2000 };
/** A mid-size stockist: about ₹15–20 Cr of purchases a year across 500 SKUs. */
const MEDIAN_PACKS_PER_DAY = 12;
const MIN_PACKS_PER_DAY = 1.5;
const MAX_PACKS_PER_DAY = 90;
const DEFAULT_ZERO_DAY_SHARE = 0.6;
const RISK_WINDOW_DAYS = 90;
const SHORT_DATED_CAP = 0.15;
const DEFAULT_SHORT_DATED = 0.1;
const DEFAULT_PACK_SIZE: Record<Form, number> = { tablet: 10, capsule: 10, syrup: 100, injection: 1, ointment: 15, drops: 10 };
/** Demand spread relative to the median (used when the profile has no demand quantiles). */
const DEFAULT_DEMAND_RATIO = { p10: 0.25, p25: 0.55, p50: 1, p75: 1.5, p90: 2.1 };
const QUANTILE_POINTS = [0.1, 0.25, 0.5, 0.75, 0.9] as const;

// ---------------------------------------------------------------------------
// Date helpers (UTC calendar dates as YYYY-MM-DD; never local time)
// ---------------------------------------------------------------------------

function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
const at10Utc = (dateIso: string) => `${dateIso}T10:00:00.000Z`;

// ---------------------------------------------------------------------------
// Sampling helpers
// ---------------------------------------------------------------------------

/** Sample from known quantiles by linear interpolation between them (u in [0.1, 0.9]). */
function sampleFromQuantiles(rng: Rng, q: Quantiles): number {
  const points = QUANTILE_POINTS.map((p) => [p, q[`p${Math.round(p * 100)}`]] as const).filter(
    ([, v]) => typeof v === "number" && Number.isFinite(v),
  );
  if (points.length === 0) return NaN;
  if (points.length === 1) return points[0][1];
  const u = rng.float(points[0][0], points[points.length - 1][0]);
  for (let i = 1; i < points.length; i++) {
    const [p0, v0] = points[i - 1];
    const [p1, v1] = points[i];
    if (u <= p1) return v0 + ((v1 - v0) * (u - p0)) / (p1 - p0);
  }
  return points[points.length - 1][1];
}

/** Estimated share of values below x from quantiles (linear CDF between points). */
function shareBelow(q: Quantiles, x: number): number | null {
  const points = QUANTILE_POINTS.map((p) => [p, q[`p${Math.round(p * 100)}`]] as const).filter(
    ([, v]) => typeof v === "number",
  );
  if (points.length < 2) return null;
  if (x <= points[0][1]) return points[0][0] * (x / Math.max(points[0][1], 1));
  for (let i = 1; i < points.length; i++) {
    const [p0, v0] = points[i - 1];
    const [p1, v1] = points[i];
    if (x <= v1) return p0 + ((p1 - p0) * (x - v0)) / Math.max(v1 - v0, 1e-9);
  }
  return points[points.length - 1][0];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Does a strength string suit a dosage form? ("125mg/5ml" → syrup, "1% w/w" → ointment, "500mg" → tablet…) */
export function strengthFits(strength: string, form: Form): boolean {
  const s = strength.toLowerCase();
  const topical = s.includes("w/w");
  const liquid = /\/\s*\d*\s*ml|w\/v/.test(s);
  switch (form) {
    case "tablet":
    case "capsule":
      return !liquid && !topical;
    case "ointment":
      return topical;
    case "syrup":
      return /\/\s*\d+\s*ml/.test(s) && !s.includes("iu");
    case "drops":
      return liquid;
    case "injection":
      return !topical && !/\/\s*\d+\s*ml/.test(s);
  }
}

function pickName(rng: Rng, build: () => string, taken: Set<string>, forbidden: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const name = build();
    const key = name.toLowerCase();
    if (!taken.has(key) && !forbidden.has(key)) {
      taken.add(key);
      return name;
    }
  }
  throw new Error("Could not generate a unique name; extend the name lists in catalog.ts.");
}

/** Line totals per plan §6.7. Replaced by lib/business-logic/totals.ts once stage 2 exists. */
function lineAmounts(qty: number, unitPrice: string, taxRate: string, freightPerPack: string) {
  const subtotal = roundMoney(dec(unitPrice).times(qty));
  const tax = roundMoney(subtotal.times(taxRate).dividedBy(100));
  const freight = roundMoney(dec(freightPerPack).times(qty));
  return { subtotal, tax, freight, total: subtotal.plus(tax).plus(freight) };
}

// ---------------------------------------------------------------------------
// generate()
// ---------------------------------------------------------------------------

export function generate(profile: Profile, asOf: string, seed = 42, options: GenerateOptions = {}): SyntheticDataset {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`asOf must be YYYY-MM-DD, got "${asOf}"`);
  const rng = createRng(seed);
  faker.seed(seed);
  const forbidden = options.forbiddenNames ?? new Set<string>();

  const formShare = present(profile.dosageFormShare);
  const packShare = present(profile.packQuantityShareByForm);
  const categoryShare = present(profile.categoryShare);
  const priceQ = present(profile.priceQuantilesByCategory);
  const comboShare = present(profile.compositionCountShare);
  const demandQ = present(profile.dailyDemandQuantiles);
  const zeroShareProfile = present(profile.zeroDayShare);
  const expiryQ = present(profile.expiryDaysLeftQuantiles);
  const weekday = present(profile.weekdayFactors);

  // ---- Suppliers (8): 6 approved, 1 pending, 1 blocked; one approved with null reliability ----
  // Lead times as Indian pharma distribution runs: local distributors deliver next day or in 2–3 days;
  // one approved supplier is a manufacturer-direct channel (cheaper, 5–7 days) — the "cheaper but slower" trade-off.
  const supplierNames = new Set<string>();
  const statuses: SupplierRow["approved_status"][] = ["approved", "approved", "approved", "approved", "approved", "approved", "pending", "blocked"];
  const approvedLeads = rng.shuffle([1, 1, 2, 2, 3, 6]);
  const suppliers: SupplierRow[] = statuses.map((status, i) => ({
    id: rng.uuid(),
    name: pickName(rng, () => `${rng.pick(SUPPLIER_PARTS.first)} ${rng.pick(SUPPLIER_PARTS.last)}`, supplierNames, forbidden),
    supplier_code: `SUP-${String(i + 1).padStart(2, "0")}`,
    approved_status: status,
    default_lead_time_days: status === "approved" ? approvedLeads[i] : rng.int(2, 4),
    reliability_score: i === 5 ? null : rng.float(60, 98).toFixed(2),
    payment_terms_days: rng.pick([15, 21, 30, 45, 60]),
    data_source: DATA_SOURCE,
  }));
  const approvedSuppliers = suppliers.filter((s) => s.approved_status === "approved");
  const isDirect = (s: SupplierRow) => s.approved_status === "approved" && s.default_lead_time_days >= 5;

  // ---- Manufacturers (fictional) ----
  const makerNames = new Set<string>();
  const manufacturers = Array.from({ length: 20 }, () =>
    pickName(rng, () => `${rng.pick(MANUFACTURER_PARTS.first)} ${rng.pick(MANUFACTURER_PARTS.last)}`, makerNames, forbidden),
  );

  // ---- Products (PRODUCT_COUNT) ----
  const categoryWeights = CATEGORIES.map((c) => [c, categoryShare?.[c] ?? 1] as const);
  const comboProbability = comboShare ? clamp(comboShare.combination, 0, 0.6) : 0.3;
  const brandNames = new Set<string>();
  const products: ProductRow[] = [];

  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const category = rng.weighted(categoryWeights);
    const isCombo = rng.chance(comboProbability) && COMBINATIONS[category].length > 0;

    // Pick the form first, then only a strength that suits it (no "125mg/5ml" tablets).
    const formWeight = (f: Form) => [f, formShare?.[f] ?? 1 / FORMS.length] as const;
    let genericName: string;
    let strength: string;
    let form: Form;
    const usableCombos = COMBINATIONS[category].filter(([primary, , partnerStrength, forms]) => {
      const base = GENERICS[category].find((g) => g.name === primary);
      return forms.some((f) => strengthFits(partnerStrength, f) && (base?.strengths ?? []).some((s) => strengthFits(s, f)));
    });
    const combo = isCombo && usableCombos.length > 0 ? rng.pick(usableCombos) : undefined;
    if (combo) {
      const [primary, partner, partnerStrength, forms] = combo;
      const base = GENERICS[category].find((g) => g.name === primary)!;
      form = rng.weighted(forms.filter((f) => strengthFits(partnerStrength, f) && base.strengths.some((s) => strengthFits(s, f))).map(formWeight));
      genericName = `${primary} + ${partner}`;
      strength = `${rng.pick(base.strengths.filter((s) => strengthFits(s, form)))} + ${partnerStrength}`;
    } else {
      const g = rng.pick(GENERICS[category]);
      form = rng.weighted(g.forms.filter((f) => g.strengths.some((s) => strengthFits(s, f))).map(formWeight));
      genericName = g.name;
      strength = rng.pick(g.strengths.filter((s) => strengthFits(s, form)));
    }

    const packWeights = Object.entries(packShare?.[form] ?? {})
      .map(([q, w]) => [Number(q), w] as const)
      .filter(([q]) => Number.isInteger(q) && q > 0);
    const packSize = packWeights.length ? rng.weighted(packWeights) : DEFAULT_PACK_SIZE[form];

    const strengthNumber = strength.match(/\d+(?:\.\d+)?/)?.[0] ?? "";
    const brand = pickName(
      rng,
      () => `${rng.pick(BRAND_PREFIXES)}${rng.pick(BRAND_SUFFIXES)}${strengthNumber ? ` ${strengthNumber}` : ""}`,
      brandNames,
      forbidden,
    );

    // PTR: sampled from the category's PTR-estimate quantiles (default ₹15–₹900), perturbed ±5%.
    const q = priceQ?.[category];
    const sampled = q ? sampleFromQuantiles(rng, q) : Math.exp(rng.float(Math.log(15), Math.log(900)));
    const ptr = roundMoney(clamp(Number.isFinite(sampled) ? sampled : 60, 15, 900) * rng.float(0.95, 1.05));
    const margin = roundMoney(ptr.times(rng.float(0.08, 0.1)));

    const isInsulin = /insulin/i.test(genericName);
    const storage: StorageClass = isInsulin
      ? "cold_chain"
      : rng.weighted([["ambient", 0.85], ["cool", 0.1], ["cold_chain", form === "injection" ? 0.15 : 0.02]] as const);

    products.push({
      id: rng.uuid(),
      sku: `PHX-${String(i + 1).padStart(4, "0")}`,
      brand_name: brand,
      generic_name: genericName,
      strength,
      dosage_form: form,
      pack_size: packSize,
      manufacturer: rng.pick(manufacturers),
      category,
      storage_class: storage,
      criticality: rng.weighted([["life_saving", 0.1], ["chronic", 0.3], ["acute", 0.45], ["otc", 0.15]] as const),
      ptr: ptr.toFixed(2),
      unit_margin: margin.toFixed(2),
      shelf_life_days: rng.int(540, 1095),
      gst_rate: rng.chance(0.7) ? "12.00" : "5.00",
      is_active: true,
      data_source: DATA_SOURCE,
    });
  }

  // ---- Supplier offers (1–4 per SKU, mostly 2–3; the first is the stockist's usual distributor, always approved) ----
  const supplierOffers: OfferRow[] = [];
  for (const p of products) {
    const count = rng.weighted([[1, 0.1], [2, 0.35], [3, 0.4], [4, 0.15]] as const);
    const chosen = [rng.pick(approvedSuppliers.filter((s) => !isDirect(s)))];
    for (const s of rng.shuffle(suppliers)) {
      if (chosen.length >= count) break;
      if (!chosen.includes(s)) chosen.push(s);
    }
    for (const s of chosen) {
      // ≈10% stale (quoted 15–20 days ago); ≈5% already expired (valid_until before as-of).
      const stale = rng.chance(0.1);
      const expired = rng.chance(0.05);
      const daysAgo = stale ? rng.int(15, 20) : expired ? rng.int(3, 14) : rng.int(1, 14);
      const quotedDate = addDays(asOf, -daysAgo);
      const validDays = expired ? rng.int(1, daysAgo - 1) : Math.max(rng.int(7, 30), daysAgo + 1);
      const scheme = rng.chance(0.15) ? rng.pick([[10, 1], [20, 3], [5, 1]] as const) : null;
      supplierOffers.push({
        id: rng.uuid(),
        supplier_id: s.id,
        product_id: p.id,
        // Manufacturer-direct buys a few % cheaper than distributors.
        unit_price: roundUnit(dec(p.ptr).times(isDirect(s) ? rng.float(0.74, 0.8) : rng.float(0.8, 0.9))).toFixed(4),
        moq: rng.pick([1, 5, 10, 20]),
        pack_multiple: rng.pick([1, 5, 10]),
        available_qty: rng.int(50, 2000),
        lead_time_days: Math.max(1, s.default_lead_time_days + rng.int(-1, 1)),
        freight_per_pack: rng.float(0, 1.5).toFixed(2),
        tax_rate: p.gst_rate,
        scheme_paid_qty: scheme ? scheme[0] : null,
        scheme_free_qty: scheme ? scheme[1] : null,
        quoted_at: at10Utc(quotedDate),
        valid_until: at10Utc(addDays(quotedDate, validDays)),
        source_type: "synthetic",
        price_type: "supplier_quote",
        is_active: true,
        data_source: DATA_SOURCE,
      });
    }
  }
  const offersByProduct = new Map<string, OfferRow[]>();
  for (const o of supplierOffers) offersByProduct.set(o.product_id, [...(offersByProduct.get(o.product_id) ?? []), o]);

  // ---- Customer demand (90 days ending on asOf); sales are recorded by the simulation below ----
  const zeroShare = typeof zeroShareProfile === "number" ? clamp(zeroShareProfile, 0, 0.9) : DEFAULT_ZERO_DAY_SHARE;
  const demandRatio = demandQ
    ? Object.fromEntries(Object.entries(demandQ).map(([k, v]) => [k, v / (demandQ.p50 || 1)]))
    : DEFAULT_DEMAND_RATIO;
  const salesHistory: SalesRow[] = [];
  const demandBySku: SyntheticDataset["meta"]["demandBySku"] = {};
  /** Customer demand per SKU per day; recorded sales = what stock allowed (see the operations simulation). */
  const demandUnits = new Map<string, number[]>();
  for (const p of products) {
    const units: number[] = [];
    demandUnits.set(p.id, units);
    const kind = rng.weighted([["stable", 0.45], ["intermittent", 0.2], ["growing", 0.16], ["declining", 0.16], ["spike", 0.03]] as const);
    const base = clamp(MEDIAN_PACKS_PER_DAY * sampleFromQuantiles(rng, demandRatio), MIN_PACKS_PER_DAY, MAX_PACKS_PER_DAY);
    demandBySku[p.sku] = { kind, basePacksPerDay: Math.round(base * 100) / 100 };
    for (let t = 0; t < SALES_DAYS; t++) {
      const date = addDays(asOf, t - (SALES_DAYS - 1));
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekFactor = weekday?.[String(dow)] ?? 1;
      let lambda = base * weekFactor;
      if (kind === "growing") lambda *= 1.01 ** (t - (SALES_DAYS - 1));
      if (kind === "declining") lambda *= 0.99 ** (t - (SALES_DAYS - 1));
      if (kind === "spike" && t >= SALES_DAYS - 5) lambda *= 3;
      units.push(kind === "intermittent" ? (rng.chance(zeroShare) ? 0 : rng.poisson(lambda / (1 - zeroShare))) : rng.poisson(lambda));
    }
  }

  // ---- Inventory locations (240 bins) ----
  const aisles = ["A", "B", "C", "D", "E"];
  const inventoryLocations: LocationRow[] = [];
  aisles.forEach((aisle, ai) => {
    for (const side of ["L", "R"] as const) {
      for (let rack = 1; rack <= 6; rack++) {
        for (let shelf = 1; shelf <= 4; shelf++) {
          const storage: StorageClass = aisle !== "E" ? "ambient" : side === "L" ? "cold_chain" : "cool";
          inventoryLocations.push({
            id: rng.uuid(),
            warehouse_id: "WH-01",
            zone: storage === "ambient" ? "AMBIENT" : storage === "cool" ? "COOL" : "COLD",
            aisle,
            rack: `${side}${String(rack).padStart(2, "0")}`,
            shelf,
            bin_code: `${aisle}-${side}-${String(rack).padStart(2, "0")}-${shelf}`,
            x: ai * 4 + (side === "L" ? -1 : 1),
            y: Math.round((shelf - 1) * 0.7 * 100) / 100,
            z: Math.round((rack - 1) * 1.2 * 100) / 100,
            width: 1,
            depth: 1,
            height: 0.6,
            capacity_units: rng.int(BIN_CAPACITY.min, BIN_CAPACITY.max),
            storage_class: storage,
            status: "active",
          });
        }
      }
    }
  });
  for (const bin of rng.shuffle(inventoryLocations.filter((b) => b.storage_class === "ambient")).slice(0, 4)) bin.status = "inactive";

  // ---- Daily operations simulation (90 days ending on asOf) ----
  // How a stockist actually runs: each SKU is reviewed twice a week and topped up from its usual distributor
  // on a rough rule of thumb; deliveries arrive after the offer's lead time (sometimes late, by supplier
  // reliability) as new batches; every day's demand is sold from stock, oldest expiry first (FEFO). What is
  // left at asOf — batches, stock, POs still on the way, POs received recently — is the seeded state.
  // Imperfect on purpose (missed reviews, late deliveries, trends, spikes), so a realistic few SKUs end short.
  const shortShare = expiryQ
    ? Math.min(shareBelow(expiryQ, RISK_WINDOW_DAYS) ?? DEFAULT_SHORT_DATED, SHORT_DATED_CAP)
    : DEFAULT_SHORT_DATED;
  const startDate = addDays(asOf, -(SALES_DAYS - 1));
  const supplierById = new Map(suppliers.map((sp) => [sp.id, sp]));
  const batches: BatchRow[] = [];
  const batchesByProduct = new Map<string, BatchRow[]>();
  const stockByBatch = new Map<string, number>();
  type SimOrder = { productId: string; offer: OfferRow; qty: number; orderDay: number; arrivalDay: number; expectedDay: number; cancelled: boolean };
  const orders: SimOrder[] = [];
  const batchNumbers = new Set<string>();
  const newBatchNumber = () => {
    let n: string;
    do n = `B${faker.string.alphanumeric({ length: 6, casing: "upper" })}`;
    while (batchNumbers.has(n));
    batchNumbers.add(n);
    return n;
  };
  const makeBatch = (p: ProductRow, offer: OfferRow, receivedDay: number, shortDated: boolean): BatchRow => {
    // Stock arrives part-way through its shelf life (manufactured 1–6 months earlier); a few lots are short-dated.
    const age = shortDated ? rng.int(Math.max(30, p.shelf_life_days - 240), Math.max(60, p.shelf_life_days - 150)) : rng.int(30, 180);
    const received = addDays(startDate, receivedDay);
    const row: BatchRow = {
      id: rng.uuid(),
      product_id: p.id,
      batch_number: newBatchNumber(),
      expiry_date: addDays(received, Math.max(60, p.shelf_life_days - age)),
      received_date: received,
      supplier_id: offer.supplier_id,
      unit_cost: roundUnit(dec(offer.unit_price).times(rng.float(0.97, 1.03))).toFixed(4),
      quality_status: "released",
      return_policy_status: rng.weighted([["returnable", 0.4], ["non_returnable", 0.3], ["unknown", 0.3]] as const),
      data_source: DATA_SOURCE,
    };
    batches.push(row);
    batchesByProduct.set(p.id, [...(batchesByProduct.get(p.id) ?? []), row]);
    return row;
  };
  const coverDaysBySku: Record<string, number> = {};

  for (const p of products) {
    const usual = (offersByProduct.get(p.id) ?? [])[0];
    const supplier = supplierById.get(usual.supplier_id)!;
    const lateChance = (100 - Number(supplier.reliability_score ?? 75)) / 100;
    const demandPath = demandUnits.get(p.id)!;
    const base = demandBySku[p.sku].basePacksPerDay;
    // Two review days a week (e.g. Mon + Thu), different per SKU.
    const firstReview = rng.int(0, 6);
    const reviewDays = new Set([firstReview, (firstReview + 3) % 7]);
    const myOrders: SimOrder[] = [];
    const soldHistory: number[] = [];
    const orderUp = (packs: number) => Math.max(usual.moq, Math.ceil(packs / usual.pack_multiple) * usual.pack_multiple);

    // Opening stock: 20–40 days of cover in 1–2 lots received over the previous months.
    const opening = Math.round(base * rng.int(20, 40));
    // Manual ordering is inconsistent: each SKU has its own trigger (4–14 days of cover beyond the lead time) and
    // top-up level (25–40 days), so on any day some SKUs are already short of what a planner would want.
    const triggerDays = rng.int(4, 14);
    const topUpDays = rng.int(25, 40);
    const lots = opening > 20 && rng.chance(0.5) ? 2 : 1;
    for (let k = 0; k < lots; k++) {
      const batch = makeBatch(p, usual, -rng.int(10, 120), rng.chance(shortShare));
      stockByBatch.set(batch.id, Math.round(opening / lots));
    }

    for (let t = 0; t < SALES_DAYS; t++) {
      // 1. Deliveries that arrive today become new batches.
      for (const o of myOrders) {
        if (o.cancelled || o.arrivalDay !== t) continue;
        const batch = makeBatch(p, o.offer, t, rng.chance(shortShare * 0.5));
        stockByBatch.set(batch.id, o.qty);
      }
      // 2. Sell today's demand from eligible stock, oldest expiry first; anything short is a lost sale.
      const today = addDays(startDate, t);
      const sellable = (batchesByProduct.get(p.id) ?? [])
        .filter((bt) => bt.expiry_date > today && (stockByBatch.get(bt.id) ?? 0) > 0)
        .sort((x, y) => x.expiry_date.localeCompare(y.expiry_date));
      let left = demandPath[t];
      let sold = 0;
      for (const bt of sellable) {
        if (left <= 0) break;
        const take = Math.min(left, stockByBatch.get(bt.id)!);
        stockByBatch.set(bt.id, stockByBatch.get(bt.id)! - take);
        left -= take;
        sold += take;
      }
      salesHistory.push({ product_id: p.id, sale_date: today, units_sold: sold, data_source: DATA_SOURCE });
      soldHistory.push(sold);
      // 3. Review days: the owner's rule of thumb — if stock + on order covers less than lead + this SKU's
      //    trigger days of recent sales, order up to its top-up level. Busy days mean ~10% of reviews are missed.
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
      if (!reviewDays.has(dow) || rng.chance(0.1)) continue;
      const recent = soldHistory.slice(-14);
      const avg = recent.length >= 7 ? recent.reduce((n, v) => n + v, 0) / recent.length : base;
      if (avg <= 0) continue;
      const onHand = sellable.reduce((n, bt) => n + (stockByBatch.get(bt.id) ?? 0), 0);
      const onOrder = myOrders.filter((o) => !o.cancelled && o.arrivalDay > t).reduce((n, o) => n + o.qty, 0);
      const lead = usual.lead_time_days;
      if (onHand + onOrder >= avg * (lead + triggerDays)) continue;
      const qty = Math.min(usual.available_qty, orderUp(avg * (lead + topUpDays) - onHand - onOrder));
      if (qty <= 0) continue;
      const delay = rng.chance(lateChance) ? rng.int(1, 3) : 0;
      // Now and then an order is cancelled straight away (out of stock at the distributor); the next review re-orders.
      const order = { productId: p.id, offer: usual, qty, orderDay: t, expectedDay: t + lead, arrivalDay: t + lead + delay, cancelled: rng.chance(0.01) };
      myOrders.push(order);
      orders.push(order);
    }
    const onHandEnd = (batchesByProduct.get(p.id) ?? []).filter((bt) => bt.expiry_date > asOf).reduce((n, bt) => n + (stockByBatch.get(bt.id) ?? 0), 0);
    coverDaysBySku[p.sku] = base > 0 ? Math.round((onHandEnd / base) * 10) / 10 : 0;
  }

  // Keep the batches that still hold stock, plus each SKU's latest receipt (so every SKU has a batch on record).
  const keep = new Set<string>();
  for (const p of products) {
    const list = batchesByProduct.get(p.id) ?? [];
    for (const bt of list) if ((stockByBatch.get(bt.id) ?? 0) > 0) keep.add(bt.id);
    const latest = [...list].sort((x, y) => y.received_date.localeCompare(x.received_date))[0];
    if (latest) keep.add(latest.id);
  }
  for (let i = batches.length - 1; i >= 0; i--) if (!keep.has(batches[i].id)) batches.splice(i, 1);
  for (const [pid, list] of batchesByProduct) batchesByProduct.set(pid, list.filter((bt) => keep.has(bt.id)));

  // Quality and expiry exceptions: 3 lots received in the last few days still in quarantine (awaiting QC),
  // 1 recalled lot, and 2 lots that expired on the shelf.
  const withStock = batches.filter((bt) => (stockByBatch.get(bt.id) ?? 0) > 0 && bt.expiry_date > asOf);
  const fresh = rng.shuffle(withStock.filter((bt) => daysBetweenIso(bt.received_date, asOf) <= 3));
  const older = rng.shuffle(withStock.filter((bt) => daysBetweenIso(bt.received_date, asOf) > 3));
  fresh.slice(0, 3).forEach((bt) => (bt.quality_status = "quarantine"));
  if (older[0]) older[0].quality_status = "recalled";
  for (const bt of older.slice(1, 3)) {
    bt.expiry_date = addDays(asOf, -rng.int(5, 40));
    if (bt.received_date >= bt.expiry_date) bt.received_date = addDays(bt.expiry_date, -rng.int(300, 500));
  }

  // ---- Inventory balances: what the simulation left, in bins of the matching storage class ----
  const binFill = new Map<string, number>();
  const binsByClass = new Map<StorageClass, LocationRow[]>();
  for (const bn of inventoryLocations) {
    if (bn.status !== "active") continue;
    binsByClass.set(bn.storage_class, [...(binsByClass.get(bn.storage_class) ?? []), bn]);
  }
  const inventoryBalances: BalanceRow[] = [];

  const placeInBin = (storage: StorageClass, qty: number): { bin: LocationRow; qty: number } | null => {
    const bins = binsByClass.get(storage) ?? [];
    const fits = bins.filter((bn) => bn.capacity_units - (binFill.get(bn.id) ?? 0) >= qty);
    const bin = fits.length
      ? rng.pick(fits)
      : bins.reduce<LocationRow | null>((best, bn) => {
          const free = bn.capacity_units - (binFill.get(bn.id) ?? 0);
          return !best || free > best.capacity_units - (binFill.get(best.id) ?? 0) ? bn : best;
        }, null);
    if (!bin) return null;
    const placed = Math.min(qty, bin.capacity_units - (binFill.get(bin.id) ?? 0));
    if (placed <= 0) return null;
    binFill.set(bin.id, (binFill.get(bin.id) ?? 0) + placed);
    return { bin, qty: placed };
  };

  for (const bt of batches) {
    const packs = stockByBatch.get(bt.id) ?? 0;
    if (packs <= 0) continue;
    const product = products.find((x) => x.id === bt.product_id)!;
    const parts = packs >= 40 && rng.chance(0.3) ? [Math.ceil(packs / 2), Math.floor(packs / 2)] : [packs];
    for (const part of parts) {
      const placed = placeInBin(product.storage_class, part);
      if (!placed) continue;
      const existing = inventoryBalances.find((r) => r.batch_id === bt.id && r.location_id === placed.bin.id);
      if (existing) {
        existing.on_hand_qty += placed.qty;
        continue;
      }
      inventoryBalances.push({
        id: rng.uuid(),
        product_id: bt.product_id,
        batch_id: bt.id,
        location_id: placed.bin.id,
        on_hand_qty: placed.qty,
        // Packs held for customer orders not yet dispatched (0–10%).
        reserved_qty: bt.quality_status === "released" ? Math.floor(placed.qty * rng.float(0, 0.1)) : 0,
        data_source: DATA_SOURCE,
      });
    }
  }
  // 3 unmapped balances: stock received but not yet put away in a bin.
  const unmappedCandidates = rng.shuffle(
    inventoryBalances.filter((bl, i, all) => all.findIndex((x) => x.batch_id === bl.batch_id) === i),
  );
  for (const bal of unmappedCandidates.slice(0, 3)) {
    if (bal.location_id) binFill.set(bal.location_id, (binFill.get(bal.location_id) ?? 0) - bal.on_hand_qty);
    bal.location_id = null;
  }

  // ---- Purchase orders from the simulation: one per supplier per order day ----
  // Still on the way at asOf → 'open' (some overdue: the supplier is late); arrived in the last 21 days →
  // 'received'; cancelled in the last 21 days → 'cancelled'. Older history is not kept.
  const purchaseOrders: PurchaseOrderRow[] = [];
  const purchaseOrderLines: PurchaseOrderLineRow[] = [];
  const asOfDay = SALES_DAYS - 1;
  const relevant = orders.filter((o) => (o.cancelled ? o.orderDay >= asOfDay - 21 : o.arrivalDay > asOfDay || o.arrivalDay >= asOfDay - 21));
  const groups = new Map<string, SimOrder[]>();
  for (const o of relevant) {
    const state = o.cancelled ? "cancelled" : o.arrivalDay > asOfDay ? "open" : "received";
    const key = `${o.orderDay}|${o.offer.supplier_id}|${state}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const groupList = [...groups.entries()].sort((x, y) => Number(x[0].split("|")[0]) - Number(y[0].split("|")[0]) || x[0].localeCompare(y[0]));
  groupList.forEach(([key, list], i) => {
    const [, supplierId, state] = key.split("|");
    const status = state as PurchaseOrderRow["status"];
    const poId = rng.uuid();
    let subtotal = dec(0);
    let tax = dec(0);
    let freight = dec(0);
    for (const o of list) {
      const amounts = lineAmounts(o.qty, o.offer.unit_price, o.offer.tax_rate, o.offer.freight_per_pack);
      subtotal = subtotal.plus(amounts.subtotal);
      tax = tax.plus(amounts.tax);
      freight = freight.plus(amounts.freight);
      purchaseOrderLines.push({
        id: rng.uuid(),
        po_id: poId,
        product_id: o.productId,
        supplier_offer_id: o.offer.id,
        recommendation_id: null,
        quantity_packs: o.qty,
        free_qty: 0,
        unit_price: o.offer.unit_price,
        tax_rate: o.offer.tax_rate,
        line_subtotal: amounts.subtotal.toFixed(2),
        line_tax: amounts.tax.toFixed(2),
        line_freight: amounts.freight.toFixed(2),
        line_total: amounts.total.toFixed(2),
      });
    }
    const first = list[0];
    purchaseOrders.push({
      id: poId,
      po_number: `EXT-${String(i + 1).padStart(4, "0")}`,
      supplier_id: supplierId,
      status,
      subtotal: subtotal.toFixed(2),
      tax_total: tax.toFixed(2),
      freight_total: freight.toFixed(2),
      grand_total: subtotal.plus(tax).plus(freight).toFixed(2),
      // Open POs show the date the supplier promised; late ones are already past it.
      expected_delivery_date: addDays(startDate, status === "received" ? first.arrivalDay : first.expectedDay),
      source_plan_id: null,
      idempotency_key: null,
      approved_by: null,
      approved_at: null,
      created_at: at10Utc(addDays(startDate, first.orderDay)),
      data_source: DATA_SOURCE,
    });
  });
  return {
    products,
    suppliers,
    supplierOffers,
    salesHistory,
    inventoryLocations,
    batches,
    inventoryBalances,
    purchaseOrders,
    purchaseOrderLines,
    meta: {
      asOf,
      seed,
      demandBySku,
      coverDaysBySku,
      trueDemand: Object.fromEntries(demandUnits),
      profileUsed: { catalogue: !!(formShare || priceQ || categoryShare), sales: !!(demandQ || expiryQ) },
    },
  };
}
