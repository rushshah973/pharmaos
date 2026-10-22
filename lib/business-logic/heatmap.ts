// Warehouse heatmap (implementationplan.md §6.13): one value and a severity 0–3 per bin, per mode.
// Pure: the SKU facts come from the same engine analysis as the plan (analyseSku), so a red bin and a
// STOCKOUT_RISK line can never disagree. Severity always ships with a text label (colour never carries meaning alone).
import type { PutawayResult } from "./putaway";
import type { SkuStatus, StorageClass } from "./types";

export const HEATMAP_MODES = ["stockout", "expiry", "excess", "normal", "proposed"] as const;
export type HeatmapMode = (typeof HEATMAP_MODES)[number];
export type Severity = 0 | 1 | 2 | 3;

export type HeatmapBin = {
  id: string;
  binCode: string;
  storageClass: StorageClass;
  capacityUnits: number;
  status: "active" | "inactive" | "blocked";
};

/** One balance row; `binId` null = unmapped stock, which is reported but never drawn in a bin. */
export type HeatmapBalance = { binId: string | null; productId: string; batchId: string; onHandQty: number };

/** What the engine said about one SKU. */
export type SkuHeatFacts = {
  productId: string;
  sku: string;
  status: SkuStatus;
  cover: number | null;
  stockPosition: number;
  targetStock: number;
  /** Released batches with their FEFO projection (atRiskQty summed over bins), plus expired ones. */
  batches: { batchId: string; daysToExpiry: number; atRiskQty: number; expired: boolean }[];
};

export type BinHeat = {
  binId: string;
  binCode: string;
  severity: Severity;
  /** Plain-text meaning of the colour, e.g. "Stockout risk · 0.5 d cover". */
  label: string;
  /** The mode's number: cover (d), days to expiry, stock ÷ target, fill %, or proposed packs. Null when not highlighted. */
  value: number | null;
  /** SKUs that caused the highlight (all SKUs in the bin for normal mode). */
  skus: string[];
};

export type HeatmapInput = {
  mode: HeatmapMode;
  bins: HeatmapBin[];
  balances: HeatmapBalance[];
  facts: Map<string, SkuHeatFacts>;
  /** Proposed mode only: the put-away result of the plan's counted lines. */
  placements?: PutawayResult[];
};

