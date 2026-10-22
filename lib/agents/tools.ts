// The Ask PharmaOS tool allow-list (implementationplan.md §9.2): exactly these 19 tools. Each has a Zod input schema
// (sent to Gemini as parametersJsonSchema, and used again to re-validate the model's arguments before anything runs)
// and a handler that calls services and returns a ToolResult. recalculate_plan is the only write.
// Deliberately absent: approve lines, reject a plan, create / update a PO, Owner-approve a PO, send a PO, change the
// approval limit, any SQL. Creating POs exists only for the pipeline's Order Agent (P22B).
import { z } from "zod";
import type { FunctionDeclaration } from "@google/genai";
import { ServiceError } from "@/lib/api/errors";
import { getSql } from "@/lib/db/client";
import { candidateBin, type PutawayBin } from "@/lib/business-logic/putaway";
import { lineTotals, needsOwnerApproval } from "@/lib/business-logic/totals";
import { hardStops } from "@/lib/business-logic/validation";
import { dec, formatINR } from "@/lib/money";
import { type ToolResult, toolError, toolOk } from "@/lib/validation/tool-contract";
import { analyseSkuCode, binIdForCode, expiryExposureTop, planPreview, priceHistory, salesHistory } from "@/lib/services/agent-data";
import { resolvePlanningState } from "@/lib/services/as-of";
import { loadPlanningContext } from "@/lib/services/context";
import { getPlan, recalculatePlan } from "@/lib/services/plans";
import { getBinDetails, getHeatmap, getLatestOpenPlan, getLayout, searchProducts } from "@/lib/services/warehouse";

export type Reference = { type: "product" | "line" | "bin" | "plan" | "supplier"; id: string; label: string };
type Out = { data: unknown; refs?: Reference[] };
type Tool = {
  name: string;
  description: string;
  schema: z.ZodObject;
  mutates?: boolean;
  handler: (args: never) => Promise<Out>;
};

const sku = z.string().trim().min(3).max(32).describe("Exact SKU code, e.g. PHX-0056. Resolve names with search_products first.");
const planId = z.uuid().describe("Purchase plan id (given in the conversation context).");
const AGENT_ACTOR = { type: "agent" as const, id: "ask-pharmaos" };

function tool<S extends z.ZodObject>(def: { name: string; description: string; schema: S; mutates?: boolean; handler: (args: z.infer<S>) => Promise<Out> }): Tool {
  return def as unknown as Tool;
}

