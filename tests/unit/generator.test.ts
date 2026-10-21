import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRODUCT_COUNT, SALES_DAYS, generate, strengthFits, type Profile, type SyntheticDataset } from "@/scripts/seed/generate-synthetic";

const AS_OF = "2026-10-21";
const profile = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "data/reference/profile.json"), "utf8"),
) as Profile;

const data = generate(profile, AS_OF, 42);

function addDays(dateIso: string, days: number) {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

describe("synthetic generator", () => {
  it("is deterministic: the same seed gives deep-equal output", () => {
    expect(generate(profile, AS_OF, 42)).toEqual(data);
  });

  it("changes output when the seed changes", () => {
    expect(generate(profile, AS_OF, 7).products[0]).not.toEqual(data.products[0]);
  });

  it("produces the row counts in plan §5.5", () => {
    expect(PRODUCT_COUNT).toBe(500);
    expect(data.products).toHaveLength(PRODUCT_COUNT);
    expect(data.suppliers).toHaveLength(8);
    expect(data.inventoryLocations).toHaveLength(240);
    expect(data.salesHistory).toHaveLength(PRODUCT_COUNT * SALES_DAYS);
    expect(data.purchaseOrders).toHaveLength(17);
    expect(data.purchaseOrders.filter((p) => p.status === "open")).toHaveLength(15);
    expect(data.purchaseOrders.filter((p) => p.status === "received")).toHaveLength(1);
    expect(data.purchaseOrders.filter((p) => p.status === "cancelled")).toHaveLength(1);

    const offersPerProduct = countBy(data.supplierOffers, (o) => o.product_id);
    const batchesPerProduct = countBy(data.batches, (b) => b.product_id);
    for (const p of data.products) {
      expect(offersPerProduct.get(p.id)).toBeGreaterThanOrEqual(1);
      expect(offersPerProduct.get(p.id)).toBeLessThanOrEqual(3);
      expect(batchesPerProduct.get(p.id)).toBeGreaterThanOrEqual(1);
      expect(batchesPerProduct.get(p.id)).toBeLessThanOrEqual(3);
    }
  });

  it("gives every bin a unique bin_code and 4 inactive bins", () => {
    const codes = data.inventoryLocations.map((b) => b.bin_code);
    expect(new Set(codes).size).toBe(240);
    expect(data.inventoryLocations.filter((b) => b.status === "inactive")).toHaveLength(4);
  });

  it("keeps every sales date within the 90 days ending on as-of", () => {
    const first = addDays(AS_OF, -89);
    for (const s of data.salesHistory) {
      expect(s.sale_date <= AS_OF).toBe(true);
      expect(s.sale_date >= first).toBe(true);
      expect(s.units_sold).toBeGreaterThanOrEqual(0);
    }
    const perProductDay = new Set(data.salesHistory.map((s) => `${s.product_id}|${s.sale_date}`));
    expect(perProductDay.size).toBe(data.salesHistory.length);
  });

  it("labels every row synthetic_demo and every offer a supplier_quote", () => {
    const tables = [data.products, data.suppliers, data.supplierOffers, data.salesHistory, data.batches, data.inventoryBalances, data.purchaseOrders];
    for (const rows of tables) for (const r of rows) expect(r.data_source).toBe("synthetic_demo");
    for (const o of data.supplierOffers) expect(o.price_type).toBe("supplier_quote");
  });

  it("matches the supplier mix: 6 approved, 1 pending, 1 blocked, one null reliability", () => {
    const status = countBy(data.suppliers, (s) => s.approved_status);
    expect(status.get("approved")).toBe(6);
    expect(status.get("pending")).toBe(1);
    expect(status.get("blocked")).toBe(1);
    expect(data.suppliers.filter((s) => s.approved_status === "approved" && s.reliability_score === null)).toHaveLength(1);
  });

  it("gives every product at least one offer from an approved supplier", () => {
    const approved = new Set(data.suppliers.filter((s) => s.approved_status === "approved").map((s) => s.id));
    for (const p of data.products) {
      expect(data.supplierOffers.some((o) => o.product_id === p.id && approved.has(o.supplier_id))).toBe(true);
    }
  });

  it("writes valid offers: schemes complete, valid_until after quoted_at, money as strings", () => {
    for (const o of data.supplierOffers) {
      expect((o.scheme_paid_qty === null) === (o.scheme_free_qty === null)).toBe(true);
      expect(o.valid_until >= o.quoted_at).toBe(true);
      expect(o.unit_price).toMatch(/^\d+\.\d{4}$/);
      expect(Number(o.unit_price)).toBeGreaterThan(0);
    }
    const expired = data.supplierOffers.filter((o) => o.valid_until.slice(0, 10) < AS_OF);
    expect(expired.length).toBeGreaterThan(0);
  });

  it("keeps referential integrity across tables", () => {
    const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    const products = ids(data.products);
    const suppliers = ids(data.suppliers);
    const batches = ids(data.batches);
    const bins = ids(data.inventoryLocations);
    const offers = ids(data.supplierOffers);
    const pos = ids(data.purchaseOrders);
    for (const o of data.supplierOffers) expect(products.has(o.product_id) && suppliers.has(o.supplier_id)).toBe(true);
    for (const b of data.batches) expect(products.has(b.product_id) && suppliers.has(b.supplier_id)).toBe(true);
    for (const bal of data.inventoryBalances) {
      expect(products.has(bal.product_id) && batches.has(bal.batch_id)).toBe(true);
      if (bal.location_id) expect(bins.has(bal.location_id)).toBe(true);
    }
    for (const l of data.purchaseOrderLines) expect(pos.has(l.po_id) && offers.has(l.supplier_offer_id)).toBe(true);
  });

  it("respects stock rules: reserved ≤ on hand, bins within capacity and class, 3 unmapped", () => {
    const binById = new Map(data.inventoryLocations.map((b) => [b.id, b]));
    const productById = new Map(data.products.map((p) => [p.id, p]));
    const fill = new Map<string, number>();
    for (const bal of data.inventoryBalances) {
      expect(bal.reserved_qty).toBeLessThanOrEqual(bal.on_hand_qty);
      if (!bal.location_id) continue;
      const bin = binById.get(bal.location_id)!;
      expect(bin.status).toBe("active");
      expect(bin.storage_class).toBe(productById.get(bal.product_id)!.storage_class);
      fill.set(bin.id, (fill.get(bin.id) ?? 0) + bal.on_hand_qty);
    }
    for (const [binId, qty] of fill) expect(qty).toBeLessThanOrEqual(binById.get(binId)!.capacity_units);
    expect(data.inventoryBalances.filter((b) => b.location_id === null)).toHaveLength(3);
    const batchBin = data.inventoryBalances.map((b) => `${b.batch_id}|${b.location_id ?? "-"}`);
    expect(new Set(batchBin).size).toBe(batchBin.length);
  });

  it("creates the quality and expiry exceptions: 3 quarantine, 1 recalled, 2 expired", () => {
    expect(data.batches.filter((b) => b.quality_status === "quarantine")).toHaveLength(3);
    expect(data.batches.filter((b) => b.quality_status === "recalled")).toHaveLength(1);
    expect(data.batches.filter((b) => b.expiry_date < AS_OF)).toHaveLength(2);
    for (const b of data.batches) expect(b.expiry_date > b.received_date).toBe(true);
  });

  it("keeps PO totals equal to the sum of their lines", () => {
    for (const po of data.purchaseOrders) {
      const lines = data.purchaseOrderLines.filter((l) => l.po_id === po.id);
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const sum = lines.reduce((acc, l) => acc + Math.round(Number(l.line_total) * 100), 0);
      expect(Math.round(Number(po.grand_total) * 100)).toBe(sum);
    }
    const open = data.purchaseOrders.filter((p) => p.status === "open");
    expect(open.some((p) => p.expected_delivery_date > addDays(AS_OF, 14))).toBe(true);
  });

  it("only gives a product strengths that suit its dosage form", () => {
    expect(strengthFits("125mg/5ml", "tablet")).toBe(false);
    expect(strengthFits("125mg/5ml", "syrup")).toBe(true);
    expect(strengthFits("1% w/w", "ointment")).toBe(true);
    expect(strengthFits("500mg", "ointment")).toBe(false);
    for (const p of data.products) {
      for (const part of p.strength.split(" + ")) expect(strengthFits(part, p.dosage_form)).toBe(true);
    }
  });

  it("avoids forbidden names and still works without a profile", () => {
    const forbidden = new Set(data.products.slice(0, 20).map((p) => p.brand_name.toLowerCase()));
    const other = generate(profile, AS_OF, 42, { forbiddenNames: forbidden });
    for (const p of other.products) expect(forbidden.has(p.brand_name.toLowerCase())).toBe(false);

    const bare: SyntheticDataset = generate({}, AS_OF, 42);
    expect(bare.products).toHaveLength(PRODUCT_COUNT);
    expect(bare.meta.profileUsed).toEqual({ catalogue: false, sales: false });
  });
});

function countBy<T, K>(rows: T[], key: (r: T) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return m;
}