export type HeatmapResult = {
  mode: HeatmapMode;
  bins: BinHeat[];
  /** Stock with no bin, per SKU — shown as a list, never placed on the map. */
  unmapped: { productId: string; sku: string; packs: number }[];
  /** Stockout mode: stockout-risk SKUs with no stock in any bin (nothing on a shelf to colour), soonest first. */
  offShelf: { productId: string; sku: string; cover: number | null }[];
  /** Proposed mode: lines whose stock fits no bin. */
  capacityReview: { productId: string; sku: string; packs: number }[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function band(n: number, steps: [number, number, number]): Severity {
  return n >= steps[2] ? 3 : n >= steps[1] ? 2 : n >= steps[0] ? 1 : 0;
}

export function computeHeatmap({ mode, bins, balances, facts, placements = [] }: HeatmapInput): HeatmapResult {
  const inBin = new Map<string, HeatmapBalance[]>();
  const unmappedBy = new Map<string, number>();
  // A SKU's home bins, including ones that are empty now: an out-of-stock SKU still shows where it belongs.
  const homeBins = new Map<string, Set<string>>();
  for (const b of balances) if (b.binId !== null) (homeBins.get(b.binId) ?? homeBins.set(b.binId, new Set()).get(b.binId)!).add(b.productId);
  for (const b of balances) {
    if (b.onHandQty <= 0) continue;
    if (b.binId === null) {
      unmappedBy.set(b.productId, (unmappedBy.get(b.productId) ?? 0) + b.onHandQty);
      continue;
    }
    const list = inBin.get(b.binId);
    if (list) list.push(b);
    else inBin.set(b.binId, [b]);
  }
  // Batch totals across bins, to split a batch's at-risk packs over the bins that hold it.
  const batchTotal = new Map<string, number>();
  for (const b of balances) if (b.binId !== null) batchTotal.set(b.batchId, (batchTotal.get(b.batchId) ?? 0) + b.onHandQty);

  const placedBy = new Map<string, Extract<PutawayResult, { binId: string }>[]>();
  for (const p of placements) {
    if (!p.binId) continue;
    const list = placedBy.get(p.binId);
    if (list) list.push(p);
    else placedBy.set(p.binId, [p]);
  }

  const sku = (productId: string) => facts.get(productId)?.sku ?? productId;
  const out: BinHeat[] = bins.map((bin) => {
    const rows = inBin.get(bin.id) ?? [];
    const used = rows.reduce((n, r) => n + r.onHandQty, 0);
    const products = [...new Set(rows.map((r) => r.productId))];
    const base = { binId: bin.id, binCode: bin.binCode };
    if (bin.status !== "active") return { ...base, severity: 0, label: bin.status === "blocked" ? "Blocked" : "Inactive", value: null, skus: [] };

    switch (mode) {
      case "stockout": {
        const home = [...(homeBins.get(bin.id) ?? [])];
        const hit = home.map((p) => facts.get(p)).filter((f) => f?.status === "STOCKOUT_RISK") as SkuHeatFacts[];
        if (hit.length === 0) return { ...base, severity: 0, label: "No stockout risk", value: null, skus: [] };
        const cover = Math.min(...hit.map((f) => f.cover ?? 0));
        const severity: Severity = cover < 1 ? 3 : cover < 3 ? 2 : 1;
        const label = cover <= 0 ? "Out of stock now" : `Stockout risk · runs out in ${round1(cover)} d`;
        return { ...base, severity, label, value: round1(cover), skus: hit.map((f) => f.sku).sort() };
      }
      case "expiry": {
        let earliest = Infinity;
        let atRisk = 0;
        let expired = false;
        const hit = new Set<string>();
        for (const r of rows) {
          const batch = facts.get(r.productId)?.batches.find((b) => b.batchId === r.batchId);
          if (!batch || (!batch.expired && batch.atRiskQty <= 0)) continue;
          hit.add(sku(r.productId));
          earliest = Math.min(earliest, batch.daysToExpiry);
          if (batch.expired) {
            expired = true;
            atRisk += r.onHandQty;
          } else {
            atRisk += Math.round((batch.atRiskQty * r.onHandQty) / (batchTotal.get(r.batchId) || r.onHandQty));
          }
        }
        if (hit.size === 0) return { ...base, severity: 0, label: "Nothing at expiry risk", value: null, skus: [] };
        const severity: Severity = expired || earliest <= 30 ? 3 : earliest <= 90 ? 2 : 1;
        const label = expired ? `Expired stock · ${atRisk} packs` : `Expiry risk · ${atRisk} packs · expires in ${earliest} d`;
        return { ...base, severity, label, value: earliest, skus: [...hit].sort() };
      }
      case "excess": {
        const hit = products.map((p) => facts.get(p)).filter((f) => f?.status === "EXCESS") as SkuHeatFacts[];
        if (hit.length === 0) return { ...base, severity: 0, label: "No excess stock", value: null, skus: [] };
        const ratio = Math.max(...hit.map((f) => (f.targetStock > 0 ? f.stockPosition / f.targetStock : Infinity)));
        const shown = Number.isFinite(ratio) ? round1(ratio) : null;
        return {
          ...base,
          severity: Number.isFinite(ratio) ? (Math.max(1, band(ratio, [0, 2, 3])) as Severity) : 3,
          label: shown === null ? "Excess stock · no target" : `Excess stock · ${shown}× target`,
          value: shown,
          skus: hit.map((f) => f.sku).sort(),
        };
      }
      case "normal": {
        const fill = Math.round((used / bin.capacityUnits) * 100);
        const severity: Severity = used === 0 ? 0 : (Math.max(1, band(fill, [0, 70, 90])) as Severity);
        return { ...base, severity, label: used === 0 ? "Empty" : `${fill}% full · ${used} of ${bin.capacityUnits} packs`, value: fill, skus: products.map(sku).sort() };
      }
      case "proposed": {
        const placed = placedBy.get(bin.id) ?? [];
        if (placed.length === 0) return { ...base, severity: 0, label: "No proposed stock", value: null, skus: [] };
        const packs = placed.reduce((n, p) => n + p.packs, 0);
        const fill = Math.round(((used + packs) / bin.capacityUnits) * 100);
        return {
          ...base,
          severity: Math.max(1, band(fill, [0, 70, 90])) as Severity,
          label: `Proposed · ${packs} packs · ${fill}% full after put-away`,
          value: packs,
          skus: [...new Set(placed.map((p) => sku(p.productId)))].sort(),
        };
      }
    }
  });

  return {
    mode,
    bins: out,
    unmapped: [...unmappedBy].map(([productId, packs]) => ({ productId, sku: sku(productId), packs })).sort((a, b) => a.sku.localeCompare(b.sku)),
    offShelf:
      mode === "stockout"
        ? [...facts.values()]
            .filter((f) => f.status === "STOCKOUT_RISK" && ![...homeBins.values()].some((set) => set.has(f.productId)))
            .map((f) => ({ productId: f.productId, sku: f.sku, cover: f.cover }))
            .sort((a, b) => (a.cover ?? 0) - (b.cover ?? 0) || a.sku.localeCompare(b.sku))
        : [],
    capacityReview: mode === "proposed" ? placements.filter((p) => !p.binId).map((p) => ({ productId: p.productId, sku: sku(p.productId), packs: p.packs })) : [],
  };
}
