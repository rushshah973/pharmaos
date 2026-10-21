// The line drawer's data (implementationplan.md §10.3, architecture.md §6.4): everything comes from the
// line's evidence_json, read into typed sections. Formulas are re-stated with the engine's own functions,
// so nothing is computed differently for display.
import { ENGINE_CONFIG } from "@/lib/business-logic/config";
import { safetyStock, targetStock, reorderPoint } from "@/lib/business-logic/inventory";
import { criticalityWeight } from "@/lib/business-logic/priority";
import type {
  BatchProjection,
  Criticality,
  IneligibleBatch,
  LineTotals,
  Money,
  OfferExclusionCode,
  ProductInput,
  SalesPoint,
  ScoreFactors,
  SchemeDecision,
  WarningCode,
} from "@/lib/business-logic/types";
import { dec, formatINR } from "@/lib/money";
import { getLine, type LineView } from "./plans";

type EvidenceOffer = {
  offerId: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string | null;
  exclusions: OfferExclusionCode[];
  order: { qRaw: number; q: number } | null;
  schemeDecision: SchemeDecision | null;
  scheme: string | null; // "10+1"
  effectiveCost: Money | null;
  totals: LineTotals | null;
  factors: ScoreFactors | null;
  score: number | null;
  leadTimeDays: number;
  unitPrice: Money | null;
  taxRate: Money;
  freightPerPack: Money;
  moq: number;
  packMultiple: number;
  availableQty: number;
  quotedAt: string;
  validUntil: string;
  reliabilityScore: number | null;
  paymentTermsDays: number | null;
  priceAnomaly: boolean;
};

type Evidence = {
  asOf: string;
  product: ProductInput;
  demand: { d7: number; d28: number; avgDailyDemand: number; flags: WarningCode[]; dailySeries: SalesPoint[] };
  expiry: { batches: BatchProjection[]; eligibleAvailable: number; atRiskQty: number; atRiskValue: Money; ineligible: IneligibleBatch[] };
  incoming: { lines: { poId: string; status: string; expectedDeliveryDate: string; quantityPacks: number; freeQty: number }[]; confirmedQty: number; horizonDays: number };
  stock: { eligibleAvailable: number; onHand?: number; reserved?: number; incoming: number; stockPosition: number; cover: number | null };
  policy: { leadFastest: number; safetyStock: number; reorderPoint: number; targetStock: number; needsStock: boolean };
  offers: EvidenceOffer[];
  chosenOfferId: string | null;
  qty: number;
  freeQty: number;
  totals: LineTotals | null;
  lossPrevented: Money;
  priority: number;
  reasons: string[];
  skuStatus?: string;
  userEdit?: { qty: number; offerId: string };
};

export type OfferRow = {
  offerId: string;
  supplierCode: string;
  supplierName: string | null;
  unitPrice: Money | null;
  effectiveCost: Money | null;
  leadTimeDays: number;
  moq: number;
  packMultiple: number;
  availableQty: number;
  scheme: string | null;
  factors: ScoreFactors | null;
  score: number | null;
  exclusions: OfferExclusionCode[];
  quotedAt: string;
  validUntil: string;
  priceAnomaly: boolean;
  /** The engine's pick. */
  winner: boolean;
  /** What the line uses now (the engine's pick, or the owner's). */
  selected: boolean;
  /** Can be chosen in the drawer (a slower or short-stocked offer is allowed; the server re-checks). */
  selectable: boolean;
  /** Packs the engine would buy from this offer. */
  engineQty: number | null;
};

export type Formula = { label: string; expr: string; subst: string; result: string };

export type LineDetail = {
  line: LineView;
  dataSource: string;
  asOf: string;
  product: { brandName: string; genericName: string; strength: string; dosageForm: string; packSize: number; manufacturer: string; category: string; storageClass: string; criticality: Criticality; shelfLifeDays: number };
  demand: Evidence["demand"];
  stock: { onHand: number | null; reserved: number | null; available: number; incoming: number; incomingLines: Evidence["incoming"]["lines"]; horizonDays: number; position: number; cover: number | null; ineligible: IneligibleBatch[] };
  policy: { leadFastest: number; safetyStock: number; reorderPoint: number; targetStock: number };
  batches: BatchProjection[];
  atRiskValue: Money;
  offers: OfferRow[];
  formulas: Formula[];
  engine: { qty: number; freeQty: number; offerId: string | null; lineTotal: Money | null };
};

