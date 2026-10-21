// Phase D1: learn aggregate patterns from the reference datasets.
//   npm run profile
// Reads data/reference/sources.json, writes data/reference/profile.json.
// profile.json holds ONLY statistics (shares, counts, quantiles): never a name,
// ID or individual row (implementationplan.md §5.4).
import { parse } from "csv-parse/sync";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CATEGORIES, PTR_FROM_LISTED_FACTOR, categoryFromComposition } from "./catalog";

const REF_DIR = path.resolve(process.cwd(), "data/reference");
const SOURCES_FILE = path.join(REF_DIR, "sources.json");
const PROFILE_FILE = path.join(REF_DIR, "profile.json");

type Source = {
  id: string;
  file: string;
  source_type: string;
  retrieved_at: string;
  columns: Record<string, string>;
};
type Row = Record<string, string>;

type Form = "tablet" | "capsule" | "syrup" | "injection" | "ointment" | "drops" | "other";

// ---------------------------------------------------------------------------
// Small statistics helpers (plain numbers: this is profiling, not engine money)
// ---------------------------------------------------------------------------

function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Linear-interpolated quantile (type 7) of a sorted array. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function quantiles(values: number[], qs: number[], dp: number): Record<string, number> | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const out: Record<string, number> = {};
  for (const q of qs) out[`p${Math.round(q * 100)}`] = round(quantile(sorted, q), dp);
  return out;
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function shares<K extends string>(counts: Map<K, number>, total: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) out[k] = round(v / total, 4);
  return out;
}

function inc<K>(m: Map<K, number>, k: K, by = 1) {
  m.set(k, (m.get(k) ?? 0) + by);
}

