// §6.12 — analyseSku() and buildPlan(): compose the modules above. Pure and deterministic:
// no I/O, no clock, no randomness; the same context always gives the same result.
import { dec, sumMoney } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { addDays, daysBetween } from "./dates";
import { computeDemand } from "./demand";
import { projectExpiry } from "./expiry";
import { computeImpact } from "./impact";
import { ON_ORDER_STATUSES, bridgeQuantity, confirmedIncoming, coverDays, daysUntilReorder, reorderPoint, runOutDays, safetyStock, skuStatus, stockPosition, targetStock } from "./inventory";
import { applyScheme, isCandidate, orderQuantity, roundToPackRules } from "./ordering";
import { comparePriority, criticalityWeight, lossPrevented, priorityScore } from "./priority";
import { applyUrgencyRule, effectiveUnitCost, offerExclusions, priceAnomalies, scoreOffers } from "./supplier-scoring";
import { lineTotals, supplierTotals } from "./totals";
import type {
  Money,
  OfferEvaluation,
  OfferInput,
  PlanLine,
  PlanResult,
  PlanningContext,
  ReasonCode,
  SchemeDecision,
  SkuAnalysis,
  SkuContext,
} from "./types";
import { hardStops, softWarnings } from "./validation";

const noScheme = (q: number): SchemeDecision => ({ taken: false, qty: q, freeQty: 0, reason: null, warning: null, expiryAvoidedValue: "0.00" });

/** Per-offer working values kept alongside the public OfferEvaluation. */
type Working = {
  offer: OfferInput;
  evaluation: OfferEvaluation;
  baseCost: Money | null; // effective cost without a scheme
};