const n2 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2));
const n1 = (x: number) => x.toFixed(1);
const rupees = (x: Money | number) => formatINR(dec(x).toFixed(2));
const BLOCKING: ReadonlySet<OfferExclusionCode> = new Set(["TOO_SLOW_FOR_COVER", "INSUFFICIENT_AVAILABILITY"]);

export async function getLineDetail(planId: string, lineId: string): Promise<LineDetail> {
  const line = await getLine(planId, lineId);
  const ev = line.evidence as unknown as Evidence;
  const p = ev.product;
  const offers: OfferRow[] = (ev.offers ?? [])
    .map((o) => ({
      offerId: o.offerId,
      supplierCode: o.supplierCode,
      supplierName: o.supplierName,
      unitPrice: o.unitPrice,
      effectiveCost: o.effectiveCost,
      leadTimeDays: o.leadTimeDays,
      moq: o.moq,
      packMultiple: o.packMultiple,
      availableQty: o.availableQty,
      scheme: o.scheme,
      factors: o.factors,
      score: o.score,
      exclusions: o.exclusions,
      quotedAt: o.quotedAt,
      validUntil: o.validUntil,
      priceAnomaly: o.priceAnomaly,
      winner: o.offerId === ev.chosenOfferId,
      selected: o.offerId === line.offerId,
      selectable: o.exclusions.every((c) => BLOCKING.has(c)),
      engineQty: o.schemeDecision?.qty ?? o.order?.q ?? null,
    }))
    // Winner first, then scored offers best first, then excluded ones.
    .sort((a, b) => Number(b.winner) - Number(a.winner) || (b.score ?? -1) - (a.score ?? -1) || a.supplierCode.localeCompare(b.supplierCode));

  return {
    line,
    dataSource: line.dataSource,
    asOf: ev.asOf,
    product: {
      brandName: p.brandName,
      genericName: p.genericName,
      strength: p.strength,
      dosageForm: p.dosageForm,
      packSize: p.packSize,
      manufacturer: p.manufacturer,
      category: p.category,
      storageClass: p.storageClass,
      criticality: p.criticality,
      shelfLifeDays: p.shelfLifeDays,
    },
    demand: ev.demand,
    stock: {
      onHand: ev.stock.onHand ?? null,
      reserved: ev.stock.reserved ?? null,
      available: ev.stock.eligibleAvailable,
      incoming: ev.stock.incoming,
      incomingLines: ev.incoming.lines,
      horizonDays: ev.incoming.horizonDays,
      position: ev.stock.stockPosition,
      cover: ev.stock.cover,
      ineligible: ev.expiry.ineligible,
    },
    policy: ev.policy,
    batches: ev.expiry.batches,
    atRiskValue: ev.expiry.atRiskValue,
    offers,
    formulas: buildFormulas(ev),
    engine: { qty: ev.qty, freeQty: ev.freeQty, offerId: ev.chosenOfferId, lineTotal: ev.totals?.lineTotal ?? null },
  };
}

