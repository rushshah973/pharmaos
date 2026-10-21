// Warehouse reads (implementationplan.md §6.13, architecture.md §7.6): layout, heatmap, bin details, product search.
// The heatmap runs the same engine (analyseSku on one planning context) as the plan, so a bin's colour and a plan
// line's status always agree. One context load per request.
import { ServiceError } from "@/lib/api/errors";
import { getSql } from "@/lib/db/client";
import { daysBetween } from "@/lib/business-logic/dates";
import { analyseSku } from "@/lib/business-logic/engine";
import { computeHeatmap, type HeatmapMode, type HeatmapResult, type SkuHeatFacts } from "@/lib/business-logic/heatmap";
import { planPutaway, type PutawayBin, type PutawayResult } from "@/lib/business-logic/putaway";
import type { SkuAnalysis, SkuContext, SkuStatus, StorageClass } from "@/lib/business-logic/types";
import { type Bounds, boundingBox, parseBinCode } from "@/lib/warehouse/geometry";
import { resolvePlanningState } from "./as-of";
import type { SqlHandle } from "./audit";
import { loadPlanningContext } from "./context";
import { getPlan } from "./plans";

type BinRow = {
  id: string;
  binCode: string;
  zone: string;
  aisle: string;
  rack: string;
  shelf: number;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  capacityUnits: number;
  storageClass: StorageClass;
  status: "active" | "inactive" | "blocked";
  used: number;
};

export type LayoutBin = BinRow & { side: "L" | "R"; rackNumber: number };
export type WarehouseLayout = { bins: LayoutBin[]; aisles: string[]; bounds: Bounds };

async function selectBins(sql: SqlHandle, id?: string): Promise<BinRow[]> {
  return sql<BinRow[]>`
    select l.id, l.bin_code as "binCode", l.zone, l.aisle, l.rack, l.shelf,
      l.x::float8 as x, l.y::float8 as y, l.z::float8 as z,
      l.width::float8 as width, l.depth::float8 as depth, l.height::float8 as height,
      l.capacity_units as "capacityUnits", l.storage_class as "storageClass", l.status,
      coalesce((select sum(b.on_hand_qty) from inventory_balances b where b.location_id = l.id), 0)::int as used
    from inventory_locations l
    where true ${id ? sql`and l.id = ${id}` : sql``}
    order by l.bin_code
  `;
}

export async function getLayout(sql: SqlHandle = getSql()): Promise<WarehouseLayout> {
  const rows = await selectBins(sql);
  const bins = rows.map((b) => {
    const a = parseBinCode(b.binCode);
    return { ...b, side: a?.side ?? "L", rackNumber: a?.rack ?? 0 };
  });
  return { bins, aisles: [...new Set(bins.map((b) => b.aisle))].sort(), bounds: boundingBox(bins) };
}

/** The engine's facts for the heatmap, from one SKU's analysis. */
function heatFacts(sku: SkuContext, a: SkuAnalysis): SkuHeatFacts {
  const expired = a.expiry.ineligible.filter((b) => b.reason === "expired");
  const expiryOf = new Map(sku.batches.map((b) => [b.id, b.expiryDate]));
  return {
    productId: a.productId,
    sku: a.sku,
    status: a.status,
    cover: a.cover,
    stockPosition: a.stockPosition,
    targetStock: a.targetStock,
    batches: [
      ...a.expiry.batches.map((b) => ({ batchId: b.batchId, daysToExpiry: b.daysToExpiry, atRiskQty: b.atRiskQty, expired: false })),
      ...expired.map((b) => ({ batchId: b.batchId, daysToExpiry: daysBetween(sku.asOf, expiryOf.get(b.batchId) ?? sku.asOf), atRiskQty: b.onHandQty, expired: true })),
    ],
  };
}

export type HeatmapView = HeatmapResult & {
  asOf: string;
  scenarioId: string;
  planId: string | null;
  placements: (PutawayResult & { sku: string; lineId: string })[];
};

export async function getHeatmap(mode: HeatmapMode, planId?: string, sql: SqlHandle = getSql()): Promise<HeatmapView> {
  return (await getHeatmaps([mode], planId, sql))[mode]!;
}

