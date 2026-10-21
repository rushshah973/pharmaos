// §6.12 — analyseSku() and buildPlan(): compose the modules above. Pure and deterministic:
// no I/O, no clock, no randomness; the same context always gives the same result.
import { dec, roundMoney } from "@/lib/money";
import { buildBasket } from "./basket";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { computeDemand } from "./demand";
import { projectExpiry } from "./expiry";
import { computeImpact } from "./impact";
import { confirmedIncoming, coverDays, reorderPoint, safetyStock, skuStatus, stockPosition, targetStock } from "./inventory";
import { applyScheme, isCandidate, orderQuantity } from "./ordering";
import { comparePriority, criticalityWeight, lossPrevented, priorityScore } from "./priority";
import { applyUrgencyRule, effectiveUnitCost, offerExclusions, priceAnomalies, scoreOffers } from "./supplier-scoring";
import { budgetRemaining, lineTotals } from "./totals";
import type {
  BasketCandidate,
  BasketOption,
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
  fullQty: number | null; // quantity if expiry did not reduce it
};

export function analyseSku(sku: SkuContext, config: EngineConfig = ENGINE_CONFIG): SkuAnalysis {
  const { asOf, product } = sku;

  // 1. Demand, expiry, stock position.
  const demand = computeDemand(sku.sales, asOf, sku.firstSaleDate, config);
  const dbar = demand.avgDailyDemand;
  const expiry = projectExpiry({ batches: sku.batches, balances: sku.balances, avgDailyDemand: dbar, asOf }, config);
  const incomingQty = confirmedIncoming(sku.incoming, asOf, config);
  const position = stockPosition(expiry.eligibleAvailable, incomingQty);
  const cover = coverDays(position, dbar);
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
  const status = skuStatus({ avgDailyDemand: dbar, stockPosition: position, leadFastest }, config);
  const rop = reorderPoint(dbar, leadFastest, config);
  const target = targetStock(dbar, leadFastest, config);
  const needsStock = isCandidate({ avgDailyDemand: dbar, stockPosition: position, leadFastest }, config);
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
    const w: Working = { offer, evaluation, baseCost: null, fullQty: null };
    if (!needsStock || evaluation.exclusions.length > 0 || offer.unitPrice === null) return w;

    const order = orderQuantity(
      { avgDailyDemand: dbar, stockPosition: position, leadTimeDays: offer.leadTimeDays, moq: offer.moq, packMultiple: offer.packMultiple, hasAtRiskBatches: hasAtRisk },
      config,
    );
    w.fullQty = hasAtRisk
      ? orderQuantity(
          { avgDailyDemand: dbar, stockPosition: position, leadTimeDays: offer.leadTimeDays, moq: offer.moq, packMultiple: offer.packMultiple, hasAtRiskBatches: false },
          config,
        ).q
      : order.q;
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
  if (needsStock) reasons.push("BELOW_REORDER_POINT");
  if (needsStock && !chosen) reasons.push("NO_ELIGIBLE_OFFER");
  if (candidate) reasons.push(...urgency.lineReasons);
  if (chosen?.order) reasons.push(...chosen.order.reasons);
  if (chosen?.scheme?.reason) reasons.push(chosen.scheme.reason);

  const qty = chosen?.scheme?.qty ?? 0;
  const freeQty = chosen?.scheme?.freeQty ?? 0;
  const loss =
    candidate && chosenWork
      ? lossPrevented({ leadTimeDays: chosenWork.offer.leadTimeDays, cover, avgDailyDemand: dbar, unitMargin: product.unitMargin, criticality: product.criticality }, config)
      : "0.00";
  const priority = chosen?.totals ? priorityScore(loss, chosen.totals.lineTotal) : 0;

  let expiryAvoidedValue = dec(0);
  if (chosen?.scheme?.reason === "SCHEME_SKIPPED_EXPIRY") expiryAvoidedValue = expiryAvoidedValue.plus(chosen.scheme.expiryAvoidedValue);
  if (chosenWork && chosen?.order?.reasons.includes("EXPIRY_REDUCED_QTY") && chosenWork.fullQty !== null && chosenWork.baseCost) {
    const notBought = chosenWork.fullQty - chosen.order.q;
    if (notBought > 0) expiryAvoidedValue = expiryAvoidedValue.plus(roundMoney(dec(notBought).times(chosenWork.baseCost)));
  }

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
  const evidence = {
    asOf,
    config,
    product,
    demand,
    expiry,
    incoming: { lines: sku.incoming, confirmedQty: incomingQty, horizonDays: config.planningHorizonDays },
    stock: { eligibleAvailable: expiry.eligibleAvailable, incoming: incomingQty, stockPosition: position, cover },
    policy: { leadFastest, safetyStock: safetyStock(dbar, config), reorderPoint: rop, targetStock: target, needsStock },
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
      fullQty: w.fullQty,
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
    leadFastest,
    reorderPoint: rop,
    targetStock: target,
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

/** The priced option for an evaluated offer (used as the basket option or an alternative). */
function toOption(offer: OfferInput, ev: OfferEvaluation): BasketOption {
  return {
    offerId: offer.id,
    qty: ev.scheme!.qty,
    freeQty: ev.scheme!.freeQty,
    unitPrice: offer.unitPrice!,
    taxRate: offer.taxRate,
    freightPerPack: offer.freightPerPack,
    moq: offer.moq,
    packMultiple: offer.packMultiple,
    lineTotal: ev.totals!.lineTotal,
    schemePaidQty: ev.scheme!.taken ? offer.schemePaidQty : null,
    schemeFreeQty: ev.scheme!.taken ? offer.schemeFreeQty : null,
  };
}

export function buildPlan(ctx: PlanningContext, budget: Money, config: EngineConfig = ENGINE_CONFIG): PlanResult {
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

  const basketInput: BasketCandidate[] = candidates.map(({ ctx: s, a }) => {
    const offerById = new Map(s.offers.map((o) => [o.id, o]));
    const scored = a.offers
      .filter((ev) => ev.score !== null && ev.totals && ev.scheme)
      .sort((p, q) => q.score! - p.score! || p.offerId.localeCompare(q.offerId));
    const ordered = [a.chosen!, ...scored.filter((ev) => ev.offerId !== a.chosen!.offerId)];
    const options = ordered.map((ev) => toOption(offerById.get(ev.offerId)!, ev));
    return {
      key: a.sku,
      priority: a.priority,
      cover: a.cover,
      criticalityWeight: criticalityWeight(s.product.criticality, config),
      option: options[0],
      alternatives: options.slice(1),
    };
  });
  const basket = buildBasket(basketInput, budget);

  const lines: PlanLine[] = candidates.map(({ ctx: s, a }, i) => {
    const b = basket.lines[i];
    const offer = s.offers.find((o) => o.id === b.option.offerId)!;
    const totals = lineTotals({ qty: b.option.qty, unitPrice: b.option.unitPrice, taxRate: b.option.taxRate, freightPerPack: b.option.freightPerPack });
    return {
      productId: a.productId,
      sku: a.sku,
      rank: i + 1,
      status: a.status,
      cover: a.cover,
      offerId: offer.id,
      supplierId: offer.supplierId,
      qty: b.option.qty,
      freeQty: b.option.freeQty,
      unitPrice: b.option.unitPrice,
      totals,
      lossPrevented: a.lossPrevented,
      expiryAvoidedValue: a.expiryAvoidedValue,
      priority: a.priority,
      inBasket: b.inBasket,
      reasons: [...a.reasons, ...b.reasons],
      warnings: a.warnings,
      evidence: { ...a.evidence, basket: { inBasket: b.inBasket, reasons: b.reasons, option: b.option } },
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
    budget,
  });

  return {
    asOf: ctx.asOf,
    budget: dec(budget).toFixed(2),
    lines,
    skuStatuses,
    planTotal: basket.total,
    budgetRemaining: budgetRemaining(budget, basket.total),
    impact,
  };
}