/** Each §6 formula with the line's actual values substituted (the engine's recommendation). */
function buildFormulas(ev: Evidence): Formula[] {
  const c = ENGINE_CONFIG;
  const { d7, d28, avgDailyDemand: d } = ev.demand;
  const s = ev.stock;
  const chosen = ev.offers.find((o) => o.offerId === ev.chosenOfferId);
  const out: Formula[] = [
    {
      label: "Demand",
      expr: `d̄ = ${c.demandWeight7} × d7 + ${c.demandWeight28} × d28`,
      subst: `${c.demandWeight7} × ${n2(d7)} + ${c.demandWeight28} × ${n2(d28)}`,
      result: `${n2(d)} packs/day`,
    },
    {
      label: "Stock position",
      expr: "position = eligible available + confirmed incoming",
      subst: `${s.eligibleAvailable} + ${s.incoming}`,
      result: `${n2(s.stockPosition)} packs`,
    },
    {
      label: "Cover",
      expr: "cover = position ÷ d̄",
      subst: d > 0 ? `${n2(s.stockPosition)} ÷ ${n2(d)}` : "no demand",
      result: s.cover === null ? "—" : `${n1(s.cover)} days`,
    },
    {
      label: "Safety stock",
      expr: `safety = max(${c.minSafetyPacks}, d̄ × ${c.safetyBufferDays})`,
      subst: `max(${c.minSafetyPacks}, ${n2(d)} × ${c.safetyBufferDays})`,
      result: `${n2(safetyStock(d))} packs`,
    },
    {
      label: "Reorder point",
      expr: "ROP = d̄ × L_fastest + safety",
      subst: `${n2(d)} × ${ev.policy.leadFastest} + ${n2(ev.policy.safetyStock)}`,
      result: `${n2(ev.policy.reorderPoint)} packs`,
    },
  ];
  if (!chosen) return out;

  const L = chosen.leadTimeDays;
  // Batches at expiry risk cap the order at ROP(L) instead of the target (§6.5).
  const reduced = ev.reasons.includes("EXPIRY_REDUCED_QTY");
  const upTo = reduced ? reorderPoint(d, L) : targetStock(d, L);
  out.push(
    reduced
      ? { label: "Order up to", expr: "ROP(L) = d̄ × L + safety (batches at expiry risk)", subst: `${n2(d)} × ${L} + ${n2(safetyStock(d))}`, result: `${n2(upTo)} packs` }
      : { label: "Order up to", expr: `target = d̄ × (L + R) + safety, R = ${c.reviewPeriodDays}`, subst: `${n2(d)} × (${L} + ${c.reviewPeriodDays}) + ${n2(safetyStock(d))}`, result: `${n2(upTo)} packs` },
  );
  if (chosen.order) {
    const schemeNote = chosen.schemeDecision?.taken && chosen.schemeDecision.qty !== chosen.order.q ? `, scheme ${chosen.scheme} → ${chosen.schemeDecision.qty}` : "";
    out.push({
      label: "Order quantity",
      expr: "q = ⌈(up to − position) ÷ pack multiple⌉ × pack multiple, at least MOQ",
      subst: `⌈(${n2(upTo)} − ${n2(s.stockPosition)}) ÷ ${chosen.packMultiple}⌉ × ${chosen.packMultiple}, MOQ ${chosen.moq}${schemeNote}`,
      result: `${ev.qty} packs${ev.freeQty > 0 ? ` + ${ev.freeQty} free` : ""}`,
    });
  }
  if (chosen.unitPrice && chosen.effectiveCost) {
    const paid = chosen.schemeDecision?.taken && chosen.scheme ? chosen.scheme.split("+").map(Number) : null;
    out.push({
      label: "Effective cost",
      expr: "cost/pack = price × (1 + GST) × paid share + freight",
      subst: `${rupees(chosen.unitPrice)} × ${dec(1).plus(dec(chosen.taxRate).dividedBy(100)).toFixed(2)} × ${paid ? `${paid[0]}/${paid[0] + paid[1]}` : "1"} + ${rupees(chosen.freightPerPack)}`,
      result: rupees(chosen.effectiveCost),
    });
  }
  if (ev.totals) {
    out.push({
      label: "Line total",
      expr: "total = q × price + GST + freight",
      subst: `${rupees(ev.totals.lineSubtotal)} + ${rupees(ev.totals.lineTax)} + ${rupees(ev.totals.lineFreight)}`,
      result: rupees(ev.totals.lineTotal),
    });
  }
  if (chosen.factors && chosen.score !== null) {
    const w = c.supplierWeights;
    const f = chosen.factors;
    out.push({
      label: "Supplier score",
      expr: `score = ${w.cost} × cost + ${w.leadTime} × lead + ${w.reliability} × reliability + ${w.terms} × terms`,
      subst: `${w.cost} × ${n1(f.cost)} + ${w.leadTime} × ${n1(f.leadTime)} + ${w.reliability} × ${n1(f.reliability)} + ${w.terms} × ${n1(f.terms)}`,
      result: n1(chosen.score),
    });
  }
  const wCrit = criticalityWeight(ev.product.criticality);
  const shortfall = s.cover === null ? 0 : Math.max(0, L - s.cover);
  out.push(
    {
      label: "Loss prevented",
      expr: "loss = max(0, L − cover) × d̄ × unit margin × w_crit",
      subst: `${n1(shortfall)} × ${n2(d)} × ${rupees(ev.product.unitMargin)} × ${wCrit}`,
      result: rupees(ev.lossPrevented),
    },
    {
      label: "Priority",
      expr: "priority = loss prevented ÷ line total",
      subst: ev.totals ? `${rupees(ev.lossPrevented)} ÷ ${rupees(ev.totals.lineTotal)}` : "—",
      result: ev.priority.toFixed(4),
    },
  );
  return out;
}