export function analyseSku(sku: SkuContext, config: EngineConfig = ENGINE_CONFIG): SkuAnalysis {
  const { asOf, product } = sku;

  // 1. Demand, expiry, stock position.
  const demand = computeDemand(sku.sales, asOf, sku.firstSaleDate, config, sku.forecast);
  const dbar = demand.avgDailyDemand;
  const expiry = projectExpiry({ batches: sku.batches, balances: sku.balances, avgDailyDemand: dbar, asOf }, config);
  const incomingQty = confirmedIncoming(sku.incoming, asOf, config);
  const position = stockPosition(expiry.eligibleAvailable, incomingQty);
  // Cover = days until the shelf is empty, with each PO counted on its delivery day. Quantities still use the
  // position (everything on order counts), so nothing already ordered is bought again.
  const cover = runOutDays(expiry.eligibleAvailable, sku.incoming, dbar, asOf, config);
  const positionCover = coverDays(position, dbar);
  const horizonEnd = addDays(asOf, config.planningHorizonDays);
  const nextArrival =
    sku.incoming
      .filter((i) => (ON_ORDER_STATUSES as readonly string[]).includes(i.status) && i.expectedDeliveryDate <= horizonEnd)
      .sort((a, b) => (a.expectedDeliveryDate < b.expectedDeliveryDate ? -1 : 1))[0] ?? null;
  // Stock runs out before the next PO arrives: a gap the existing order does not close.
  const shortBeforeDelivery =
    cover !== null && nextArrival !== null && cover < Math.max(0, daysBetween(asOf, nextArrival.expectedDeliveryDate));
  const hasAtRisk = expiry.batches.some((b) => b.atRiskQty > 0);

  // 2. Offers usable before quantity is known (availability is checked per offer below).
  const supplierOf = (o: OfferInput) => sku.suppliers[o.supplierId];
  const preExclusions = new Map(
    sku.offers.map((o) => [o.id, offerExclusions({ offer: o, supplier: supplierOf(o), productId: product.id, asOf, qty: 0 }, config)]),
  );
  const usable = sku.offers.filter((o) => preExclusions.get(o.id)!.length === 0);
  // Fastest usable offer; with none, the suppliers' default lead time (status only), else the review period.
  const defaultLeads = sku.offers.map((o) => supplierOf(o)?.defaultLeadTimeDays).filter((n): n is number => typeof n === "number");
  const leadFastest = usable.length
    ? Math.min(...usable.map((o) => o.leadTimeDays))
    : defaultLeads.length
      ? Math.min(...defaultLeads)
      : config.reviewPeriodDays;
  const status = skuStatus({ avgDailyDemand: dbar, stockPosition: position, leadFastest, cover, shortBeforeDelivery }, config);
  const rop = reorderPoint(dbar, leadFastest, config);
  const target = targetStock(dbar, leadFastest, config);
  const belowRop = isCandidate({ avgDailyDemand: dbar, stockPosition: position, leadFastest }, config);
  // Enough on order overall, but the shelf empties before that PO arrives: a bridge top-up (only the gap days)
  // from a supplier that delivers before the PO, so the medicine is not out of stock in between.
  const arrivalDay = nextArrival ? Math.max(0, daysBetween(asOf, nextArrival.expectedDeliveryDate)) : 0;
  const bridge = !belowRop && shortBeforeDelivery && cover !== null && leadFastest < arrivalDay;
  const needsStock = belowRop || bridge;
  // At-risk batches cap the order at ROP (EXPIRY_REDUCED_QTY) — except on stockout-risk lines:
  // a medicine about to run out is never under-ordered, and under FEFO the new, long-dated stock
  // sells after the old batch, so ordering less would not save that batch anyway.
  const reduceForExpiry = hasAtRisk && status !== "STOCKOUT_RISK";
  const reasons: ReasonCode[] = [];

  // 3. Evaluate every offer.
  const working: Working[] = sku.offers.map((offer) => {
    const supplier = supplierOf(offer);
    const evaluation: OfferEvaluation = {
      offerId: offer.id,
      supplierId: offer.supplierId,
      supplierCode: supplier?.code ?? "",
      exclusions: [...preExclusions.get(offer.id)!],
      order: null,
      scheme: null,
      effectiveCost: null,
      totals: null,
      factors: null,
      score: null,
    };
    const w: Working = { offer, evaluation, baseCost: null };
    if (!needsStock || evaluation.exclusions.length > 0 || offer.unitPrice === null) return w;

    const order = bridge
      ? (() => {
          const qRaw = bridgeQuantity({ avgDailyDemand: dbar, cover: cover!, arrivalDay, leadTimeDays: offer.leadTimeDays });
          return { qRaw, q: roundToPackRules(qRaw, offer.moq, offer.packMultiple), reasons: [] };
        })()
      : orderQuantity(
          { avgDailyDemand: dbar, stockPosition: position, leadTimeDays: offer.leadTimeDays, moq: offer.moq, packMultiple: offer.packMultiple, hasAtRiskBatches: reduceForExpiry },
          config,
        );
    evaluation.order = order;
    if (order.q <= 0) return w;

    const costArgs = { unitPrice: offer.unitPrice, taxRate: offer.taxRate, freightPerPack: offer.freightPerPack, schemePaidQty: offer.schemePaidQty, schemeFreeQty: offer.schemeFreeQty };
    w.baseCost = effectiveUnitCost({ ...costArgs, schemeTaken: false });
    let scheme =
      offer.schemePaidQty && offer.schemeFreeQty
        ? applyScheme(
            {
              q: order.q,
              packMultiple: offer.packMultiple,
              schemePaidQty: offer.schemePaidQty,
              schemeFreeQty: offer.schemeFreeQty,
              stockPosition: position,
              avgDailyDemand: dbar,
              shelfLifeDays: product.shelfLifeDays,
              effectiveUnitCost: w.baseCost,
            },
            config,
          )
        : noScheme(order.q);
    // A scheme quantity the supplier cannot supply falls back to the base quantity.
    if (scheme.qty > offer.availableQty && order.q <= offer.availableQty) scheme = noScheme(order.q);
    evaluation.scheme = scheme;

    const availability = offerExclusions({ offer, supplier, productId: product.id, asOf, qty: scheme.qty }, config);
    if (availability.length > 0) {
      evaluation.exclusions = availability;
      return w;
    }
    evaluation.effectiveCost = effectiveUnitCost({ ...costArgs, schemeTaken: scheme.taken });
    evaluation.totals = lineTotals({ qty: scheme.qty, unitPrice: offer.unitPrice, taxRate: offer.taxRate, freightPerPack: offer.freightPerPack });
    return w;
  });

  // 4. Urgency rule, score, chosen offer.
  const priced = working.filter((w) => w.evaluation.exclusions.length === 0 && w.evaluation.totals && w.evaluation.effectiveCost);
  const urgency = applyUrgencyRule(
    priced.map((w) => ({ offerId: w.offer.id, leadTimeDays: w.offer.leadTimeDays, effectiveCost: w.evaluation.effectiveCost! })),
    cover,
  );
  for (const d of urgency.dropped) working.find((w) => w.offer.id === d.offerId)!.evaluation.exclusions.push(d.code);
  const kept = priced.filter((w) => urgency.kept.includes(w.offer.id));
  const ranked = scoreOffers(
    kept.map((w) => {
      const s = supplierOf(w.offer);
      return {
        offerId: w.offer.id,
        supplierCode: s?.code ?? "",
        effectiveCost: w.evaluation.effectiveCost!,
        leadTimeDays: w.offer.leadTimeDays,
        reliabilityScore: s?.reliabilityScore ?? null,
        paymentTermsDays: s?.paymentTermsDays ?? null,
      };
    }),
    config,
  );
  for (const r of ranked) {
    const ev = working.find((w) => w.offer.id === r.offerId)!.evaluation;
    ev.factors = r.factors;
    ev.score = r.score;
  }
  const chosenWork = ranked.length ? working.find((w) => w.offer.id === ranked[0].offerId)! : null;
  const chosen = chosenWork?.evaluation ?? null;
  const candidate = needsStock && chosen !== null;

  // 5. Reasons, money, warnings.
  if (belowRop) reasons.push("BELOW_REORDER_POINT");
  if (bridge && chosen) reasons.push("BRIDGE_UNTIL_DELIVERY");
  if (belowRop && !chosen) reasons.push("NO_ELIGIBLE_OFFER");
  if (candidate) reasons.push(...urgency.lineReasons);
  if (chosen?.order) reasons.push(...chosen.order.reasons);
  if (chosen?.scheme?.reason) reasons.push(chosen.scheme.reason);

  const qty = chosen?.scheme?.qty ?? 0;
  const freeQty = chosen?.scheme?.freeQty ?? 0;
  // A bridge prevents the gap days it covers (stock-out from max(cover, L) until the PO arrives); a normal order
  // the shortfall before its own delivery.
  const loss =
    candidate && chosenWork
      ? bridge
        ? lossPrevented({ leadTimeDays: arrivalDay, cover: Math.max(cover!, chosenWork.offer.leadTimeDays), avgDailyDemand: dbar, unitMargin: product.unitMargin, criticality: product.criticality }, config)
        : lossPrevented({ leadTimeDays: chosenWork.offer.leadTimeDays, cover, avgDailyDemand: dbar, unitMargin: product.unitMargin, criticality: product.criticality }, config)
      : "0.00";
  const priority = chosen?.totals ? priorityScore(loss, chosen.totals.lineTotal) : 0;

  // Expiry avoided counts only a skipped scheme: the extra packs not bought would have expired unsold.
  const expiryAvoidedValue = dec(chosen?.scheme?.reason === "SCHEME_SKIPPED_EXPIRY" ? chosen.scheme.expiryAvoidedValue : 0);

  const anomalous = priceAnomalies(sku.offers.filter((o) => o.unitPrice !== null).map((o) => ({ offerId: o.id, unitPrice: o.unitPrice! })));
  const warnings = softWarnings({
    hasAtRiskBatches: hasAtRisk,
    chosenIsTopScored: true, // the engine always picks the top score; NOT_TOP_SUPPLIER comes from user edits
    demandFlags: demand.flags,
    schemeWarning: chosen?.scheme?.warning ?? null,
    priceAnomaly: chosen !== null && anomalous.includes(chosen.offerId),
    capacityReview: false, // set by the warehouse put-away check (stage 5)
    hasUnmappedStock: sku.balances.some((b) => b.locationId === null && b.onHandQty > 0),
  });
  const stops = chosenWork
    ? hardStops({ product, offer: chosenWork.offer, supplier: supplierOf(chosenWork.offer), qty, asOf, batches: sku.batches }, config)
    : [];
  const totals = chosen?.totals ?? null;

  // 6. Evidence: every input and intermediate, JSON-safe, for evidence_json.
  const eligibleBatchIds = new Set(expiry.batches.map((b) => b.batchId));
  // The engine config is stored once per plan (assumptions_json), not on every line.
  const evidence = {
    asOf,
    product,
    demand,
    expiry,
    incoming: { lines: sku.incoming, confirmedQty: incomingQty, horizonDays: config.planningHorizonDays },
    stock: {
      eligibleAvailable: expiry.eligibleAvailable,
      // On hand and reserved across the eligible (FEFO) batches; available = on hand − reserved.
      onHand: sku.balances.filter((b) => eligibleBatchIds.has(b.batchId)).reduce((n, b) => n + b.onHandQty, 0),
      reserved: sku.balances.filter((b) => eligibleBatchIds.has(b.batchId)).reduce((n, b) => n + b.reservedQty, 0),
      incoming: incomingQty,
      stockPosition: position,
      cover,
      positionCover,
      nextArrival: nextArrival ? { poId: nextArrival.poId, poNumber: nextArrival.poNumber ?? null, date: nextArrival.expectedDeliveryDate, qty: nextArrival.quantityPacks + nextArrival.freeQty } : null,
      shortBeforeDelivery,
    },
    policy: { leadFastest, safetyStock: safetyStock(dbar, config), reorderPoint: rop, targetStock: target, needsStock, bridge, arrivalDay: nextArrival ? arrivalDay : null },
    offers: working.map((w) => ({
      ...w.evaluation,
      leadTimeDays: w.offer.leadTimeDays,
      unitPrice: w.offer.unitPrice,
      taxRate: w.offer.taxRate,
      freightPerPack: w.offer.freightPerPack,
      moq: w.offer.moq,
      packMultiple: w.offer.packMultiple,
      availableQty: w.offer.availableQty,
      scheme: w.offer.schemePaidQty ? `${w.offer.schemePaidQty}+${w.offer.schemeFreeQty}` : null,
      schemeDecision: w.evaluation.scheme,
      quotedAt: w.offer.quotedAt,
      validUntil: w.offer.validUntil,
      supplierName: supplierOf(w.offer)?.name ?? null,
      reliabilityScore: supplierOf(w.offer)?.reliabilityScore ?? null,
      paymentTermsDays: supplierOf(w.offer)?.paymentTermsDays ?? null,
      priceAnomaly: anomalous.includes(w.offer.id),
    })),
    urgency,
    chosenOfferId: chosen?.offerId ?? null,
    qty,
    freeQty,
    totals,
    lossPrevented: loss,
    expiryAvoidedValue: expiryAvoidedValue.toFixed(2),
    priority,
    reasons,
    warnings,
    hardStops: stops,
  };

  return {
    productId: product.id,
    sku: product.sku,
    status,
    demand,
    expiry,
    incomingQty,
    stockPosition: position,
    cover,
    shortBeforeDelivery,
    nextArrival: nextArrival ? { poId: nextArrival.poId, poNumber: nextArrival.poNumber ?? null, date: nextArrival.expectedDeliveryDate } : null,
    leadFastest,
    reorderPoint: rop,
    targetStock: target,
    reorderInDays: daysUntilReorder(position, dbar, rop),
    candidate,
    offers: working.map((w) => w.evaluation),
    chosen,
    qty,
    freeQty,
    totals,
    lossPrevented: loss,
    expiryAvoidedValue: expiryAvoidedValue.toFixed(2),
    priority,
    reasons,
    warnings,
    hardStops: stops,
    evidence: JSON.parse(JSON.stringify(evidence)) as Record<string, unknown>,
  };
}

