// §6.13 heatmap and put-away.
import { describe, expect, it } from "vitest";
import { computeHeatmap, type HeatmapBalance, type HeatmapBin, type SkuHeatFacts } from "@/lib/business-logic/heatmap";
import { candidateBin, planPutaway, type PutawayBin } from "@/lib/business-logic/putaway";

const bin = (id: string, over: Partial<HeatmapBin> = {}): HeatmapBin => ({ id, binCode: id, storageClass: "ambient", capacityUnits: 100, status: "active", ...over });
const facts = (productId: string, over: Partial<SkuHeatFacts> = {}): SkuHeatFacts => ({
  productId,
  sku: productId.toUpperCase(),
  status: "HEALTHY",
  cover: 20,
  stockPosition: 50,
  targetStock: 60,
  batches: [],
  ...over,
});
const bal = (binId: string | null, productId: string, batchId: string, onHandQty: number): HeatmapBalance => ({ binId, productId, batchId, onHandQty });

describe("§6.13 heatmap: one highlighted bin per mode", () => {
  const bins = ["A-L-01-1", "A-L-01-2", "A-L-01-3", "A-L-01-4"].map((id) => bin(id));
  const f = new Map([
    ["p1", facts("p1", { status: "STOCKOUT_RISK", cover: 0.5 })],
    ["p2", facts("p2", { batches: [{ batchId: "b2", daysToExpiry: 40, atRiskQty: 30, expired: false }] })],
    ["p3", facts("p3", { status: "EXCESS", stockPosition: 250, targetStock: 100 })],
    ["p4", facts("p4")],
  ]);
  const balances = [bal("A-L-01-1", "p1", "b1", 5), bal("A-L-01-2", "p2", "b2", 60), bal("A-L-01-3", "p3", "b3", 95), bal("A-L-01-4", "p4", "b4", 40)];
  const highlighted = (mode: "stockout" | "expiry" | "excess") =>
    computeHeatmap({ mode, bins, balances, facts: f }).bins.filter((b) => b.severity > 0).map((b) => b.binId);

  it("stockout: only the bin holding the STOCKOUT_RISK SKU, valued at its cover", () => {
    expect(highlighted("stockout")).toEqual(["A-L-01-1"]);
    const b = computeHeatmap({ mode: "stockout", bins, balances, facts: f }).bins[0];
    expect(b).toMatchObject({ severity: 3, value: 0.5, label: "Stockout risk · 0.5 d cover", skus: ["P1"] });
  });

  it("expiry: only the bin holding the at-risk batch", () => {
    expect(highlighted("expiry")).toEqual(["A-L-01-2"]);
    expect(computeHeatmap({ mode: "expiry", bins, balances, facts: f }).bins[1]).toMatchObject({ severity: 2, value: 40, label: "Expiry risk · 30 packs · expires in 40 d" });
  });

  it("excess: only the EXCESS SKU's bin, valued at stock ÷ target", () => {
    expect(highlighted("excess")).toEqual(["A-L-01-3"]);
    expect(computeHeatmap({ mode: "excess", bins, balances, facts: f }).bins[2]).toMatchObject({ severity: 2, value: 2.5 });
  });

  it("normal: fill % of capacity for every bin", () => {
    const r = computeHeatmap({ mode: "normal", bins, balances, facts: f }).bins;
    expect(r.map((b) => b.value)).toEqual([5, 60, 95, 40]);
    expect(r.map((b) => b.severity)).toEqual([1, 1, 3, 1]);
  });

  it("proposed: only the put-away bin, valued at proposed packs", () => {
    const r = computeHeatmap({
      mode: "proposed",
      bins,
      balances,
      facts: f,
      placements: [
        { productId: "p4", packs: 40, binId: "A-L-01-4", binCode: "A-L-01-4", preference: "same_bin" },
        { productId: "p1", packs: 500, binId: null, binCode: null, code: "CAPACITY_REVIEW" },
      ],
    });
    expect(r.bins.filter((b) => b.severity > 0).map((b) => b.binId)).toEqual(["A-L-01-4"]);
    expect(r.bins[3]).toMatchObject({ value: 40, severity: 2, label: "Proposed · 40 packs · 80% full after put-away" });
    expect(r.capacityReview).toEqual([{ productId: "p1", sku: "P1", packs: 500 }]);
  });
});