/**
 * Several modes from ONE planning context (the context load dominates: ~2–5 s against the remote database;
 * the engine itself takes ~50 ms for 500 SKUs). The warehouse page renders the four status modes this way,
 * so switching between them needs no request.
 */
export async function getHeatmaps(modes: HeatmapMode[], planId?: string, sql: SqlHandle = getSql()): Promise<Partial<Record<HeatmapMode, HeatmapView>>> {
  const proposed = modes.includes("proposed");
  if (proposed && !planId) throw new ServiceError("VALIDATION_ERROR", 400, "Proposed mode needs a planId.");
  const [state, bins, plan] = await Promise.all([
    resolvePlanningState(sql),
    selectBins(sql),
    proposed ? getPlan(planId!, sql) : Promise.resolve(null),
  ]);
  const ctx = await loadPlanningContext(sql, state.asOf, state.scenarioId);
  const facts = new Map<string, SkuHeatFacts>();
  for (const s of ctx.skus) facts.set(s.product.id, heatFacts(s, analyseSku(s)));
  const balances = ctx.skus.flatMap((s) => s.balances.map((b) => ({ binId: b.locationId, productId: s.product.id, batchId: b.batchId, onHandQty: b.onHandQty })));

  let placements: HeatmapView["placements"] = [];
  if (plan) {
    const storage = new Map(ctx.skus.map((s) => [s.product.id, s.product.storageClass]));
    const productsIn = new Map<string, string[]>();
    for (const b of balances) if (b.binId && b.onHandQty > 0) productsIn.set(b.binId, [...new Set([...(productsIn.get(b.binId) ?? []), b.productId])]);
    const putawayBins: PutawayBin[] = bins.map((b) => ({ ...b, productIds: productsIn.get(b.id) ?? [] }));
    const lines = plan.lines.filter((l) => l.counted && l.qty > 0).sort((a, b) => a.rank - b.rank);
    const results = planPutaway(
      lines.map((l) => ({ productId: l.productId, storageClass: storage.get(l.productId) ?? "ambient", packs: l.qty + l.freeQty })),
      putawayBins,
    );
    placements = results.map((r, i) => ({ ...r, sku: lines[i].sku, lineId: lines[i].id }));
  }

  const out: Partial<Record<HeatmapMode, HeatmapView>> = {};
  for (const mode of modes) {
    const result = computeHeatmap({ mode, bins, balances, facts, placements: mode === "proposed" ? placements : [] });
    out[mode] = { ...result, asOf: state.asOf, scenarioId: state.scenarioId, planId: plan?.id ?? null, placements: mode === "proposed" ? placements : [] };
  }
  return out;
}

/** The plan whose lines "Proposed replenishment" shows: the newest plan that can still be approved. */
export async function getLatestOpenPlan(sql: SqlHandle = getSql()): Promise<{ id: string; createdAt: string } | null> {
  const [row] = await sql<{ id: string; createdAt: string }[]>`
    select id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
    from purchase_plans where status in ('draft', 'partially_approved')
    order by created_at desc limit 1
  `;
  return row ?? null;
}

export type BinDetails = LayoutBin & {
  free: number;
  products: {
    productId: string;
    sku: string;
    brandName: string;
    strength: string;
    dosageForm: string;
    packSize: number;
    status: SkuStatus | null;
    cover: number | null;
    packs: number;
    reserved: number;
    batches: {
      batchId: string;
      batchNumber: string;
      expiryDate: string;
      qualityStatus: string;
      onHand: number;
      reserved: number;
      /** At-risk packs of this batch overall (FEFO projection), not only in this bin. */
      atRiskQty: number;
      dataSource: string;
    }[];
  }[];
};

