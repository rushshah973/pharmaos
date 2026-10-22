// Phase D2: force the guaranteed demo cases (implementationplan.md §5.6) into the
// generated rows, in place, and return which SKUs belong to which case.
// Every condition is checked with the real decision engine (lib/business-logic).
import { dec, roundUnit } from "@/lib/money";
import { addDays as engineAddDays, daysBetween as engineDaysBetween } from "@/lib/business-logic/dates";
import { computeDemand } from "@/lib/business-logic/demand";
import { analyseSku } from "@/lib/business-logic/engine";
import { reorderPoint, targetStock } from "@/lib/business-logic/inventory";
import { ENGINE_CONFIG } from "@/lib/business-logic/config";
import { effectiveUnitCost, offerExclusions } from "@/lib/business-logic/supplier-scoring";
import type { BalanceRow, BatchRow, LocationRow, OfferRow, SyntheticDataset } from "./generate-synthetic";
import { createRng, type Rng } from "./prng";
import { buildEngineIndex, skuContext, toOffer, type EngineIndex } from "./to-engine";

export type DemoCases = {
  stockout: string[];
  expiry: string[];
  excess: string[];
  priceAnomaly: string[];
  capacity: string[];
  cheapestTooSlow: string[];
  schemeSkip: string[];
  staleQuote: string[];
  unmapped: string[];
  spike: string[];
  noEligibleOffer: string[];
};

// ---------------------------------------------------------------------------
// Engine-backed helpers over the seed dataset
// ---------------------------------------------------------------------------

export const daysBetween = engineDaysBetween;
export const addDays = engineAddDays;
export const rop = (dbar: number, lead: number) => reorderPoint(dbar, lead);
export const target = (dbar: number, lead: number) => targetStock(dbar, lead);

export type Index = ReturnType<typeof buildIndex>;

export function buildIndex(data: SyntheticDataset) {
  const group = <T, K>(rows: T[], key: (r: T) => K) => {
    const m = new Map<K, T[]>();
    for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
    return m;
  };
  return {
    data,
    engine: buildEngineIndex(data) as EngineIndex,
    productById: new Map(data.products.map((p) => [p.id, p])),
    productBySku: new Map(data.products.map((p) => [p.sku, p])),
    supplierById: new Map(data.suppliers.map((s) => [s.id, s])),
    binById: new Map(data.inventoryLocations.map((b) => [b.id, b])),
    salesRowsByProduct: group(data.salesHistory, (s) => s.product_id),
    batchesByProduct: group(data.batches, (b) => b.product_id),
    balancesByBatch: group(data.inventoryBalances, (b) => b.batch_id),
    offersByProduct: group(data.supplierOffers, (o) => o.product_id),
  };
}

export function demand(idx: Index, productId: string, asOf: string) {
  const rows = idx.salesRowsByProduct.get(productId) ?? [];
  const first = rows.reduce<string | null>((m, s) => (m === null || s.sale_date < m ? s.sale_date : m), null);
  const d = computeDemand(rows.map((s) => ({ date: s.sale_date, units: s.units_sold })), asOf, first);
  return { d7: d.d7, d28: d.d28, dbar: d.avgDailyDemand };
}

export function isOfferEligible(idx: Index, o: OfferRow, asOf: string): boolean {
  const supplier = idx.engine.suppliers[o.supplier_id];
  return offerExclusions({ offer: toOffer(o), supplier, productId: o.product_id, asOf, qty: 0 }).length === 0;
}

export function eligibleOffers(idx: Index, productId: string, asOf: string): OfferRow[] {
  return (idx.offersByProduct.get(productId) ?? []).filter((o) => isOfferEligible(idx, o, asOf));
}

/** The engine's analysis of one SKU in the current (possibly mutated) dataset. */
export function analyse(data: SyntheticDataset, idx: Index, productId: string) {
  return analyseSku(skuContext(data, idx.engine, productId));
}