describe("§6.13 heatmap severity bands", () => {
  const one = (fx: Partial<SkuHeatFacts>, mode: "stockout" | "expiry" | "excess", qty = 10) =>
    computeHeatmap({ mode, bins: [bin("X")], balances: [bal("X", "p", "b", qty)], facts: new Map([["p", facts("p", fx)]]) }).bins[0].severity;

  it("stockout: <1 d → 3, <3 d → 2, otherwise 1; not at risk → 0", () => {
    expect(one({ status: "STOCKOUT_RISK", cover: 0.9 }, "stockout")).toBe(3);
    expect(one({ status: "STOCKOUT_RISK", cover: 2 }, "stockout")).toBe(2);
    expect(one({ status: "STOCKOUT_RISK", cover: 4 }, "stockout")).toBe(1);
    expect(one({ status: "BELOW_ROP", cover: 0.2 }, "stockout")).toBe(0);
  });

  it("expiry: expired or ≤30 d → 3, ≤90 d → 2, later → 1", () => {
    const b = (daysToExpiry: number, expired = false) => ({ batches: [{ batchId: "b", daysToExpiry, atRiskQty: 5, expired }] });
    expect(one(b(-3, true), "expiry")).toBe(3);
    expect(one(b(30), "expiry")).toBe(3);
    expect(one(b(90), "expiry")).toBe(2);
    expect(one(b(120), "expiry")).toBe(1);
    expect(one({ batches: [{ batchId: "b", daysToExpiry: 20, atRiskQty: 0, expired: false }] }, "expiry")).toBe(0);
  });

  it("excess: ≥3× target → 3, ≥2× → 2, otherwise 1", () => {
    expect(one({ status: "EXCESS", stockPosition: 300, targetStock: 100 }, "excess")).toBe(3);
    expect(one({ status: "EXCESS", stockPosition: 200, targetStock: 100 }, "excess")).toBe(2);
    expect(one({ status: "EXCESS", stockPosition: 150, targetStock: 100 }, "excess")).toBe(1);
  });

  it("inactive bins are never highlighted", () => {
    const r = computeHeatmap({
      mode: "stockout",
      bins: [bin("X", { status: "inactive" })],
      balances: [bal("X", "p", "b", 5)],
      facts: new Map([["p", facts("p", { status: "STOCKOUT_RISK", cover: 0 })]]),
    });
    expect(r.bins[0]).toMatchObject({ severity: 0, label: "Inactive" });
  });

  it("splits a batch's at-risk packs over the bins holding it", () => {
    const r = computeHeatmap({
      mode: "expiry",
      bins: [bin("X"), bin("Y")],
      balances: [bal("X", "p", "b", 30), bal("Y", "p", "b", 10)],
      facts: new Map([["p", facts("p", { batches: [{ batchId: "b", daysToExpiry: 50, atRiskQty: 20, expired: false }] })]]),
    });
    expect(r.bins.map((b) => b.label)).toEqual(["Expiry risk · 15 packs · expires in 50 d", "Expiry risk · 5 packs · expires in 50 d"]);
  });
});