export async function getBinDetails(id: string, sql: SqlHandle = getSql()): Promise<BinDetails> {
  const [[bin], rows, state] = await Promise.all([
    selectBins(sql, id),
    sql<
      {
        productId: string;
        sku: string;
        brandName: string;
        strength: string;
        dosageForm: string;
        packSize: number;
        batchId: string;
        batchNumber: string;
        expiryDate: string;
        qualityStatus: string;
        onHand: number;
        reserved: number;
        dataSource: string;
      }[]
    >`
      select p.id as "productId", p.sku, p.brand_name as "brandName", p.strength, p.dosage_form as "dosageForm", p.pack_size as "packSize",
        bt.id as "batchId", bt.batch_number as "batchNumber", to_char(bt.expiry_date, 'YYYY-MM-DD') as "expiryDate",
        bt.quality_status as "qualityStatus", b.on_hand_qty as "onHand", b.reserved_qty as "reserved",
        b.data_source as "dataSource"
      from inventory_balances b
      join batches bt on bt.id = b.batch_id
      join products p on p.id = b.product_id
      where b.location_id = ${id} and b.on_hand_qty > 0
      order by p.sku, bt.expiry_date, bt.batch_number
    `.execute(),
    resolvePlanningState(sql),
  ]);
  if (!bin) throw new ServiceError("BIN_NOT_FOUND", 404, `Bin ${id} was not found.`);

  const productIds = [...new Set(rows.map((r) => r.productId))];
  const ctx = productIds.length ? await loadPlanningContext(sql, state.asOf, state.scenarioId, productIds) : { skus: [] };
  const analyses = new Map(ctx.skus.map((s) => [s.product.id, analyseSku(s)]));

  const products = new Map<string, BinDetails["products"][number]>();
  for (const r of rows) {
    let p = products.get(r.productId);
    if (!p) {
      const a = analyses.get(r.productId);
      p = { productId: r.productId, sku: r.sku, brandName: r.brandName, strength: r.strength, dosageForm: r.dosageForm, packSize: r.packSize, status: a?.status ?? null, cover: a?.cover ?? null, packs: 0, reserved: 0, batches: [] };
      products.set(r.productId, p);
    }
    p.packs += r.onHand;
    p.reserved += r.reserved;
    const atRiskQty = analyses.get(r.productId)?.expiry.batches.find((b) => b.batchId === r.batchId)?.atRiskQty ?? 0;
    p.batches.push({ batchId: r.batchId, batchNumber: r.batchNumber, expiryDate: r.expiryDate, qualityStatus: r.qualityStatus, onHand: r.onHand, reserved: r.reserved, atRiskQty, dataSource: r.dataSource });
  }
  const a = parseBinCode(bin.binCode);
  return { ...bin, side: a?.side ?? "L", rackNumber: a?.rack ?? 0, free: bin.capacityUnits - bin.used, products: [...products.values()] };
}

export type ProductSearchHit = {
  productId: string;
  sku: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  packSize: number;
  manufacturer: string;
  storageClass: StorageClass;
  bins: { binId: string; binCode: string; packs: number }[];
  unmappedPacks: number;
};

export const SEARCH_MIN_CHARS = 2;
const SEARCH_LIMIT = 20;

/** Up to 20 active SKUs whose SKU code, brand or generic name contains `q`, with the bins that hold them. */
export async function searchProducts(q: string, sql: SqlHandle = getSql()): Promise<ProductSearchHit[]> {
  const term = q.trim();
  if (term.length < SEARCH_MIN_CHARS) throw new ServiceError("VALIDATION_ERROR", 400, `Type at least ${SEARCH_MIN_CHARS} characters to search.`);
  const like = `%${term.slice(0, 64).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return sql<ProductSearchHit[]>`
    select p.id as "productId", p.sku, p.brand_name as "brandName", p.generic_name as "genericName", p.strength,
      p.dosage_form as "dosageForm", p.pack_size as "packSize", p.manufacturer, p.storage_class as "storageClass",
      coalesce((
        select json_agg(json_build_object('binId', x.id, 'binCode', x.bin_code, 'packs', x.packs) order by x.bin_code)
        from (
          select l.id, l.bin_code, sum(b.on_hand_qty)::int as packs
          from inventory_balances b join inventory_locations l on l.id = b.location_id
          where b.product_id = p.id and b.on_hand_qty > 0
          group by l.id, l.bin_code
        ) x
      ), '[]'::json) as bins,
      coalesce((select sum(on_hand_qty) from inventory_balances where product_id = p.id and location_id is null), 0)::int as "unmappedPacks"
    from products p
    where p.is_active and (p.sku ilike ${like} or p.brand_name ilike ${like} or p.generic_name ilike ${like})
    order by (upper(p.sku) = upper(${term})) desc, (p.brand_name ilike ${`${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}) desc, p.sku
    limit ${SEARCH_LIMIT}
  `;
}