export function skuState(data: SyntheticDataset, idx: Index, productId: string, asOf: string) {
  const a = analyse(data, idx, productId);
  const batchById = new Map((idx.batchesByProduct.get(productId) ?? []).map((b) => [b.id, b]));
  return {
    product: idx.productById.get(productId)!,
    analysis: a,
    d7: a.demand.d7,
    d28: a.demand.d28,
    dbar: a.demand.avgDailyDemand,
    eligibleAvailable: a.expiry.eligibleAvailable,
    incoming: a.incomingQty,
    stockPosition: a.stockPosition,
    lFastest: a.leadFastest,
    cover: a.cover,
    status: a.status,
    atRisk: a.expiry.batches.filter((b) => b.atRiskQty > 0).map((b) => ({ batch: batchById.get(b.batchId)!, atRiskQty: b.atRiskQty })),
    offers: eligibleOffers(idx, productId, asOf),
  };
}

/** The engine's line for a SKU: whether it is a candidate, and the chosen offer, quantity and cost. */
export function estimateLine(data: SyntheticDataset, idx: Index, productId: string, asOf: string) {
  const state = skuState(data, idx, productId, asOf);
  const a = state.analysis;
  if (!a.candidate || !a.chosen || !a.totals) return { candidate: false as const, state };
  const offer = (idx.offersByProduct.get(productId) ?? []).find((o) => o.id === a.chosen!.offerId)!;
  return { candidate: true as const, state, offer, qty: a.qty, cost: Number(a.totals.lineTotal) };
}

/** Effective cost per pack without a scheme (price × (1 + GST) + freight), as the engine compares offers. */
export function effectiveCostApprox(o: OfferRow): number {
  return Number(
    effectiveUnitCost({
      unitPrice: o.unit_price,
      taxRate: o.tax_rate,
      freightPerPack: o.freight_per_pack,
      schemePaidQty: o.scheme_paid_qty,
      schemeFreeQty: o.scheme_free_qty,
      schemeTaken: false,
    }),
  );
}