function utcDay(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Catalogue profile
// ---------------------------------------------------------------------------

/** Dosage form from a pack label like "strip of 10 tablets" or "bottle of 100 ml Syrup". */
function formFromPackLabel(label: string): Form {
  const l = label.toLowerCase();
  if (/\bdrops?\b/.test(l)) return "drops";
  if (/injection|infusion/.test(l)) return "injection";
  if (/tablet/.test(l)) return "tablet";
  if (/capsule/.test(l)) return "capsule";
  if (/cream|ointment|\bgel\b|lotion/.test(l)) return "ointment";
  if (/syrup|suspension|solution|liquid|elixir/.test(l)) return "syrup";
  return "other";
}

/** "strip of 10 tablets" → { pattern: "strip of N tablets", quantity: 10 }. */
function packPattern(label: string): { pattern: string; quantity: number | null } {
  const l = label.toLowerCase().replace(/\s+/g, " ").trim();
  const m = l.match(/(\d+(?:\.\d+)?)/);
  return { pattern: l.replace(/\d+(?:\.\d+)?/g, "N"), quantity: m ? Number(m[1]) : null };
}

function profileCatalogue(rows: Row[], c: Record<string, string>) {
  const formCounts = new Map<Form, number>();
  const patternCounts = new Map<string, number>();
  const packQtyByForm = new Map<Form, Map<number, number>>();
  const categoryCounts = new Map<string, number>();
  const ptrByCategory = new Map<string, number[]>();
  const manufacturersByCategory = new Map<string, Set<string>>();
  let single = 0;
  let combination = 0;
  let priceExcluded = 0;

  for (const r of rows) {
    const label = r[c.pack] ?? "";
    const form = formFromPackLabel(label);
    inc(formCounts, form);
    const { pattern, quantity } = packPattern(label);
    inc(patternCounts, pattern);
    if (quantity != null && Number.isInteger(quantity) && quantity > 0) {
      const m = packQtyByForm.get(form) ?? new Map<number, number>();
      inc(m, quantity);
      packQtyByForm.set(form, m);
    }

    const comp1 = r[c.composition] ?? "";
    const comp2 = c.composition2 ? (r[c.composition2] ?? "") : "";
    if (comp2.trim()) combination++;
    else single++;

    const category = categoryFromComposition(comp1, comp2);
    inc(categoryCounts, category);

    // Manufacturer names are used only to COUNT distinct makers per category; never written.
    const maker = (r[c.manufacturer] ?? "").trim().toLowerCase();
    if (maker) {
      const set = manufacturersByCategory.get(category) ?? new Set<string>();
      set.add(maker);
      manufacturersByCategory.set(category, set);
    }

    const listed = toNumber(r[c.price]);
    const discontinued = (r[c.discontinued] ?? "").trim().toUpperCase() === "TRUE";
    if (listed == null || listed <= 0 || discontinued) {
      priceExcluded++;
      continue;
    }
    const list = ptrByCategory.get(category) ?? [];
    list.push(listed * PTR_FROM_LISTED_FACTOR);
    ptrByCategory.set(category, list);
  }

  const total = rows.length;
  const matched = total - (categoryCounts.get("other") ?? 0);
  const topPatterns = [...patternCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
  const packQuantityShareByForm: Record<string, Record<string, number>> = {};
  for (const [form, m] of packQtyByForm) {
    const formTotal = [...m.values()].reduce((a, b) => a + b, 0);
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    packQuantityShareByForm[form] = Object.fromEntries(top.map(([q, n]) => [String(q), round(n / formTotal, 4)]));
  }
  const priceQuantilesByCategory: Record<string, Record<string, number> | null> = {};
  for (const cat of [...CATEGORIES, "other"]) {
    priceQuantilesByCategory[cat] = quantiles(ptrByCategory.get(cat) ?? [], [0.1, 0.5, 0.9], 2);
  }
  const allPtr = [...ptrByCategory.values()].flat();

  return {
    rowsRead: total,
    dosageFormShare: shares(formCounts, total),
    packSizePatterns: Object.fromEntries(topPatterns.map(([p, n]) => [p, round(n / total, 4)])),
    packQuantityShareByForm,
    categoryShare: shares(categoryCounts, total),
    categoryMatch: { matchedShare: round(matched / total, 4), otherShare: round(1 - matched / total, 4) },
    priceQuantilesByCategory,
    priceQuantilesOverall: quantiles(allPtr, [0.1, 0.25, 0.5, 0.75, 0.9], 2),
    priceRowsExcluded: priceExcluded,
    manufacturersPerCategory: Object.fromEntries(
      [...CATEGORIES, "other"].map((cat) => [cat, manufacturersByCategory.get(cat)?.size ?? 0]),
    ),
    compositionCountShare: { single: round(single / total, 4), combination: round(combination / total, 4) },
  };
}

// ---------------------------------------------------------------------------
// Sales sample profile
// ---------------------------------------------------------------------------

function profileSales(rows: Row[], c: Record<string, string>) {
  const qtyByDrugDay = new Map<string, Map<number, number>>(); // drug key → day → qty
  const expiryDays: number[] = [];
  let expired = 0;
  let minDay = Infinity;
  let maxDay = -Infinity;

  for (const r of rows) {
    const date = (r[c.date] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const day = utcDay(date);
    minDay = Math.min(minDay, day);
    maxDay = Math.max(maxDay, day);
    const qty = toNumber(r[c.quantity]);
    // Drug names only group rows; they are never written to the profile.
    const drug = (r[c.drug] ?? "").trim().toLowerCase();
    if (qty != null && qty >= 0 && drug) {
      const m = qtyByDrugDay.get(drug) ?? new Map<number, number>();
      inc(m, day, qty);
      qtyByDrugDay.set(drug, m);
    }
    const left = toNumber(r[c.expiry_days_left]);
    if (left != null) expiryDays.push(left);
    if ((r[c.expired_flag] ?? "").trim().toLowerCase() === "yes") expired++;
  }

  const spanDays = Number.isFinite(minDay) ? maxDay - minDay + 1 : 0;
  const dailyQty: number[] = [];
  const zeroShares: number[] = [];
  for (const m of qtyByDrugDay.values()) {
    dailyQty.push(...m.values());
    zeroShares.push(spanDays > 0 ? 1 - m.size / spanDays : 0);
  }

  return {
    rowsRead: rows.length,
    spanDays,
    drugsCount: qtyByDrugDay.size,
    quantityUnit: "unknown (source does not say whether quantity is packs or units)",
    dailyDemandQuantiles: quantiles(dailyQty, [0.1, 0.25, 0.5, 0.75, 0.9], 1),
    zeroDayShare: zeroShares.length ? round(zeroShares.reduce((a, b) => a + b, 0) / zeroShares.length, 4) : null,
    expiryDaysLeftQuantiles: quantiles(expiryDays, [0.1, 0.25, 0.5, 0.75, 0.9], 0),
    expiredShare: rows.length ? round(expired / rows.length, 4) : null,
  };
}

// ---------------------------------------------------------------------------

function readSource(src: Source): Row[] | null {
  const file = path.join(REF_DIR, src.file);
  if (!existsSync(file)) return null;
  return parse(readFileSync(file), { columns: true, trim: true, skip_empty_lines: true, bom: true }) as Row[];
}

async function main() {
  const sources = JSON.parse(readFileSync(SOURCES_FILE, "utf8")) as Source[];
  const byId = new Map(sources.map((s) => [s.id, s]));

  const catalogueSrc = byId.get("indian_pharmacy_catalogue");
  const salesSrc = byId.get("pharma_sales_github");
  const catalogueRows = catalogueSrc ? readSource(catalogueSrc) : null;
  const salesRows = salesSrc ? readSource(salesSrc) : null;

  const catalogue = catalogueRows && catalogueSrc ? profileCatalogue(catalogueRows, catalogueSrc.columns) : null;
  const sales = salesRows && salesSrc ? profileSales(salesRows, salesSrc.columns) : null;
  const missing = { missing: true } as const;

  const profile = {
    note: "Aggregate statistics only. No names, IDs or rows from any reference file.",
    sources: sources.map((s) => ({
      id: s.id,
      source_type: s.source_type,
      retrieved_at: s.retrieved_at,
      present: s.id === "indian_pharmacy_catalogue" ? !!catalogueRows : s.id === "pharma_sales_github" ? !!salesRows : false,
    })),
    assumptions: {
      ptrFromListedFactor: PTR_FROM_LISTED_FACTOR,
      ptrNote: "PTR estimate = catalogue listed price x factor (approximate 20% retailer margin). Not a supplier quote.",
      categoryNote: "Category derived from composition with CATEGORY_KEYWORDS (scripts/seed/catalog.ts); unmatched = other.",
      formNote: "Dosage form derived from pack_size_label.",
    },
    // From the catalogue
    dosageFormShare: catalogue?.dosageFormShare ?? missing,
    packSizePatterns: catalogue?.packSizePatterns ?? missing,
    packQuantityShareByForm: catalogue?.packQuantityShareByForm ?? missing,
    categoryShare: catalogue?.categoryShare ?? missing,
    categoryMatch: catalogue?.categoryMatch ?? missing,
    priceQuantilesByCategory: catalogue?.priceQuantilesByCategory ?? missing,
    priceQuantilesOverall: catalogue?.priceQuantilesOverall ?? missing,
    manufacturersPerCategory: catalogue?.manufacturersPerCategory ?? missing,
    compositionCountShare: catalogue?.compositionCountShare ?? missing,
    // From the sales sample
    dailyDemandQuantiles: sales?.dailyDemandQuantiles ?? missing,
    zeroDayShare: sales?.zeroDayShare ?? missing,
    salesSampleMeta: sales ? { spanDays: sales.spanDays, drugsCount: sales.drugsCount, quantityUnit: sales.quantityUnit } : missing,
    expiryDaysLeftQuantiles: sales?.expiryDaysLeftQuantiles ?? missing,
    expiredShare: sales?.expiredShare ?? missing,
    // From Kaggle (not downloaded: needs a login)
    weekdayFactors: missing,
    monthlyFactors: missing,
    rowsRead: { catalogue: catalogue?.rowsRead ?? 0, sales: sales?.rowsRead ?? 0 },
    priceRowsExcluded: catalogue?.priceRowsExcluded ?? 0,
  };

  writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), PROFILE_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