/**
 * The plan: every SKU that needs stock and has an eligible offer, at the engine's quantity, ranked by
 * priority (§6.8); then SKUs that need stock but have no eligible offer. There is no budget cap —
 * spend is controlled per purchase order by the Owner approval limit (projected in `supplierTotals`).
 */
export function buildPlan(ctx: PlanningContext, config: EngineConfig = ENGINE_CONFIG): PlanResult {
  const analyses = ctx.skus
    .filter((s) => s.product.isActive)
    .map((s) => ({ ctx: s, a: analyseSku(s, config) }));

  // Candidates in the deterministic priority order (§6.8).
  const candidates = analyses
    .filter(({ a }) => a.candidate && a.chosen?.totals)
    .sort((x, y) =>
      comparePriority(
        { key: x.a.sku, priority: x.a.priority, cover: x.a.cover, criticalityWeight: criticalityWeight(x.ctx.product.criticality, config) },
        { key: y.a.sku, priority: y.a.priority, cover: y.a.cover, criticalityWeight: criticalityWeight(y.ctx.product.criticality, config) },
      ),
    );

  const lines: PlanLine[] = candidates.map(({ ctx: s, a }, i) => {
    const offer = s.offers.find((o) => o.id === a.chosen!.offerId)!;
    return {
      productId: a.productId,
      sku: a.sku,
      rank: i + 1,
      status: a.status,
      cover: a.cover,
      offerId: offer.id,
      supplierId: offer.supplierId,
      qty: a.qty,
      freeQty: a.freeQty,
      unitPrice: offer.unitPrice,
      totals: a.totals,
      lossPrevented: a.lossPrevented,
      expiryAvoidedValue: a.expiryAvoidedValue,
      priority: a.priority,
      inBasket: true,
      reasons: a.reasons,
      warnings: a.warnings,
      evidence: a.evidence,
    };
  });

  // SKUs that need stock but have no eligible offer: shown (never bought) so the owner sees them.
  const noOffer = analyses.filter(({ a }) => !a.candidate && a.reasons.includes("NO_ELIGIBLE_OFFER"));
  noOffer
    .sort((x, y) => x.a.sku.localeCompare(y.a.sku))
    .forEach(({ a }) =>
      lines.push({
        productId: a.productId,
        sku: a.sku,
        rank: lines.length + 1,
        status: a.status,
        cover: a.cover,
        offerId: null,
        supplierId: null,
        qty: 0,
        freeQty: 0,
        unitPrice: null,
        totals: null,
        lossPrevented: "0.00",
        expiryAvoidedValue: "0.00",
        priority: 0,
        inBasket: false,
        reasons: a.reasons,
        warnings: a.warnings,
        evidence: a.evidence,
      }),
    );

  const included = lines.filter((l) => l.inBasket && l.totals);
  const planTotal = sumMoney(included.map((l) => l.totals!.lineTotal)).toFixed(2);
  const suppliers = supplierTotals(
    included.map((l) => ({ supplierId: l.supplierId, lineTotal: l.totals!.lineTotal, inBasket: true, status: "proposed" as const })),
    config.poApprovalLimit,
  );
  const skuStatuses = analyses.map(({ a }) => ({ productId: a.productId, sku: a.sku, status: a.status, atRiskValue: a.expiry.atRiskValue }));
  const impact = computeImpact({
    skus: skuStatuses,
    lines: lines.map((l) => ({
      status: l.status,
      inBasket: l.inBasket,
      lossPrevented: l.lossPrevented,
      totals: l.totals,
      reasons: l.reasons,
      expiryAvoidedValue: l.expiryAvoidedValue,
    })),
    supplierTotals: suppliers,
  });

  return {
    asOf: ctx.asOf,
    lines,
    skuStatuses,
    planTotal,
    approvalLimit: config.poApprovalLimit,
    supplierTotals: suppliers,
    impact,
  };
}
