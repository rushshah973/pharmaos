// Phase D2: integrity, demo-case and no-copy checks (implementationplan.md §5.7).
// Every case and the default plan are checked with the real decision engine.
// Returns a list of failures; index.ts exits 1 if it is not empty.
import { sumMoney } from "@/lib/money";
import { buildPlan } from "@/lib/business-logic/engine";
import type { SyntheticDataset } from "./generate-synthetic";
import { datasetToContext } from "./to-engine";
import {
  addDays,
  binFill,
  buildIndex,
  daysBetween,
  eligibleOffers,
  estimateLine,
  rop,
  skuState,
  type DemoCases,
} from "./inject-demo-cases";

export type ValidationResult = { failures: string[]; notes: string[] };

/** §5.6 counts: ">=" cases need at least n, the rest exactly n. */
const CASE_RULES: Record<keyof DemoCases, { n: number; atLeast: boolean }> = {
  stockout: { n: 10, atLeast: true },
  expiry: { n: 8, atLeast: true },
  excess: { n: 5, atLeast: true },
  priceAnomaly: { n: 3, atLeast: false },
  capacity: { n: 2, atLeast: false },
  cheapestTooSlow: { n: 3, atLeast: false },
  schemeSkip: { n: 2, atLeast: false },
  staleQuote: { n: 2, atLeast: false },
  unmapped: { n: 3, atLeast: false },
  spike: { n: 2, atLeast: true },
  noEligibleOffer: { n: 1, atLeast: false },
};