export function binFill(data: SyntheticDataset): Map<string, number> {
  const fill = new Map<string, number>();
  for (const b of data.inventoryBalances) if (b.location_id) fill.set(b.location_id, (fill.get(b.location_id) ?? 0) + b.on_hand_qty);
  return fill;
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

export function injectDemoCases(data: SyntheticDataset, seed = 42): DemoCases {
  const asOf = data.meta.asOf;
  const rng: Rng = createRng(seed + 1);
  const used = new Set<string>(); // product ids already given a case
  let idx = buildIndex(data);
  const reindex = () => (idx = buildIndex(data));
  const sku = (pid: string) => idx.productById.get(pid)!.sku;
  const bySkuOrder = <T extends { sku: string }>(rows: T[]) => [...rows].sort((a, b) => a.sku.localeCompare(b.sku));

  const balancesOf = (pid: string) => (idx.batchesByProduct.get(pid) ?? []).flatMap((b) => idx.balancesByBatch.get(b.id) ?? []);
  const hasIncoming = (pid: string) => skuState(data, idx, pid, asOf).incoming > 0;

  /** Set eligible (released, unexpired) stock of a product to about `packs`, reserved 0. */
  const setEligibleStock = (pid: string, packs: number) => {
    const eligible = new Set(
      (idx.batchesByProduct.get(pid) ?? []).filter((b) => b.quality_status === "released" && b.expiry_date > asOf).map((b) => b.id),
    );
    const rows = balancesOf(pid).filter((b) => eligible.has(b.batch_id));
    const current = rows.reduce((s, b) => s + b.on_hand_qty, 0);
    let left = Math.max(0, Math.floor(packs));
    for (const [i, b] of rows.entries()) {
      const share = i === rows.length - 1 ? left : Math.min(left, Math.floor((b.on_hand_qty / Math.max(current, 1)) * packs));
      b.on_hand_qty = Math.min(b.on_hand_qty, share); // only ever reduces (bins stay within capacity)
      b.reserved_qty = 0;
      left -= b.on_hand_qty;
    }
  };

  /** Add packs to a batch, using free space in its existing bin or another matching bin. Returns packs added. */
  const addToBatch = (batch: BatchRow, packs: number): number => {
    const product = idx.productById.get(batch.product_id)!;
    const fill = binFill(data);
    const free = (bin: LocationRow) => bin.capacity_units - (fill.get(bin.id) ?? 0);
    const existing = (idx.balancesByBatch.get(batch.id) ?? []).filter((b) => b.location_id);
    let left = packs;
    for (const bal of existing) {
      const add = Math.min(left, free(idx.binById.get(bal.location_id!)!));
      if (add > 0) {
        bal.on_hand_qty += add;
        fill.set(bal.location_id!, (fill.get(bal.location_id!) ?? 0) + add);
        left -= add;
      }
    }
    const usedBins = new Set(existing.map((b) => b.location_id));
    const candidates = data.inventoryLocations
      .filter((b) => b.status === "active" && b.storage_class === product.storage_class && !usedBins.has(b.id))
      .sort((a, b) => free(b) - free(a));
    for (const bin of candidates) {
      if (left <= 0) break;
      const add = Math.min(left, free(bin));
      if (add <= 0) continue;
      const row: BalanceRow = {
        id: rng.uuid(),
        product_id: batch.product_id,
        batch_id: batch.id,
        location_id: bin.id,
        on_hand_qty: add,
        reserved_qty: 0,
        data_source: "synthetic_demo",
      };
      data.inventoryBalances.push(row);
      fill.set(bin.id, (fill.get(bin.id) ?? 0) + add);
      left -= add;
    }
    reindex();
    return packs - left;
  };

  const pickProducts = (filter: (pid: string) => boolean, n: number, order: "fast" | "slow" | "random" = "random") => {
    let pool = bySkuOrder(data.products).filter((p) => !used.has(p.id) && filter(p.id));
    if (order !== "random") {
      const d = new Map(pool.map((p) => [p.id, demand(idx, p.id, asOf).dbar]));
      pool = pool.sort((a, b) => (order === "fast" ? d.get(b.id)! - d.get(a.id)! : d.get(a.id)! - d.get(b.id)!));
      pool = rng.shuffle(pool.slice(0, Math.max(n * 3, n)));
    } else pool = rng.shuffle(pool);
    return pool.slice(0, n).map((p) => p.id);
  };

  const ambientOrCool = (pid: string) => idx.productById.get(pid)!.storage_class !== "cold_chain";

  // 0. Every SKU keeps at least one eligible offer (only case 1 below may have none):
  //    refresh the first approved offer of any SKU whose offers all ended up stale or expired.
  for (const p of data.products) {
    if (eligibleOffers(idx, p.id, asOf).length > 0) continue;
    const offer = (idx.offersByProduct.get(p.id) ?? []).find((o) => idx.supplierById.get(o.supplier_id)?.approved_status === "approved");
    if (!offer) continue;
    const quoted = addDays(asOf, -rng.int(1, 10));
    offer.quoted_at = `${quoted}T10:00:00.000Z`;
    offer.valid_until = `${addDays(asOf, rng.int(7, 21))}T10:00:00.000Z`;
  }
  reindex();
  // SKUs with unmapped stock stay out of the other cases, so they remain clean examples.
  for (const b of data.inventoryBalances) if (b.location_id === null) used.add(b.product_id);

  // 1. No eligible offer (1 SKU): every offer of one SKU has expired.
  // Must be a SKU that needs ordering (d̄ > 0, stock below ROP), so it shows on the plan with NO_ELIGIBLE_OFFER.
  const needsOrder = (pid: string) => {
    const s = skuState(data, idx, pid, asOf);
    return s.dbar > 0 && s.stockPosition < rop(s.dbar, s.lFastest);
  };
  const noEligible = pickProducts((pid) => ambientOrCool(pid) && !hasIncoming(pid) && needsOrder(pid), 1);
  for (const pid of noEligible) {
    used.add(pid);
    for (const o of idx.offersByProduct.get(pid) ?? []) {
      o.quoted_at = `${addDays(asOf, -12)}T10:00:00.000Z`;
      o.valid_until = `${addDays(asOf, -2)}T10:00:00.000Z`;
    }
  }
  reindex();

  // 2. Capacity (2 SKUs): the cold-chain room is full, so no bin can take their order.
  const cold = bySkuOrder(data.products.filter((p) => p.storage_class === "cold_chain"));
  const capacity = rng
    .shuffle(cold.filter((p) => eligibleOffers(idx, p.id, asOf).length > 0 && demand(idx, p.id, asOf).dbar > 0 && !hasIncoming(p.id)))
    .slice(0, 2)
    .map((p) => p.id);
  // Other cold-chain SKUs get healthy stock first (while there is still room), so only these 2 need an order.
  for (const p of cold) {
    if (capacity.includes(p.id)) continue;
    const s = skuState(data, idx, p.id, asOf);
    if (s.dbar === 0) continue;
    const need = Math.ceil(target(s.dbar, s.lFastest)) + 1 - s.stockPosition;
    const batch = (idx.batchesByProduct.get(p.id) ?? [])
      .filter((b) => b.quality_status === "released" && b.expiry_date > addDays(asOf, 400))
      .sort((a, b) => b.expiry_date.localeCompare(a.expiry_date))[0];
    if (need > 0 && batch) addToBatch(batch, need);
  }
  for (const pid of capacity) {
    used.add(pid);
    setEligibleStock(pid, 0);
  }
  reindex();
  const minQty = Math.min(...capacity.map((pid) => estimateLine(data, idx, pid, asOf)).map((e) => (e.candidate ? e.qty : 2)));
  const coldFill = binFill(data);
  const slack = Math.max(0, Math.min(5, minQty - 1));
  for (const bin of data.inventoryLocations.filter((b) => b.storage_class === "cold_chain" && b.status === "active")) {
    bin.capacity_units = Math.max((coldFill.get(bin.id) ?? 0) + slack, 1);
  }
  reindex();

  // 3. Cheapest supplier too slow (3) — on stockout SKUs — then the rest of the stockout cases (12 total).
  const fastWithTwoOffers = pickProducts(
    (pid) => ambientOrCool(pid) && !hasIncoming(pid) && eligibleOffers(idx, pid, asOf).length >= 2,
    3,
    "fast",
  );
  for (const pid of fastWithTwoOffers) {
    used.add(pid);
    // "Cheapest" means lowest effective cost (price + GST + freight), as the engine compares it.
    const offers = [...eligibleOffers(idx, pid, asOf)].sort((a, b) => effectiveCostApprox(a) - effectiveCostApprox(b));
    offers[0].lead_time_days = rng.int(6, 7); // the manufacturer-direct style channel
    // It must be ruled out for speed alone, so it can always supply the order.
    offers[0].available_qty = Math.max(offers[0].available_qty, 1000);
    // The faster (dearer) offers must be able to supply the whole order, or there is nothing to choose between.
    for (const o of offers.slice(1)) {
      o.lead_time_days = rng.int(1, 2);
      o.available_qty = Math.max(o.available_qty, 1000);
      // No free-goods scheme on the faster offers: a scheme can make one of them cheapest per pack, and then
      // nothing cheaper was skipped for speed.
      o.scheme_paid_qty = null;
      o.scheme_free_qty = null;
      // Keep the slow offer clearly cheapest (≥ 3% gap) after freight and GST.
      const floor = effectiveCostApprox(offers[0]) * 1.03;
      if (effectiveCostApprox(o) < floor) {
        const perPackBeforeFreight = (floor - Number(o.freight_per_pack)) / (1 + Number(o.tax_rate) / 100);
        o.unit_price = roundUnit(dec(perPackBeforeFreight).plus("0.01")).toFixed(4);
      }
    }
  }
  reindex();
  // Stockout risk on demo day is rare: the 3 fast SKUs above have a little stock left (less than their fastest
  // delivery covers) and 2 more are already empty. The rest of the catalogue is mostly healthy.
  const moreStockout = pickProducts((pid) => ambientOrCool(pid) && !hasIncoming(pid) && eligibleOffers(idx, pid, asOf).length > 0, 2, "fast");
  const stockout = [...fastWithTwoOffers, ...moreStockout];
  for (const pid of stockout) {
    used.add(pid);
    const s = skuState(data, idx, pid, asOf);
    setEligibleStock(pid, moreStockout.includes(pid) ? 0 : Math.floor(s.dbar * s.lFastest * 0.5));
  }
  reindex();

  // 4. Expiry-risk batches (≥ 8): slow movers with a large batch expiring in 95–150 days.
  const expiry: string[] = [];
  for (const pid of pickProducts((p) => ambientOrCool(p), 40, "slow")) {
    if (expiry.length >= 9) break;
    const s = skuState(data, idx, pid, asOf);
    const batch = (idx.batchesByProduct.get(pid) ?? [])
      .filter((b) => b.quality_status === "released" && b.expiry_date > asOf && (idx.balancesByBatch.get(b.id) ?? []).some((x) => x.location_id))
      .sort((a, b) => a.expiry_date.localeCompare(b.expiry_date))[0];
    if (!batch || s.dbar === 0) continue;
    const oldExpiry = batch.expiry_date;
    batch.expiry_date = addDays(asOf, rng.int(95, 150));
    const sellable = daysBetween(asOf, addDays(batch.expiry_date, -ENGINE_CONFIG.expiryRiskWindowDays));
    const available = (idx.balancesByBatch.get(batch.id) ?? []).reduce((t, b) => t + b.on_hand_qty - b.reserved_qty, 0);
    const wanted = Math.ceil(s.dbar * sellable) + rng.int(30, 80);
    if (available < wanted) addToBatch(batch, wanted - available);
    reindex();
    if (skuState(data, idx, pid, asOf).atRisk.some((r) => r.batch.id === batch.id)) {
      used.add(pid);
      expiry.push(pid);
    } else batch.expiry_date = oldExpiry;
  }
  reindex();

  // 5. Excess stock (≥ 5): slow movers pushed above 1.5 × target.
  const excess: string[] = [];
  for (const pid of pickProducts((p) => ambientOrCool(p), 30, "slow")) {
    if (excess.length >= 6) break;
    const s = skuState(data, idx, pid, asOf);
    if (s.dbar === 0) continue;
    const need = Math.floor(ENGINE_CONFIG.excessFactor * target(s.dbar, s.lFastest)) + rng.int(10, 30) - s.stockPosition;
    const batch = (idx.batchesByProduct.get(pid) ?? [])
      .filter((b) => b.quality_status === "released" && b.expiry_date > addDays(asOf, 500))
      .sort((a, b) => b.expiry_date.localeCompare(a.expiry_date))[0];
    if (!batch) continue;
    if (need > 0) addToBatch(batch, need);
    if (skuState(data, idx, pid, asOf).status === "EXCESS") {
      used.add(pid);
      excess.push(pid);
    }
  }

  // 6. Price anomaly (3): one eligible offer priced at 1.35 × the median of the SKU's other offers.
  const priceAnomaly = pickProducts((pid) => (idx.offersByProduct.get(pid) ?? []).length >= 3 && eligibleOffers(idx, pid, asOf).length >= 1, 3);
  for (const pid of priceAnomaly) {
    used.add(pid);
    const offers = idx.offersByProduct.get(pid)!;
    const target = eligibleOffers(idx, pid, asOf)[0];
    const others = offers.filter((o) => o.id !== target.id).map((o) => Number(o.unit_price)).sort((a, b) => a - b);
    const median = others.length % 2 ? others[(others.length - 1) / 2] : (others[others.length / 2 - 1] + others[others.length / 2]) / 2;
    target.unit_price = roundUnit(dec(median).times(1.35)).toFixed(4);
  }
  reindex();

  // 7. Scheme that should be skipped (2): very slow mover, short shelf life, "100+20" scheme.
  //    Plan §5.6 sized the scheme so the skip rule (§6.5) actually triggers.
  const schemeSkip = pickProducts((pid) => ambientOrCool(pid) && !hasIncoming(pid) && eligibleOffers(idx, pid, asOf).length > 0, 2, "slow");
  for (const pid of schemeSkip) {
    used.add(pid);
    const product = idx.productById.get(pid)!;
    product.shelf_life_days = 540;
    // ~0.17 packs/day: 1 sale in the last 7 days, 6 in the last 28, sparse before that.
    const lastSevenSale = rng.int(0, 6);
    const earlierSales = new Set(rng.shuffle([...Array(21).keys()].map((i) => i + 7)).slice(0, 5));
    for (const row of idx.salesRowsByProduct.get(pid) ?? []) {
      const ago = daysBetween(row.sale_date, asOf);
      row.units_sold = ago < 7 ? (ago === lastSevenSale ? 1 : 0) : ago < 28 ? (earlierSales.has(ago) ? 1 : 0) : rng.chance(0.15) ? 1 : 0;
    }
    reindex();
    setEligibleStock(pid, 1);
    for (const o of eligibleOffers(idx, pid, asOf)) {
      o.scheme_paid_qty = 100;
      o.scheme_free_qty = 20;
    }
  }
  reindex();

  // 8. Stale quote on the otherwise best offer (2).
  const staleQuote = pickProducts((pid) => eligibleOffers(idx, pid, asOf).length >= 2, 2);
  for (const pid of staleQuote) {
    used.add(pid);
    const best = [...eligibleOffers(idx, pid, asOf)].sort((a, b) => Number(a.unit_price) - Number(b.unit_price))[0];
    best.quoted_at = `${addDays(asOf, -20)}T10:00:00.000Z`;
    best.valid_until = `${addDays(asOf, 10)}T10:00:00.000Z`;
  }
  reindex();

  // 9. Demand spike (3): last 5 days ≈ 4.5 × base, so d7 / d28 ≥ 2.
  const spikeKind = (pid: string) => data.meta.demandBySku[sku(pid)]?.kind === "spike";
  const spike = pickProducts((pid) => spikeKind(pid) && ambientOrCool(pid), 3);
  if (spike.length < 3) spike.push(...pickProducts((pid) => ambientOrCool(pid) && !spike.includes(pid), 3 - spike.length));
  for (const pid of spike) {
    used.add(pid);
    const base = Math.max(1, data.meta.demandBySku[sku(pid)].basePacksPerDay);
    data.meta.demandBySku[sku(pid)].kind = "spike";
    for (const row of idx.salesRowsByProduct.get(pid) ?? []) {
      const ago = daysBetween(row.sale_date, asOf);
      if (ago < 5) row.units_sold = Math.round(4.5 * base);
      else if (ago < 28) row.units_sold = Math.round(base);
    }
  }
  reindex();

  // 10. Unmapped stock (3): the generator already moved 3 balances out of their bins.
  const unmapped = [...new Set(data.inventoryBalances.filter((b) => b.location_id === null).map((b) => sku(b.product_id)))];

  const toSkus = (ids: string[]) => ids.map(sku).sort();
  return {
    stockout: toSkus(stockout),
    expiry: toSkus(expiry),
    excess: toSkus(excess),
    priceAnomaly: toSkus(priceAnomaly),
    capacity: toSkus(capacity),
    cheapestTooSlow: toSkus(fastWithTwoOffers),
    schemeSkip: toSkus(schemeSkip),
    staleQuote: toSkus(staleQuote),
    unmapped: unmapped.sort(),
    spike: toSkus(spike),
    noEligibleOffer: toSkus(noEligible),
  };
}
