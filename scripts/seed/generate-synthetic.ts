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
/** Demo capacity proxy per bin, in packs (sized so 500 SKUs fit in 240 bins). */
const BIN_CAPACITY = { min: 250, max: 1000 };
const MEDIAN_PACKS_PER_DAY = 4;
const MIN_PACKS_PER_DAY = 0.5;
const MAX_PACKS_PER_DAY = 30;
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
  const supplierNames = new Set<string>();
  const statuses: SupplierRow["approved_status"][] = ["approved", "approved", "approved", "approved", "approved", "approved", "pending", "blocked"];
  const suppliers: SupplierRow[] = statuses.map((status, i) => ({
    id: rng.uuid(),
    name: pickName(rng, () => `${rng.pick(SUPPLIER_PARTS.first)} ${rng.pick(SUPPLIER_PARTS.last)}`, supplierNames, forbidden),
    supplier_code: `SUP-${String(i + 1).padStart(2, "0")}`,
    approved_status: status,
    default_lead_time_days: rng.int(1, 10),
    reliability_score: i === 5 ? null : rng.float(60, 98).toFixed(2),
    payment_terms_days: rng.pick([15, 21, 30, 45, 60]),
    data_source: DATA_SOURCE,
  }));
  const approvedSuppliers = suppliers.filter((s) => s.approved_status === "approved");

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

    let genericName: string;
    let strength: string;
    let allowedForms: readonly Form[];
    if (isCombo) {
      const [primary, partner, partnerStrength, forms] = rng.pick(COMBINATIONS[category]);
      const base = GENERICS[category].find((g) => g.name === primary);
      // Prefer a solid-dose strength ("500mg") over a liquid one ("125mg/5ml") for the primary.
      const solid = base?.strengths.filter((s) => !s.includes("/")) ?? [];
      const primaryStrength = base ? rng.pick(solid.length ? solid : base.strengths) : "";
      genericName = `${primary} + ${partner}`;
      strength = primaryStrength ? `${primaryStrength} + ${partnerStrength}` : partnerStrength;
      allowedForms = forms;
    } else {
      const g = rng.pick(GENERICS[category]);
      genericName = g.name;
      strength = rng.pick(g.strengths);
      allowedForms = g.forms;
    }
    const form = rng.weighted(allowedForms.map((f) => [f, formShare?.[f] ?? 1 / FORMS.length] as const));

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

  // ---- Supplier offers (1–3 per SKU; the first is always from an approved supplier) ----
  const supplierOffers: OfferRow[] = [];
  for (const p of products) {
    const count = rng.weighted([[1, 0.3], [2, 0.4], [3, 0.3]] as const);
    const chosen = [rng.pick(approvedSuppliers)];
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
        unit_price: roundUnit(dec(p.ptr).times(rng.float(0.78, 0.9))).toFixed(4),
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

  // ---- Sales history (90 days ending on asOf, zero days included) ----
  const zeroShare = typeof zeroShareProfile === "number" ? clamp(zeroShareProfile, 0, 0.9) : DEFAULT_ZERO_DAY_SHARE;
  const demandRatio = demandQ
    ? Object.fromEntries(Object.entries(demandQ).map(([k, v]) => [k, v / (demandQ.p50 || 1)]))
    : DEFAULT_DEMAND_RATIO;
  const salesHistory: SalesRow[] = [];
  const demandBySku: SyntheticDataset["meta"]["demandBySku"] = {};
  for (const p of products) {
    const kind = rng.weighted([["stable", 0.4], ["intermittent", 0.2], ["growing", 0.15], ["declining", 0.15], ["spike", 0.1]] as const);
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
      let units: number;
      if (kind === "intermittent") units = rng.chance(zeroShare) ? 0 : rng.poisson(lambda / (1 - zeroShare));
      else units = rng.poisson(lambda);
      salesHistory.push({ product_id: p.id, sale_date: date, units_sold: units, data_source: DATA_SOURCE });
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

  // ---- Batches (1–3 per SKU) ----
  const shortShare = expiryQ
    ? Math.min(shareBelow(expiryQ, RISK_WINDOW_DAYS) ?? DEFAULT_SHORT_DATED, SHORT_DATED_CAP)
    : DEFAULT_SHORT_DATED;
  const batches: BatchRow[] = [];
  const batchesByProduct = new Map<string, BatchRow[]>();
  for (const p of products) {
    const n = rng.int(1, 3);
    const offers = offersByProduct.get(p.id) ?? [];
    const costOffer = offers[0];
    const numbers = new Set<string>();
    const list: BatchRow[] = [];
    for (let k = 0; k < n; k++) {
      let batchNumber: string;
      do batchNumber = `B${faker.string.alphanumeric({ length: 6, casing: "upper" })}`;
      while (numbers.has(batchNumber));
      numbers.add(batchNumber);
      const expiryDays = rng.chance(shortShare) ? rng.int(60, 150) : rng.int(151, 900);
      const received = addDays(asOf, -rng.int(10, 300));
      const row: BatchRow = {
        id: rng.uuid(),
        product_id: p.id,
        batch_number: batchNumber,
        expiry_date: addDays(asOf, expiryDays),
        received_date: received,
        supplier_id: costOffer.supplier_id,
        unit_cost: roundUnit(dec(costOffer.unit_price).times(rng.float(0.97, 1.03))).toFixed(4),
        quality_status: "released",
        return_policy_status: rng.weighted([["returnable", 0.4], ["non_returnable", 0.3], ["unknown", 0.3]] as const),
        data_source: DATA_SOURCE,
      };
      list.push(row);
      batches.push(row);
    }
    batchesByProduct.set(p.id, list);
  }
  // Quality and expiry exceptions: 3 quarantine, 1 recalled, 2 already expired.
  const exceptionPool = rng.shuffle(batches);
  exceptionPool.slice(0, 3).forEach((b) => (b.quality_status = "quarantine"));
  exceptionPool[3].quality_status = "recalled";
  for (const b of exceptionPool.slice(4, 6)) {
    b.expiry_date = addDays(asOf, -rng.int(5, 40));
    b.received_date = addDays(b.expiry_date, -rng.int(400, 700));
  }

  // ---- Inventory balances (cover 0–90 days, matching storage class, within bin capacity) ----
  const binFill = new Map<string, number>();
  const binsByClass = new Map<StorageClass, LocationRow[]>();
  for (const b of inventoryLocations) {
    if (b.status !== "active") continue;
    binsByClass.set(b.storage_class, [...(binsByClass.get(b.storage_class) ?? []), b]);
  }
  const inventoryBalances: BalanceRow[] = [];
  const coverDaysBySku: Record<string, number> = {};

  const placeInBin = (storage: StorageClass, qty: number): { bin: LocationRow; qty: number } | null => {
    const bins = binsByClass.get(storage) ?? [];
    const fits = bins.filter((b) => b.capacity_units - (binFill.get(b.id) ?? 0) >= qty);
    const bin = fits.length
      ? rng.pick(fits)
      : bins.reduce<LocationRow | null>((best, b) => {
          const free = b.capacity_units - (binFill.get(b.id) ?? 0);
          return !best || free > best.capacity_units - (binFill.get(best.id) ?? 0) ? b : best;
        }, null);
    if (!bin) return null;
    const placed = Math.min(qty, bin.capacity_units - (binFill.get(bin.id) ?? 0));
    if (placed <= 0) return null;
    binFill.set(bin.id, (binFill.get(bin.id) ?? 0) + placed);
    return { bin, qty: placed };
  };

  for (const p of products) {
    const cover = rng.int(0, 90);
    coverDaysBySku[p.sku] = cover;
    const totalPacks = Math.round(demandBySku[p.sku].basePacksPerDay * cover);
    const list = batchesByProduct.get(p.id) ?? [];
    if (totalPacks <= 0 || list.length === 0) continue;
    // Older (earlier-expiry) batches hold less stock.
    const ordered = [...list].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
    const weights = ordered.map((_, idx) => idx + 1);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    let remaining = totalPacks;
    ordered.forEach((batch, idx) => {
      const share = idx === ordered.length - 1 ? remaining : Math.round((totalPacks * weights[idx]) / weightSum);
      remaining -= share;
      if (share <= 0) return;
      const parts = share >= 40 && rng.chance(0.3) ? [Math.ceil(share / 2), Math.floor(share / 2)] : [share];
      const usedBins = new Set<string>();
      for (const part of parts) {
        const placed = placeInBin(p.storage_class, part);
        if (!placed) continue;
        const existing = usedBins.has(placed.bin.id)
          ? inventoryBalances.find((r) => r.batch_id === batch.id && r.location_id === placed.bin.id)
          : undefined;
        if (existing) {
          existing.on_hand_qty += placed.qty;
          existing.reserved_qty = Math.min(existing.reserved_qty, existing.on_hand_qty);
          continue;
        }
        usedBins.add(placed.bin.id);
        inventoryBalances.push({
          id: rng.uuid(),
          product_id: p.id,
          batch_id: batch.id,
          location_id: placed.bin.id,
          on_hand_qty: placed.qty,
          reserved_qty: Math.floor(placed.qty * rng.float(0, 0.1)),
          data_source: DATA_SOURCE,
        });
      }
    });
  }
  // 3 unmapped balances: move whole balances of distinct batches out of their bins.
  const unmappedCandidates = rng.shuffle(
    inventoryBalances.filter((b, i, all) => all.findIndex((x) => x.batch_id === b.batch_id) === i),
  );
  for (const bal of unmappedCandidates.slice(0, 3)) {
    if (bal.location_id) binFill.set(bal.location_id, (binFill.get(bal.location_id) ?? 0) - bal.on_hand_qty);
    bal.location_id = null;
  }

  // ---- Purchase orders: 15 open, 1 received, 1 cancelled ----
  const offersBySupplier = new Map<string, OfferRow[]>();
  for (const o of supplierOffers) {
    const s = suppliers.find((x) => x.id === o.supplier_id);
    if (s?.approved_status !== "approved") continue;
    offersBySupplier.set(o.supplier_id, [...(offersBySupplier.get(o.supplier_id) ?? []), o]);
  }
  const poSuppliers = approvedSuppliers.filter((s) => (offersBySupplier.get(s.id)?.length ?? 0) > 0);
  const poStatuses: PurchaseOrderRow["status"][] = [...Array<"open">(15).fill("open"), "received", "cancelled"];
  const purchaseOrders: PurchaseOrderRow[] = [];
  const purchaseOrderLines: PurchaseOrderLineRow[] = [];
  poStatuses.forEach((status, i) => {
    const supplier = rng.pick(poSuppliers);
    const supplierOffersList = rng.shuffle(offersBySupplier.get(supplier.id) ?? []).slice(0, rng.int(1, 3));
    // Last 3 open POs arrive after the 14-day horizon (tests exclusion from incoming stock).
    const expected =
      status === "open" ? addDays(asOf, i >= 12 ? rng.int(15, 20) : rng.int(1, 14)) : status === "received" ? addDays(asOf, -3) : addDays(asOf, 5);
    const poId = rng.uuid();
    let subtotal = dec(0);
    let tax = dec(0);
    let freight = dec(0);
    for (const offer of supplierOffersList) {
      const qty = Math.max(offer.moq, offer.pack_multiple * rng.int(2, 20));
      const roundedQty = Math.ceil(qty / offer.pack_multiple) * offer.pack_multiple;
      const amounts = lineAmounts(roundedQty, offer.unit_price, offer.tax_rate, offer.freight_per_pack);
      subtotal = subtotal.plus(amounts.subtotal);
      tax = tax.plus(amounts.tax);
      freight = freight.plus(amounts.freight);
      purchaseOrderLines.push({
        id: rng.uuid(),
        po_id: poId,
        product_id: offer.product_id,
        supplier_offer_id: offer.id,
        recommendation_id: null,
        quantity_packs: roundedQty,
        free_qty: 0,
        unit_price: offer.unit_price,
        tax_rate: offer.tax_rate,
        line_subtotal: amounts.subtotal.toFixed(2),
        line_tax: amounts.tax.toFixed(2),
        line_freight: amounts.freight.toFixed(2),
        line_total: amounts.total.toFixed(2),
      });
    }
    purchaseOrders.push({
      id: poId,
      po_number: `EXT-${String(i + 1).padStart(4, "0")}`,
      supplier_id: supplier.id,
      status,
      subtotal: subtotal.toFixed(2),
      tax_total: tax.toFixed(2),
      freight_total: freight.toFixed(2),
      grand_total: subtotal.plus(tax).plus(freight).toFixed(2),
      expected_delivery_date: expected,
      source_plan_id: null,
      idempotency_key: null,
      approved_by: null,
      approved_at: null,
      created_at: at10Utc(addDays(asOf, -rng.int(1, 10))),
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
      profileUsed: { catalogue: !!(formShare || priceQ || categoryShare), sales: !!(demandQ || expiryQ) },
    },
  };
}