export const TOOLS: Tool[] = [
  tool({
    name: "search_products",
    description: "Find SKUs by SKU code, brand or generic name. Returns exact identity fields (SKU, brand, generic, strength, form, pack size, manufacturer) and the bins holding each. Use it to resolve any product name before other tools.",
    schema: z.object({ query: z.string().trim().min(2).max(64).describe("SKU code, brand or generic name") }),
    handler: async ({ query }) => {
      const hits = await searchProducts(query);
      return {
        data: { matches: hits.map((h) => ({ sku: h.sku, brandName: h.brandName, genericName: h.genericName, strength: h.strength, dosageForm: h.dosageForm, packSize: h.packSize, manufacturer: h.manufacturer, bins: h.bins.map((b) => `${b.binCode} (${b.packs} packs)`) })) },
        refs: hits.slice(0, 5).map((h) => ({ type: "product", id: h.sku, label: `${h.sku} ${h.brandName} ${h.strength}` })),
      };
    },
  }),
  tool({
    name: "get_sales_history",
    description: "Daily packs sold for one SKU over the last N days (up to 90), oldest first, with the total.",
    schema: z.object({ sku, days: z.number().int().min(1).max(90).describe("Number of days, 1 to 90") }),
    handler: async ({ sku, days }) => ({ data: await salesHistory(sku, days) }),
  }),
  tool({
    name: "get_inventory_position",
    description: "Stock for one SKU: eligible available (sells before expiry), reserved, incoming on open or sent POs, stock position, days of cover, reorder point, target and engine status.",
    schema: z.object({ sku }),
    handler: async ({ sku }) => {
      const { analysis: a, sku: s } = await analyseSkuCode(sku);
      return {
        data: {
          sku: a.sku,
          status: a.status,
          eligibleAvailable: a.expiry.eligibleAvailable,
          reserved: s.balances.reduce((n, b) => n + b.reservedQty, 0),
          incoming: a.incomingQty,
          stockPosition: a.stockPosition,
          coverDays: a.cover,
          reorderPoint: a.reorderPoint,
          targetStock: a.targetStock,
          fastestLeadDays: a.leadFastest,
          reorderInDays: a.reorderInDays,
        },
      };
    },
  }),
  tool({
    name: "forecast_demand",
    description: "Demand for one SKU: 7-day and 28-day averages, the baseline, the ML forecast, the method used and why, the daily demand used (d̄) and demand flags.",
    schema: z.object({ sku }),
    handler: async ({ sku }) => {
      const { analysis: a } = await analyseSkuCode(sku);
      const d = a.demand;
      return { data: { sku: a.sku, d7: d.d7, d28: d.d28, baseline: d.baseline, ml: d.ml, method: d.method, methodReason: d.methodReason, avgDailyDemand: d.avgDailyDemand, mlWape: d.mlWape, baselineWape: d.baselineWape, flags: d.flags } };
    },
  }),
  tool({
    name: "calculate_reorder_qty",
    description: "Reorder maths for one SKU at the chosen offer: reorder point, target, stock position, raw quantity, the quantity after pack-multiple and MOQ rounding, free packs from a scheme, and the reasons.",
    schema: z.object({ sku }),
    handler: async ({ sku }) => {
      const { analysis: a, sku: s } = await analyseSkuCode(sku);
      const offer = s.offers.find((o) => o.id === a.chosen?.offerId);
      return {
        data: {
          sku: a.sku,
          reorderPoint: a.reorderPoint,
          targetStock: a.targetStock,
          stockPosition: a.stockPosition,
          chosenSupplier: a.chosen?.supplierCode ?? null,
          moq: offer?.moq ?? null,
          packMultiple: offer?.packMultiple ?? null,
          qRaw: a.chosen?.order?.qRaw ?? null,
          qty: a.qty,
          freeQty: a.freeQty,
          reasons: a.reasons,
        },
      };
    },
  }),
  tool({
    name: "get_batches",
    description: "Batches of one SKU in first-expiry-first-out order with expiry, days to expiry, available, projected to sell and at-risk packs and value; plus batches not counted (quarantine, rejected, recalled, expired).",
    schema: z.object({ sku }),
    handler: async ({ sku }) => {
      const { analysis: a } = await analyseSkuCode(sku);
      const strip = <T extends { batchId: string }>({ batchId: _id, ...rest }: T) => (void _id, rest);
      return { data: { sku: a.sku, batches: a.expiry.batches.map(strip), notCounted: a.expiry.ineligible.map(strip) } };
    },
  }),
  tool({
    name: "calculate_expiry_exposure",
    description: "Stock that will expire before it sells: for one SKU, or (without sku) the 20 SKUs with the most ₹ at risk.",
    schema: z.object({ sku: sku.optional() }),
    handler: async ({ sku }) => {
      if (sku) {
        const { analysis: a } = await analyseSkuCode(sku);
        const batches = a.expiry.batches.filter((b) => b.atRiskQty > 0).map((b) => ({ batchNumber: b.batchNumber, expiryDate: b.expiryDate, atRiskQty: b.atRiskQty, atRiskValue: b.atRiskValue }));
        return { data: { sku: a.sku, atRiskQty: a.expiry.atRiskQty, atRiskValue: a.expiry.atRiskValue, batches } };
      }
      const top = await expiryExposureTop(20);
      return { data: top, refs: top.rows.slice(0, 5).map((r) => ({ type: "product", id: r.sku, label: `${r.sku} ${r.brandName}` })) };
    },
  }),
  tool({
    name: "get_return_policy",
    description: "Return policy (returnable, non-returnable, unknown) and quality status for every batch of one SKU.",
    schema: z.object({ sku }),
    handler: async ({ sku }) => {
      const { sku: s } = await analyseSkuCode(sku);
      return { data: { sku: s.product.sku, batches: s.batches.map((b) => ({ batchNumber: b.batchNumber, expiryDate: b.expiryDate, returnPolicy: b.returnPolicy, qualityStatus: b.qualityStatus })) } };
    },
  }),
  tool({
    name: "get_supplier_offers",
    description: "Every supplier offer for one SKU, including excluded ones with their exclusion codes: price, landed cost per pack, MOQ, pack multiple, availability, lead time, quote dates.",
    schema: z.object({ sku }),
    handler: async ({ sku }) => {
      const { analysis: a, sku: s } = await analyseSkuCode(sku);
      return {
        data: {
          sku: a.sku,
          offers: a.offers.map((e) => {
            const o = s.offers.find((x) => x.id === e.offerId)!;
            return { supplierCode: e.supplierCode, unitPrice: o.unitPrice, effectiveCost: e.effectiveCost, moq: o.moq, packMultiple: o.packMultiple, availableQty: o.availableQty, leadTimeDays: o.leadTimeDays, quotedAt: o.quotedAt.slice(0, 10), validUntil: o.validUntil.slice(0, 10), exclusions: e.exclusions };
          }),
        },
        refs: [{ type: "product", id: a.sku, label: a.sku }],
      };
    },
  }),
  tool({
    name: "compare_supplier_offers",
    description: "How the engine chose a supplier for one SKU: each eligible offer's factor scores (cost, lead time, reliability, terms) and total score, the winner, and the line's reasons and warnings.",
    schema: z.object({ sku }),
    handler: async ({ sku }) => {
      const { analysis: a } = await analyseSkuCode(sku);
      return {
        data: {
          sku: a.sku,
          weights: "score = 0.45 cost + 0.25 lead time + 0.20 reliability + 0.10 payment terms",
          offers: a.offers.filter((e) => e.score !== null).map((e) => ({ supplierCode: e.supplierCode, effectiveCost: e.effectiveCost, factors: e.factors, score: e.score, winner: e.offerId === a.chosen?.offerId })),
          excluded: a.offers.filter((e) => e.exclusions.length > 0).map((e) => ({ supplierCode: e.supplierCode, exclusions: e.exclusions })),
          winner: a.chosen?.supplierCode ?? null,
          reasons: a.reasons,
          warnings: a.warnings,
        },
      };
    },
  }),
  tool({
    name: "get_price_history",
    description: "Past purchase prices for one SKU: unit cost of received batches and unit prices on earlier purchase orders, newest first.",
    schema: z.object({ sku }),
    handler: async ({ sku }) => ({ data: await priceHistory(sku) }),
  }),
  tool({
    name: "get_po_projection",
    description: "The purchase order each supplier would get if every counted line of the plan were approved: lines, total, and whether it is above the Owner approval limit (₹4,00,000 by default).",
    schema: z.object({ planId }),
    handler: async ({ planId }) => {
      const p = await getPlan(planId);
      return {
        data: { planId, planTotal: p.proposedTotal, approvalLimit: p.approvalLimit, supplierPos: p.supplierPos.map((s) => ({ supplierCode: s.supplierCode, supplierName: s.supplierName, lines: s.lines, total: s.total, ownerApproval: s.needsApproval ? "required" : "not required" })) },
        refs: p.supplierPos.filter((s) => s.needsApproval).map((s) => ({ type: "supplier", id: s.supplierCode, label: `${s.supplierCode} ${s.supplierName}` })),
      };
    },
  }),
  tool({
    name: "get_plan",
    description: "A saved purchase plan: status, total, supplier POs and its lines (rank, line id, SKU, status, quantity, supplier, line total, reasons, PO number once approved).",
    schema: z.object({ planId }),
    handler: async ({ planId }) => {
      const p = await getPlan(planId);
      const lines = [...p.lines].sort((a, b) => Number(b.counted) - Number(a.counted) || a.rank - b.rank).slice(0, 40);
      return {
        data: {
          planId,
          status: p.status,
          planTotal: p.proposedTotal,
          approvalLimit: p.approvalLimit,
          supplierPos: p.supplierPos.map((s) => ({ supplierCode: s.supplierCode, lines: s.lines, total: s.total, ownerApproval: s.needsApproval ? "required" : "not required" })),
          lineCount: p.lines.length,
          lines: lines.map((l) => ({ rank: l.rank, lineId: l.id, sku: l.sku, brandName: l.brandName, strength: l.strength, skuStatus: l.skuStatus, lineStatus: l.status, counted: l.counted, qty: l.qty, freeQty: l.freeQty, supplierCode: l.supplierCode, coverDays: l.cover, lineTotal: l.totals.lineTotal, reasons: l.reasons, poNumber: l.poNumber })),
        },
        refs: [{ type: "plan", id: planId, label: "Purchase plan" }],
      };
    },
  }),
  tool({
    name: "build_plan_preview",
    description: "Preview only, NOT saved: the plan the engine would propose right now on fresh data and the active scenario (total, supplier POs, top lines, impact).",
    schema: z.object({}),
    handler: async () => ({ data: await planPreview() }),
  }),
  tool({
    name: "recalculate_plan",
    description: "Re-runs the engine on an open plan with fresh data and the active scenario, and saves the result (an audited change by the agent). Use only when the user asks to recalculate.",
    schema: z.object({ planId }),
    mutates: true,
    handler: async ({ planId }) => {
      const p = await recalculatePlan(planId, { actor: AGENT_ACTOR });
      return {
        data: { planId, status: p.status, planTotal: p.proposedTotal, supplierPos: p.supplierPos.map((s) => ({ supplierCode: s.supplierCode, lines: s.lines, total: s.total, ownerApproval: s.needsApproval ? "required" : "not required" })) },
        refs: [{ type: "plan", id: planId, label: "Recalculated plan" }],
      };
    },
  }),
  tool({
    name: "validate_po",
    description:
      "Checks plan lines against every hard stop (pack multiple, MOQ, availability, quote validity, approved supplier, recall) with fresh data. " +
      "Give qty to check a proposed quantity instead of the current one: it returns the line total and the supplier's PO total at that quantity. " +
      "Writes nothing: the user makes changes in the line's Edit dialog and approves with the Approve button.",
    schema: z.object({
      planId,
      lineIds: z.array(z.uuid()).min(1).max(50).describe("Line ids from get_plan"),
      qty: z.number().int().min(1).max(100000).optional().describe("Proposed quantity in packs to check (optional)"),
    }),
    handler: async ({ planId, lineIds, qty }) => {
      const p = await getPlan(planId);
      const lines = p.lines.filter((l) => lineIds.includes(l.id));
      if (lines.length === 0) throw new ServiceError("LINE_NOT_FOUND", 404, "None of those lines are in this plan.");
      const state = await resolvePlanningState();
      const ctx = await loadPlanningContext(getSql(), state.asOf, state.scenarioId, [...new Set(lines.map((l) => l.productId))], { excludePlanId: planId });
      const byId = new Map(ctx.skus.map((s) => [s.product.id, s]));
      return {
        data: {
          planId,
          // What the user does next; the agent cannot do any of it. Tell the user all four steps.
          nextStepsForUser: [
            "Nothing was changed: this was a check only.",
            "1. Change the quantity in the line's Edit dialog (PharmaOS AI cannot edit lines).",
            "2. Approve the line with the Approve button (PharmaOS AI cannot approve or create purchase orders).",
            `3. A supplier PO above ${formatINR(p.approvalLimit, { paise: false })} needs the Owner's approval before it can be sent.`,
            "4. Sending a PO is simulated: nothing leaves the app.",
          ],
          lines: lines.map((l) => {
            const s = byId.get(l.productId);
            const offer = s?.offers.find((o) => o.id === l.offerId);
            const checkQty = qty ?? l.qty;
            const stops = hardStops({ product: s?.product, offer, supplier: offer ? s?.suppliers[offer.supplierId] : undefined, qty: checkQty, asOf: state.asOf, batches: s?.batches ?? [] });
            const newLine = offer?.unitPrice ? lineTotals({ qty: checkQty, unitPrice: offer.unitPrice, taxRate: offer.taxRate, freightPerPack: offer.freightPerPack }).lineTotal : null;
            const po = p.supplierPos.find((x) => x.supplierId === l.supplierId);
            const newPoTotal = po && newLine && l.counted ? dec(po.total).minus(l.totals.lineTotal).plus(newLine).toFixed(2) : null;
            return {
              lineId: l.id,
              sku: l.sku,
              currentQty: l.qty,
              checkedQty: checkQty,
              supplierCode: l.supplierCode,
              moq: offer?.moq ?? null,
              packMultiple: offer?.packMultiple ?? null,
              availableQty: offer?.availableQty ?? null,
              currentLineTotal: l.totals.lineTotal,
              lineTotalAtCheckedQty: newLine,
              supplierPoTotalNow: po?.total ?? null,
              supplierPoTotalAtCheckedQty: newPoTotal,
              ownerApprovalAtCheckedQty: newPoTotal ? (needsOwnerApproval(newPoTotal, p.approvalLimit) ? "required" : "not required") : null,
              hardStops: stops,
              warnings: l.warnings,
              ok: stops.length === 0,
            };
          }),
        },
      };
    },
  }),
  tool({
    name: "get_bin_details",
    description: "One warehouse bin by code (e.g. C-L-03-2): location, capacity and fill, every SKU in it with batches, expiry and engine status.",
    schema: z.object({ binCode: z.string().trim().min(6).max(16).describe("Bin code like C-L-03-2") }),
    handler: async ({ binCode }) => {
      const b = await getBinDetails(await binIdForCode(binCode));
      return {
        data: { binCode: b.binCode, aisle: b.aisle, side: b.side, rack: b.rackNumber, shelf: b.shelf, storageClass: b.storageClass, capacity: b.capacityUnits, used: b.used, free: b.free, products: b.products.map((p) => ({ sku: p.sku, brandName: p.brandName, status: p.status, packs: p.packs, batches: p.batches.map((x) => ({ batchNumber: x.batchNumber, expiryDate: x.expiryDate, onHand: x.onHand, atRiskQty: x.atRiskQty, qualityStatus: x.qualityStatus })) })) },
        refs: [{ type: "bin", id: b.binCode, label: `Bin ${b.binCode}` }],
      };
    },
  }),
  tool({
    name: "get_heatmap_metrics",
    description: "The 20 most highlighted warehouse bins for a mode (stockout, expiry, excess, normal fill, or proposed put-away for the latest open plan), with severity 0–3, label and SKUs.",
    schema: z.object({ mode: z.enum(["stockout", "expiry", "excess", "normal", "proposed"]) }),
    handler: async ({ mode }) => {
      const plan = mode === "proposed" ? await getLatestOpenPlan() : null;
      if (mode === "proposed" && !plan) throw new ServiceError("NO_OPEN_PLAN", 404, "There is no open purchase plan to place proposed stock from.");
      const h = await getHeatmap(mode, plan?.id);
      const top = h.bins.filter((b) => b.severity > 0).sort((a, b) => b.severity - a.severity || a.binCode.localeCompare(b.binCode)).slice(0, 20);
      return {
        data: { mode, asOf: h.asOf, highlighted: h.bins.filter((b) => b.severity > 0).length, totalBins: h.bins.length, bins: top.map((b) => ({ binCode: b.binCode, severity: b.severity, label: b.label, skus: b.skus })), unmapped: h.unmapped, capacityReview: h.capacityReview },
        refs: top.slice(0, 5).map((b) => ({ type: "bin", id: b.binCode, label: `Bin ${b.binCode}` })),
      };
    },
  }),
  tool({
    name: "suggest_candidate_bin",
    description: "Where N packs of a SKU would be put away: an active bin of the right storage class with room, preferring a bin already holding the SKU, then the same aisle, then the lowest code; or CAPACITY_REVIEW when nothing fits.",
    schema: z.object({ sku, packs: z.number().int().min(1).max(100000) }),
    handler: async ({ sku, packs }) => {
      const [{ sku: s }, layout] = await Promise.all([analyseSkuCode(sku), getLayout()]);
      const holding = new Set(s.balances.filter((b) => b.locationId && b.onHandQty > 0).map((b) => b.locationId!));
      const bins: PutawayBin[] = layout.bins.map((b) => ({ ...b, productIds: holding.has(b.id) ? [s.product.id] : [] }));
      const r = candidateBin({ productId: s.product.id, storageClass: s.product.storageClass, packs }, bins);
      return { data: { sku: s.product.sku, storageClass: s.product.storageClass, ...r }, refs: r.binCode ? [{ type: "bin", id: r.binCode, label: `Bin ${r.binCode}` }] : [] };
    },
  }),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** A tool's handler, for the pipeline agents that share a tool with Ask PharmaOS (data only, no ToolResult wrapper). */
export async function callToolHandler(name: string, args: unknown): Promise<unknown> {
  const t = BY_NAME.get(name);
  if (!t) throw new ServiceError("INVALID_TOOL_INPUT", 400, `Unknown tool ${name}.`);
  const parsed = t.schema.safeParse(args);
  if (!parsed.success) throw new ServiceError("INVALID_TOOL_INPUT", 400, parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  return (await t.handler(parsed.data as never)).data;
}

/** Gemini declarations: name, description and the Zod schema as JSON Schema (without the $schema keyword). */
export const FUNCTION_DECLARATIONS: FunctionDeclaration[] = TOOLS.map((t) => {
  const { $schema: _drop, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
  void _drop;
  return { name: t.name, description: t.description, parametersJsonSchema: schema };
});

export type ToolRun = { name: string; ok: boolean; ms: number; mutates: boolean; result: ToolResult<unknown>; refs: Reference[] };

/** Runs one model-requested call: allow-list, Zod re-validation of the (untrusted) arguments, then the handler. */
export async function runTool(name: string | undefined, args: unknown): Promise<ToolRun> {
  const t0 = performance.now();
  const def = name ? BY_NAME.get(name) : undefined;
  const done = (result: ToolResult<unknown>, refs: Reference[] = []): ToolRun => ({ name: name ?? "?", ok: result.ok, ms: Math.round(performance.now() - t0), mutates: !!def?.mutates, result, refs });
  if (!def) return done(toolError("INVALID_TOOL_INPUT", `Unknown tool ${name ?? ""}. Only the listed tools exist.`));
  const parsed = def.schema.safeParse(args ?? {});
  if (!parsed.success) return done(toolError("INVALID_TOOL_INPUT", parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")));
  try {
    const out = await def.handler(parsed.data as never);
    return done(toolOk(out.data), out.refs ?? []);
  } catch (err) {
    if (err instanceof ServiceError) return done(toolError(err.code, err.message));
    console.error(`[agent tool ${name}]`, err);
    return done(toolError("TOOL_FAILED", "The tool failed while reading data. Try again or ask something else."));
  }
}
