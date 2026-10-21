// Put-away (implementationplan.md §6.13): where proposed stock would go. Pure and deterministic.
// Candidate bin: an active bin of the product's storage class with room for every proposed pack; prefer
// (1) a bin already holding the SKU, (2) the same aisle as the SKU's existing stock, (3) the lowest bin code.
// Nothing fits → CAPACITY_REVIEW: no location is invented. Unmapped stock (no bin) never counts as "existing stock".
import type { StorageClass } from "./types";

export type PutawayBin = {
  id: string;
  binCode: string;
  aisle: string;
  storageClass: StorageClass;
  capacityUnits: number;
  status: "active" | "inactive" | "blocked";
  /** Packs on hand in the bin now (Σ balances). */
  used: number;
  /** Products with stock in the bin now. */
  productIds: string[];
};

export type PutawayRequest = { productId: string; storageClass: StorageClass; packs: number };

export type PutawayResult =
  | { productId: string; packs: number; binId: string; binCode: string; preference: "same_bin" | "same_aisle" | "lowest_code" }
  | { productId: string; packs: number; binId: null; binCode: null; code: "CAPACITY_REVIEW" };

const free = (b: PutawayBin) => b.capacityUnits - b.used;

/** The candidate bin for one request, against bins as they are now. */
export function candidateBin(req: PutawayRequest, bins: PutawayBin[]): PutawayResult {
  const fits = bins
    .filter((b) => b.status === "active" && b.storageClass === req.storageClass && free(b) >= req.packs)
    .sort((a, b) => (a.binCode < b.binCode ? -1 : a.binCode > b.binCode ? 1 : 0));
  const holding = bins.filter((b) => b.productIds.includes(req.productId));
  const aisles = new Set(holding.map((b) => b.aisle));

  const same = fits.find((b) => b.productIds.includes(req.productId));
  if (same) return { productId: req.productId, packs: req.packs, binId: same.id, binCode: same.binCode, preference: "same_bin" };
  const aisle = fits.find((b) => aisles.has(b.aisle));
  if (aisle) return { productId: req.productId, packs: req.packs, binId: aisle.id, binCode: aisle.binCode, preference: "same_aisle" };
  const first = fits[0];
  if (first) return { productId: req.productId, packs: req.packs, binId: first.id, binCode: first.binCode, preference: "lowest_code" };
  return { productId: req.productId, packs: req.packs, binId: null, binCode: null, code: "CAPACITY_REVIEW" };
}

/**
 * Places several requests in the given order (plan rank), each one using the room the earlier ones left,
 * so two lines are never put into the same last free space. Requests with no packs are skipped.
 */
export function planPutaway(requests: PutawayRequest[], bins: PutawayBin[]): PutawayResult[] {
  const state = bins.map((b) => ({ ...b, productIds: [...b.productIds] }));
  const byId = new Map(state.map((b) => [b.id, b]));
  const out: PutawayResult[] = [];
  for (const req of requests) {
    if (req.packs <= 0) continue;
    const r = candidateBin(req, state);
    if (r.binId) {
      const bin = byId.get(r.binId)!;
      bin.used += req.packs;
      if (!bin.productIds.includes(req.productId)) bin.productIds.push(req.productId);
    }
    out.push(r);
  }
  return out;
}