export function validate(
  data: SyntheticDataset,
  cases: DemoCases,
  opts: { referenceNames: ReadonlySet<string> | null; sourceIds: string[] },
): ValidationResult {
  const failures: string[] = [];
  const notes: string[] = [];
  const fail = (msg: string) => failures.push(msg);
  const asOf = data.meta.asOf;
  const idx = buildIndex(data);

  // ---- Referential integrity ----
  const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
  const products = ids(data.products);
  const suppliers = ids(data.suppliers);
  const batches = ids(data.batches);
  const bins = ids(data.inventoryLocations);
  const offers = ids(data.supplierOffers);
  const pos = ids(data.purchaseOrders);
  const checkFk = (label: string, ok: boolean) => ok || fail(`FK: ${label}`);
  data.supplierOffers.forEach((o) => checkFk(`offer ${o.id}`, products.has(o.product_id) && suppliers.has(o.supplier_id)));
  data.salesHistory.forEach((s) => checkFk(`sale ${s.product_id}/${s.sale_date}`, products.has(s.product_id)));
  data.batches.forEach((b) => checkFk(`batch ${b.batch_number}`, products.has(b.product_id) && suppliers.has(b.supplier_id)));
  data.inventoryBalances.forEach((b) =>
    checkFk(`balance ${b.id}`, products.has(b.product_id) && batches.has(b.batch_id) && (b.location_id === null || bins.has(b.location_id))),
  );
  data.purchaseOrders.forEach((p) => checkFk(`po ${p.po_number}`, suppliers.has(p.supplier_id)));
  data.purchaseOrderLines.forEach((l) => checkFk(`po line ${l.id}`, pos.has(l.po_id) && products.has(l.product_id) && offers.has(l.supplier_offer_id)));

  // ---- Every SKU has an eligible approved offer, except the one deliberate SKU ----
  const noOffer = data.products.filter((p) => eligibleOffers(idx, p.id, asOf).length === 0).map((p) => p.sku).sort();
  for (const sku of cases.noEligibleOffer) {
    const s = skuState(data, idx, idx.productBySku.get(sku)!.id, asOf);
    if (!(s.dbar > 0 && s.stockPosition < rop(s.dbar, s.lFastest))) fail(`noEligibleOffer ${sku}: does not need ordering, so it would not show on the plan`);
  }
  if (JSON.stringify(noOffer) !== JSON.stringify([...cases.noEligibleOffer].sort())) {
    fail(`SKUs without an eligible offer should be exactly ${cases.noEligibleOffer.join(", ")}; found ${noOffer.join(", ") || "none"}`);
  }

  // ---- Stock rules ----
  for (const b of data.inventoryBalances) {
    if (b.reserved_qty > b.on_hand_qty) fail(`balance ${b.id}: reserved ${b.reserved_qty} > on hand ${b.on_hand_qty}`);
    if (b.on_hand_qty < 0 || b.reserved_qty < 0) fail(`balance ${b.id}: negative quantity`);
  }
  const fill = binFill(data);
  for (const bin of data.inventoryLocations) {
    if ((fill.get(bin.id) ?? 0) > bin.capacity_units) fail(`bin ${bin.bin_code}: ${fill.get(bin.id)} packs > capacity ${bin.capacity_units}`);
  }
  for (const bal of data.inventoryBalances) {
    if (!bal.location_id) continue;
    const bin = idx.binById.get(bal.location_id)!;
    if (bin.status !== "active") fail(`balance in inactive bin ${bin.bin_code}`);
    if (bin.storage_class !== idx.productById.get(bal.product_id)!.storage_class) fail(`balance in wrong storage class bin ${bin.bin_code}`);
  }

  // ---- Sales ----
  for (const s of data.salesHistory) {
    if (s.sale_date > asOf) fail(`sale after as-of: ${s.sale_date}`);
    if (s.units_sold < 0) fail(`negative sale on ${s.sale_date}`);
  }

  // ---- Demo cases (§5.6): counts, and each listed SKU really meets its condition ----
  for (const [key, rule] of Object.entries(CASE_RULES) as [keyof DemoCases, (typeof CASE_RULES)[keyof DemoCases]][]) {
    const n = cases[key].length;
    if (rule.atLeast ? n < rule.n : n !== rule.n) fail(`case ${key}: ${n} SKUs, need ${rule.atLeast ? "≥" : ""}${rule.n}`);
  }
  const pid = (sku: string) => idx.productBySku.get(sku)!.id;
  const state = (sku: string) => skuState(data, idx, pid(sku), asOf);
  for (const sku of cases.stockout) if (state(sku).status !== "STOCKOUT_RISK") fail(`stockout ${sku}: status ${state(sku).status}`);
  for (const sku of cases.expiry) if (state(sku).atRisk.length === 0) fail(`expiry ${sku}: no batch at risk`);
  for (const sku of cases.excess) if (state(sku).status !== "EXCESS") fail(`excess ${sku}: status ${state(sku).status}`);
  for (const sku of cases.priceAnomaly) {
    const all = idx.offersByProduct.get(pid(sku)) ?? [];
    const anomalous = all.some((o) => {
      const others = all.filter((x) => x.id !== o.id).map((x) => Number(x.unit_price)).sort((a, b) => a - b);
      const m = others.length % 2 ? others[(others.length - 1) / 2] : (others[others.length / 2 - 1] + others[others.length / 2]) / 2;
      return Number(o.unit_price) > 1.2 * m;
    });
    if (!anomalous) fail(`priceAnomaly ${sku}: no offer above 1.2 × median of the others`);
  }
  for (const sku of cases.capacity) {
    const est = estimateLine(data, idx, pid(sku), asOf);
    if (!est.candidate) fail(`capacity ${sku}: not a candidate line`);
    else {
      const product = idx.productBySku.get(sku)!;
      const fits = data.inventoryLocations.some(
        (b) => b.status === "active" && b.storage_class === product.storage_class && b.capacity_units - (fill.get(b.id) ?? 0) >= est.qty,
      );
      if (fits) fail(`capacity ${sku}: a bin can still take ${est.qty} packs`);
    }
  }
  for (const sku of cases.cheapestTooSlow) {
    // The engine must skip the cheapest offer because it delivers too late, and still find a faster one.
    const a = state(sku).analysis;
    if (!a.reasons.includes("CHEAPER_OFFER_TOO_SLOW")) fail(`cheapestTooSlow ${sku}: engine reasons are ${a.reasons.join(", ") || "none"}`);
    if (!a.candidate || !a.chosen) fail(`cheapestTooSlow ${sku}: no offer chosen`);
  }
  for (const sku of cases.schemeSkip) {
    const a = state(sku).analysis;
    if (!a.reasons.includes("SCHEME_SKIPPED_EXPIRY")) fail(`schemeSkip ${sku}: engine reasons are ${a.reasons.join(", ") || "none"}`);
  }
  for (const sku of cases.staleQuote) {
    const all = idx.offersByProduct.get(pid(sku)) ?? [];
    const eligible = eligibleOffers(idx, pid(sku), asOf);
    const cheapestEligible = Math.min(...eligible.map((o) => Number(o.unit_price)));
    const staleBest = all.some(
      (o) =>
        idx.supplierById.get(o.supplier_id)?.approved_status === "approved" &&
        daysBetween(o.quoted_at.slice(0, 10), asOf) > 14 &&
        o.valid_until.slice(0, 10) >= asOf &&
        Number(o.unit_price) < cheapestEligible,
    );
    if (!staleBest) fail(`staleQuote ${sku}: no stale offer cheaper than every eligible offer`);
    if (eligible.length === 0) fail(`staleQuote ${sku}: no eligible offer left`);
  }
  const unmappedRows = data.inventoryBalances.filter((b) => b.location_id === null);
  if (unmappedRows.length !== 3) fail(`unmapped: ${unmappedRows.length} balances, need 3`);
  for (const sku of cases.spike) {
    const a = state(sku).analysis;
    if (!a.warnings.includes("DEMAND_SPIKE")) fail(`spike ${sku}: engine did not flag DEMAND_SPIKE (d7/d28 = ${(a.demand.d7 / a.demand.d28).toFixed(2)})`);
  }

  // ---- Default plan binds the budget (the real engine) ----
  const ctx = datasetToContext(data);
  const plan = buildPlan(ctx, "200000.00");
  const tight = buildPlan(ctx, "100000.00");
  const candidates = plan.lines.filter((l) => l.totals);
  const wanted = sumMoney(candidates.map((l) => l.totals!.lineTotal));
  const inTight = tight.lines.filter((l) => l.inBasket).length;
  notes.push(
    `default plan: ${candidates.length} candidate lines worth ₹${Math.round(wanted.toNumber()).toLocaleString("en-IN")}; ` +
      `₹2,00,000 buys ${plan.lines.filter((l) => l.inBasket).length} (total ₹${plan.planTotal}); ₹1,00,000 buys ${inTight} (total ₹${tight.planTotal})`,
  );
  if (candidates.length < 15) fail(`only ${candidates.length} candidate lines (need ≥ 15)`);
  if (!wanted.greaterThan(200_000)) fail(`candidate lines total ₹${wanted.toFixed(2)}: does not exceed ₹2,00,000, so the budget would not bind`);
  if (inTight < 5) fail(`only ${inTight} lines fit in ₹1,00,000 (need ≥ 5)`);
  if (sumMoney([plan.planTotal]).greaterThan(200_000) || sumMoney([tight.planTotal]).greaterThan(100_000)) fail("a plan exceeds its budget");

  // ---- No-copy checks ----
  const tables = {
    products: data.products,
    suppliers: data.suppliers,
    supplier_offers: data.supplierOffers,
    sales_history: data.salesHistory,
    batches: data.batches,
    inventory_balances: data.inventoryBalances,
    purchase_orders: data.purchaseOrders,
  };
  for (const [name, rows] of Object.entries(tables)) {
    const bad = (rows as { data_source: string }[]).filter((r) => r.data_source !== "synthetic_demo").length;
    if (bad) fail(`${name}: ${bad} rows not labelled synthetic_demo`);
  }
  const badPrice = data.supplierOffers.filter((o) => o.price_type !== "supplier_quote").length;
  if (badPrice) fail(`${badPrice} offers with price_type other than supplier_quote`);
  if (opts.referenceNames) {
    const names = [
      ...data.products.map((p) => ["brand", p.brand_name] as const),
      ...data.products.map((p) => ["manufacturer", p.manufacturer] as const),
      ...data.suppliers.map((s) => ["supplier", s.name] as const),
    ];
    for (const [kind, name] of names) if (opts.referenceNames.has(name.trim().toLowerCase())) fail(`no-copy: ${kind} "${name}" matches a reference name`);
    notes.push(`no-copy: ${names.length} generated names checked against ${opts.referenceNames.size.toLocaleString("en-IN")} reference names`);
  } else {
    notes.push("no-copy: reference files not found in data/reference/, name check skipped");
  }
  if (opts.sourceIds.length === 0) fail("data_sources: sources.json has no entries");
  if (new Set(opts.sourceIds).size !== opts.sourceIds.length) fail("data_sources: duplicate ids in sources.json");

  // Sanity: as-of window
  const firstSale = data.salesHistory.reduce((m, s) => (s.sale_date < m ? s.sale_date : m), asOf);
  if (firstSale !== addDays(asOf, -89)) notes.push(`first sale date ${firstSale} (expected ${addDays(asOf, -89)})`);

  return { failures, notes };
}