describe("§6.13 unmapped stock", () => {
  it("is listed, never drawn in a bin", () => {
    const r = computeHeatmap({
      mode: "normal",
      bins: [bin("X")],
      balances: [bal(null, "p", "b", 25), bal(null, "p", "b2", 5)],
      facts: new Map([["p", facts("p", { status: "STOCKOUT_RISK", cover: 0 })]]),
    });
    expect(r.bins[0]).toMatchObject({ severity: 0, value: 0, label: "Empty" });
    expect(r.unmapped).toEqual([{ productId: "p", sku: "P", packs: 30 }]);
  });

  it("does not count as existing stock for put-away, and is never moved", () => {
    const bins: PutawayBin[] = [pbin("A-L-01-1", "A"), pbin("C-L-01-1", "C")];
    // The SKU's only stock is unmapped, so there is no same-bin or same-aisle preference.
    expect(candidateBin({ productId: "p", storageClass: "ambient", packs: 10 }, bins)).toMatchObject({ binCode: "A-L-01-1", preference: "lowest_code" });
  });
});

function pbin(binCode: string, aisle: string, over: Partial<PutawayBin> = {}): PutawayBin {
  return { id: binCode, binCode, aisle, storageClass: "ambient", capacityUnits: 100, status: "active", used: 0, productIds: [], ...over };
}

describe("§6.13 put-away candidate bin", () => {
  const req = { productId: "p", storageClass: "ambient" as const, packs: 30 };

  it("prefers a bin already holding the SKU", () => {
    const bins = [pbin("A-L-01-1", "A"), pbin("C-R-02-3", "C", { used: 50, productIds: ["p"] }), pbin("C-L-01-1", "C")];
    expect(candidateBin(req, bins)).toMatchObject({ binCode: "C-R-02-3", preference: "same_bin" });
  });

  it("then a bin in the same aisle as the SKU's stock", () => {
    // The holding bin is too full; aisle C is preferred over the lower code in aisle A.
    const bins = [pbin("A-L-01-1", "A"), pbin("C-R-02-3", "C", { used: 90, productIds: ["p"] }), pbin("C-L-04-2", "C")];
    expect(candidateBin(req, bins)).toMatchObject({ binCode: "C-L-04-2", preference: "same_aisle" });
  });

  it("then the lowest bin code; skips the wrong storage class, inactive and full bins", () => {
    const bins = [
      pbin("A-L-01-1", "A", { storageClass: "cold_chain" }),
      pbin("A-L-01-2", "A", { status: "inactive" }),
      pbin("A-L-01-3", "A", { used: 71 }),
      pbin("B-R-01-1", "B"),
      pbin("A-R-06-4", "A", { used: 70 }), // exactly 30 free: fits
    ];
    expect(candidateBin(req, bins)).toMatchObject({ binCode: "A-R-06-4", preference: "lowest_code" });
  });

  it("nothing fits → CAPACITY_REVIEW, no location invented", () => {
    const bins = [pbin("A-L-01-1", "A", { used: 80 }), pbin("E-L-01-1", "E", { storageClass: "cold_chain" })];
    expect(candidateBin(req, bins)).toEqual({ productId: "p", packs: 30, binId: null, binCode: null, code: "CAPACITY_REVIEW" });
  });

  it("places several lines in order, each using the room the earlier ones left", () => {
    const bins = [pbin("A-L-01-1", "A", { used: 40 }), pbin("A-L-01-2", "A")];
    const r = planPutaway(
      [
        { productId: "p", storageClass: "ambient", packs: 50 },
        { productId: "q", storageClass: "ambient", packs: 50 },
        { productId: "r", storageClass: "ambient", packs: 0 },
        { productId: "s", storageClass: "ambient", packs: 60 },
      ],
      bins,
    );
    expect(r.map((x) => x.binCode)).toEqual(["A-L-01-1", "A-L-01-2", null]);
    expect(r[2]).toMatchObject({ productId: "s", code: "CAPACITY_REVIEW" });
    expect(bins[0].used).toBe(40); // inputs are not mutated
  });

  it("is deterministic regardless of input order", () => {
    const bins = [pbin("B-L-01-1", "B"), pbin("A-R-02-1", "A"), pbin("A-L-03-1", "A")];
    expect(candidateBin(req, bins).binCode).toBe("A-L-03-1");
    expect(candidateBin(req, [...bins].reverse()).binCode).toBe("A-L-03-1");
  });
});
