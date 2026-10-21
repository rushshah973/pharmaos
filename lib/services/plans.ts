// Purchase plans (implementationplan.md §7.2–§7.5): create, read, edit a line (with preview), recalculate.
// There is no purchase budget: every SKU that needs stock is planned, ranked by priority, and spend is
// controlled per purchase order by the Owner approval limit (app_state.po_approval_limit).
// Every mutation runs in one transaction and writes its audit row inside it.
import type postgres from "postgres";
import { cache } from "react";
import { ServiceError, notFound } from "@/lib/api/errors";
import { ENGINE_CONFIG } from "@/lib/business-logic/config";
import { analyseSku, buildPlan } from "@/lib/business-logic/engine";
import { computeImpact } from "@/lib/business-logic/impact";
import { lineTotals, planTotal, supplierTotals } from "@/lib/business-logic/totals";
import type {
  HardStopCode,
  ImpactCard,
  LineTotals,
  Money,
  OfferInput,
  PlanLine,
  ReasonCode,
  RecommendationStatus,
  SkuAnalysis,
  SkuContext,
  SkuStatus,
  SupplierTotal,
  WarningCode,
} from "@/lib/business-logic/types";
import { hardStops } from "@/lib/business-logic/validation";
import { getSql } from "@/lib/db/client";
import { sumMoney } from "@/lib/money";
import type { LineChange } from "@/lib/validation/api";
import { type PlanningState, resolvePlanningState } from "./as-of";
import { type SqlHandle, writeAudit } from "./audit";
import { loadPlanningContext } from "./context";

export type PlanStatus = "draft" | "partially_approved" | "approved" | "rejected";
export type Actor = { type: "user" | "agent"; id: string };

const defaultActor = (): Actor => ({ type: "user", id: process.env.DEMO_USER ?? "demo.owner" });

/** A projected purchase order: what one supplier would get if every counted line were approved. */
export type SupplierPo = SupplierTotal & { supplierCode: string; supplierName: string };

export type PlanSummary = {
  id: string;
  status: PlanStatus;
  proposedTotal: Money;
  /** Current Owner approval limit: a PO above it needs approval before it can be sent. */
  approvalLimit: Money;
  supplierPos: SupplierPo[];
  scenarioId: string;
  scenarioName: string;
  asOf: string;
  rejectReason: string | null;
  createdAt: string;
  updatedAt: string;
  impact: ImpactCard;
};

export type LineView = {
  id: string;
  rank: number;
  productId: string;
  sku: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  packSize: number;
  criticality: string;
  skuStatus: SkuStatus;
  cover: number | null;
  offerId: string | null;
  supplierId: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  leadTimeDays: number | null;
  /** Order rules of the selected offer, for the quantity stepper. */
  packMultiple: number | null;
  moq: number | null;
  availableQty: number | null;
  qty: number;
  freeQty: number;
  unitPrice: Money | null;
  /** Landed cost per pack (GST, freight, scheme) for the selected offer, as the engine evaluated it. */
  effectiveCost: Money | null;
  totals: LineTotals;
  priority: number;
  /** False for lines that cannot be bought (no eligible offer, or an edited line that now fails a hard stop). */
  inBasket: boolean;
  /** In the plan and counted in its total (status proposed, edited or approved_for_po). */
  counted: boolean;
  status: RecommendationStatus;
  reasons: ReasonCode[];
  warnings: WarningCode[];
  deferReason: string | null;
  userNote: string | null;
  lossPrevented: Money;
  expiryAvoidedValue: Money;
};

export type PlanView = PlanSummary & { lines: LineView[] };
export type LineWithEvidence = LineView & { evidence: Record<string, unknown>; dataSource: string };

const COUNTED_STATUSES: ReadonlySet<RecommendationStatus> = new Set(["proposed", "edited", "approved_for_po"]);
const isCounted = (l: { inBasket: boolean; status: RecommendationStatus }) => l.inBasket && COUNTED_STATUSES.has(l.status);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type PlanRow = {
  id: string;
  status: PlanStatus;
  proposed_total: string;
  approval_limit: string;
  scenario_id: string;
  scenario_name: string;
  as_of: string;
  reject_reason: string | null;
  created_at: string;
  updated_at: string;
  impact: ImpactCard;
  assumptions: Record<string, unknown>;
};

async function selectPlan(sql: SqlHandle, planId: string, forUpdate = false): Promise<PlanRow | undefined> {
  const lock = forUpdate ? sql`for update of pp` : sql``;
  const [row] = await sql<PlanRow[]>`
    select
      pp.id, pp.status,
      pp.proposed_total::text as proposed_total,
      (select po_approval_limit::text from app_state where id = 1) as approval_limit,
      pp.scenario_id, s.name as scenario_name,
      to_char(pp.as_of_date, 'YYYY-MM-DD') as as_of,
      pp.reject_reason,
      to_char(pp.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
      to_char(pp.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at,
      pp.impact_json as impact,
      pp.assumptions_json as assumptions
    from purchase_plans pp
    join scenarios s on s.id = pp.scenario_id
    where pp.id = ${planId}
    ${lock}
  `;
  return row;
}

/** Projected supplier POs from the lines, against the current approval limit. */
function projectPos(lines: LineView[], approvalLimit: Money): SupplierPo[] {
  const names = new Map(lines.filter((l) => l.supplierId).map((l) => [l.supplierId!, { code: l.supplierCode ?? "", name: l.supplierName ?? "" }]));
  return supplierTotals(
    lines.map((l) => ({ supplierId: l.supplierId, lineTotal: l.totals.lineTotal, inBasket: l.inBasket, status: l.status })),
    approvalLimit,
  ).map((t) => ({ ...t, supplierCode: names.get(t.supplierId)?.code ?? "", supplierName: names.get(t.supplierId)?.name ?? "" }));
}

/** Summary from the plan row and its lines. PO counts in the Impact Card follow the current approval limit. */
function summarize(r: PlanRow, lines: LineView[], override?: { total?: Money; impact?: ImpactCard }): PlanSummary {
  const supplierPos = projectPos(lines, r.approval_limit);
  const impact = override?.impact ?? r.impact;
  return {
    id: r.id,
    status: r.status,
    proposedTotal: override?.total ?? r.proposed_total,
    approvalLimit: r.approval_limit,
    supplierPos,
    scenarioId: r.scenario_id,
    scenarioName: r.scenario_name,
    asOf: r.as_of,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    impact: { ...impact, poCount: supplierPos.length, posNeedingApproval: supplierPos.filter((p) => p.needsApproval).length },
  };
}

type LineRow = Omit<LineView, "totals" | "counted"> & {
  lineSubtotal: string;
  lineTax: string;
  lineFreight: string;
  lineTotal: string;
  evidence?: Record<string, unknown>;
  dataSource?: string;
};

async function selectLines(sql: SqlHandle, planId: string, opts: { lineId?: string; withEvidence?: boolean } = {}): Promise<LineRow[]> {
  const evidence = opts.withEvidence ? sql`, r.evidence_json as evidence, p.data_source as "dataSource"` : sql``;
  const one = opts.lineId ? sql`and r.id = ${opts.lineId}` : sql``;
  return sql<LineRow[]>`
    select
      r.id, r.rank,
      r.product_id as "productId",
      p.sku, p.brand_name as "brandName", p.generic_name as "genericName",
      p.strength, p.dosage_form as "dosageForm", p.pack_size as "packSize", p.criticality,
      coalesce(r.evidence_json->>'skuStatus', 'HEALTHY') as "skuStatus",
      (r.evidence_json->'stock'->>'cover')::float8 as cover,
      r.selected_offer_id as "offerId",
      r.selected_supplier_id as "supplierId",
      s.supplier_code as "supplierCode", s.name as "supplierName",
      o.lead_time_days as "leadTimeDays",
      o.pack_multiple as "packMultiple", o.moq, o.available_qty as "availableQty",
      r.suggested_qty as qty, r.free_qty as "freeQty",
      r.unit_price::text as "unitPrice",
      (select e->>'effectiveCost' from jsonb_array_elements(r.evidence_json->'offers') e
        where e->>'offerId' = r.selected_offer_id::text limit 1) as "effectiveCost",
      r.line_subtotal::text as "lineSubtotal",
      r.line_tax::text as "lineTax",
      r.line_freight::text as "lineFreight",
      r.line_total::text as "lineTotal",
      r.priority_score::float8 as priority,
      r.in_basket as "inBasket",
      r.status, r.reason_codes as reasons, r.warnings,
      r.defer_reason as "deferReason", r.user_note as "userNote",
      coalesce(r.evidence_json->>'lossPrevented', '0.00') as "lossPrevented",
      coalesce(r.evidence_json->>'expiryAvoidedValue', '0.00') as "expiryAvoidedValue"
      ${evidence}
    from purchase_recommendations r
    join products p on p.id = r.product_id
    left join suppliers s on s.id = r.selected_supplier_id
    left join supplier_offers o on o.id = r.selected_offer_id
    where r.plan_id = ${planId} ${one}
    order by r.rank
  `;
}

function toLineView(r: LineRow): LineView {
  const { lineSubtotal, lineTax, lineFreight, lineTotal, evidence: _evidence, dataSource: _source, ...rest } = r;
  void _evidence;
  void _source;
  return { ...rest, totals: { lineSubtotal, lineTax, lineFreight, lineTotal }, counted: isCounted(r) };
}

export async function getPlan(planId: string, sql: SqlHandle = getSql()): Promise<PlanView> {
  const [plan, rows] = await Promise.all([selectPlan(sql, planId), selectLines(sql, planId)]);
  if (!plan) throw notFound("Plan", planId);
  const lines = rows.map(toLineView);
  return { ...summarize(plan, lines), lines };
}

export type PlanListItem = {
  id: string;
  status: PlanStatus;
  createdAt: string;
  proposedTotal: Money;
  lines: number;
  included: number;
  posNeedingApproval: number;
  scenarioId: string;
  scenarioName: string;
};

/** Newest first. POs needing approval is the figure saved with the plan's last change. */
export async function listPlans(limit = 50, sql: SqlHandle = getSql()): Promise<PlanListItem[]> {
  return sql<PlanListItem[]>`
    select
      pp.id, pp.status,
      to_char(pp.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
      pp.proposed_total::text as "proposedTotal",
      (select count(*)::int from purchase_recommendations r where r.plan_id = pp.id) as lines,
      (select count(*)::int from purchase_recommendations r
        where r.plan_id = pp.id and r.in_basket and r.status in ('proposed', 'edited', 'approved_for_po')) as included,
      coalesce((pp.impact_json->>'posNeedingApproval')::int, 0) as "posNeedingApproval",
      pp.scenario_id as "scenarioId", s.name as "scenarioName"
    from purchase_plans pp
    join scenarios s on s.id = pp.scenario_id
    order by pp.created_at desc
    limit ${Math.min(Math.max(Math.trunc(limit), 1), 200)}
  `;
}

/** getPlan deduplicated within one server render (the plan screen and its drawer both need it). */
export const getPlanForRender = cache((planId: string) => getPlan(planId));

/** One line with its full evidence_json (line drawer, explain). */
export async function getLine(planId: string, lineId: string, sql: SqlHandle = getSql()): Promise<LineWithEvidence> {
  const [row] = await selectLines(sql, planId, { lineId, withEvidence: true });
  if (!row) throw notFound("Line", lineId);
  return { ...toLineView(row), evidence: row.evidence ?? {}, dataSource: row.dataSource ?? "synthetic_demo" };
}

// ---------------------------------------------------------------------------
// Writes: shared helpers
// ---------------------------------------------------------------------------

/** Row payload for purchase_recommendations, written in bulk through jsonb_to_recordset. */
type RecRow = {
  product_id: string;
  selected_offer_id: string | null;
  selected_supplier_id: string | null;
  suggested_qty: number;
  free_qty: number;
  unit_price: string | null;
  line_subtotal: string;
  line_tax: string;
  line_freight: string;
  line_total: string;
  priority_score: number;
  rank: number;
  in_basket: boolean;
  reason_codes: string[];
  warnings: string[];
  status: RecommendationStatus;
  defer_reason: string | null;
  user_note: string | null;
  evidence_json: Record<string, unknown>;
};

const ZERO_TOTALS: LineTotals = { lineSubtotal: "0.00", lineTax: "0.00", lineFreight: "0.00", lineTotal: "0.00" };

const rowTotals = (t: LineTotals) => ({ line_subtotal: t.lineSubtotal, line_tax: t.lineTax, line_freight: t.lineFreight, line_total: t.lineTotal });

const lineEvidence = (a: SkuAnalysis) => ({ ...a.evidence, skuStatus: a.status, lossPrevented: a.lossPrevented, expiryAvoidedValue: a.expiryAvoidedValue });

function planLineToRow(l: PlanLine, rank: number): RecRow {
  return {
    product_id: l.productId,
    selected_offer_id: l.offerId,
    selected_supplier_id: l.supplierId,
    suggested_qty: l.qty,
    free_qty: l.freeQty,
    unit_price: l.unitPrice,
    ...rowTotals(l.totals ?? ZERO_TOTALS),
    priority_score: l.priority,
    rank,
    in_basket: l.inBasket,
    reason_codes: l.reasons,
    warnings: l.warnings,
    status: "proposed",
    defer_reason: null,
    user_note: null,
    evidence_json: { ...l.evidence, skuStatus: l.status, lossPrevented: l.lossPrevented, expiryAvoidedValue: l.expiryAvoidedValue },
  };
}

/** Insert or update recommendation rows (keyed by plan + product, so line ids survive a recalculation). */
async function upsertRows(sql: SqlHandle, planId: string, rows: RecRow[]) {
  if (rows.length === 0) return;
  await sql`
    insert into purchase_recommendations (
      plan_id, product_id, selected_offer_id, selected_supplier_id, suggested_qty, free_qty, unit_price,
      line_subtotal, line_tax, line_freight, line_total, priority_score, rank, in_basket,
      reason_codes, warnings, status, defer_reason, user_note, evidence_json
    )
    select
      ${planId}::uuid, x.product_id, x.selected_offer_id, x.selected_supplier_id, x.suggested_qty, x.free_qty, x.unit_price,
      x.line_subtotal, x.line_tax, x.line_freight, x.line_total, x.priority_score, x.rank, x.in_basket,
      x.reason_codes, x.warnings, x.status, x.defer_reason, x.user_note, x.evidence_json
    from jsonb_to_recordset(${sql.json(rows as unknown as postgres.JSONValue)}) as x(
      product_id uuid, selected_offer_id uuid, selected_supplier_id uuid, suggested_qty int, free_qty int, unit_price numeric,
      line_subtotal numeric, line_tax numeric, line_freight numeric, line_total numeric, priority_score numeric, rank int,
      in_basket boolean, reason_codes text[], warnings jsonb, status text, defer_reason text, user_note text, evidence_json jsonb
    )
    on conflict (plan_id, product_id) do update set
      selected_offer_id = excluded.selected_offer_id,
      selected_supplier_id = excluded.selected_supplier_id,
      suggested_qty = excluded.suggested_qty,
      free_qty = excluded.free_qty,
      unit_price = excluded.unit_price,
      line_subtotal = excluded.line_subtotal,
      line_tax = excluded.line_tax,
      line_freight = excluded.line_freight,
      line_total = excluded.line_total,
      priority_score = excluded.priority_score,
      rank = excluded.rank,
      in_basket = excluded.in_basket,
      reason_codes = excluded.reason_codes,
      warnings = excluded.warnings,
      status = excluded.status,
      defer_reason = excluded.defer_reason,
      user_note = coalesce(excluded.user_note, purchase_recommendations.user_note),
      evidence_json = excluded.evidence_json,
      updated_at = now()
  `;
}

type SkuSummary = { skusAtRisk: number; expiryExposure: Money };

/** Impact Card from the saved lines. SKU-level figures (at risk, exposure) come from the last analysis. */
function impactFromLines(lines: LineView[], approvalLimit: Money, skus: SkuSummary): ImpactCard {
  const impact = computeImpact({
    skus: [],
    lines: lines.map((l) => ({
      status: l.skuStatus,
      inBasket: isCounted(l),
      lossPrevented: l.lossPrevented,
      totals: l.totals,
      reasons: l.reasons,
      expiryAvoidedValue: l.expiryAvoidedValue,
    })),
    supplierTotals: projectPos(lines, approvalLimit),
  });
  return { ...impact, skusAtRisk: skus.skusAtRisk, expiryExposure: skus.expiryExposure };
}

const totalOf = (lines: { inBasket: boolean; status: RecommendationStatus; totals: LineTotals }[]) =>
  planTotal(lines.map((l) => ({ lineTotal: l.totals.lineTotal, inBasket: l.inBasket, status: l.status })));

async function updatePlanTotals(sql: SqlHandle, planId: string, args: { total: Money; impact: ImpactCard; extra?: postgres.PendingQuery<postgres.Row[]> }) {
  await sql`
    update purchase_plans set
      proposed_total = ${args.total},
      impact_json = ${sql.json(args.impact as unknown as postgres.JSONValue)},
      updated_at = now()
      ${args.extra ?? sql``}
    where id = ${planId}
  `;
}

function hardStopError(codes: HardStopCode[] | string[]): ServiceError {
  const messages: Record<string, string> = {
    INVALID_PACK_MULTIPLE: "Quantity must be a multiple of the supplier's pack multiple.",
    BELOW_MOQ: "Quantity is below the supplier's minimum order quantity.",
    ABOVE_AVAILABILITY: "Quantity is more than the supplier has available.",
    NON_POSITIVE_QTY: "Quantity must be a positive whole number of packs.",
    SUPPLIER_NOT_APPROVED: "The supplier is not approved.",
    QUOTE_EXPIRED: "The supplier's quote has expired.",
    QUOTE_STALE: "The supplier's quote is too old to use.",
    MISSING_PRICE: "The offer has no price.",
    INVALID_SKU: "The product is not active.",
    PRODUCT_RECALLED: "The product has a recalled batch.",
  };
  const code = codes[0];
  return new ServiceError(code, 400, messages[code] ?? "The change fails a hard stop.", { codes });
}

/** Free packs a scheme gives on `qty` paid packs ("10+1" on 25 → 2). */
function schemeFree(offer: OfferInput, qty: number): number {
  const p = offer.schemePaidQty ?? 0;
  const f = offer.schemeFreeQty ?? 0;
  return p > 0 && f > 0 ? Math.floor(qty / p) * f : 0;
}

/** Fresh context and analysis for one SKU (the active scenario applies, as in a full plan). */
async function analyseOne(sql: SqlHandle, productId: string, state: PlanningState): Promise<{ sku: SkuContext; analysis: SkuAnalysis }> {
  const ctx = await loadPlanningContext(sql, state.asOf, state.scenarioId, productId);
  const sku = ctx.skus[0];
  if (!sku) throw new ServiceError("INVALID_SKU", 400, "The product is no longer active.");
  return { sku, analysis: analyseSku(sku) };
}

// ---------------------------------------------------------------------------
// createPlan (§7.2)
// ---------------------------------------------------------------------------

export async function createPlan(
  input: { priorities?: string } = {},
  actor: Actor = defaultActor(),
  sql: postgres.Sql = getSql(),
): Promise<{ planId: string; durationMs: number }> {
  const t0 = performance.now();
  const { asOf, scenarioId, approvalLimit } = await resolvePlanningState(sql);
  const ctx = await loadPlanningContext(sql, asOf, scenarioId);
  const result = buildPlan(ctx, { ...ENGINE_CONFIG, poApprovalLimit: approvalLimit });

  // The id is generated here so the plan, its lines and the audit row go out in one pipelined round trip.
  const planId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    const assumptions = { config: ENGINE_CONFIG, asOf, scenarioId, approvalLimit, priorities: input.priorities ?? null };
    // Pipelining: a raw query is sent only when awaited, unless .execute() is called; the async helpers send on call.
    // So every raw query below calls .execute(), and the statements reach the database in array order.
    await Promise.all([
      tx`
        insert into purchase_plans (id, proposed_total, status, scenario_id, as_of_date, assumptions_json, impact_json)
        values (
          ${planId}, ${result.planTotal}, 'draft', ${scenarioId}, ${asOf},
          ${tx.json(assumptions as unknown as postgres.JSONValue)},
          ${tx.json(result.impact as unknown as postgres.JSONValue)}
        )
      `.execute(),
      upsertRows(tx, planId, result.lines.map((l, i) => planLineToRow(l, i + 1))),
      writeAudit(
        {
          actorType: actor.type,
          actorId: actor.id,
          action: "plan.created",
          entityType: "plan",
          entityId: planId,
          after: {
            planTotal: result.planTotal,
            lines: result.lines.length,
            included: result.lines.filter((l) => l.inBasket).length,
            pos: result.supplierTotals.length,
            posNeedingApproval: result.impact.posNeedingApproval,
            approvalLimit,
            asOf,
            scenarioId,
          },
          reason: input.priorities ?? null,
        },
        tx,
      ),
    ]);
  });

  const durationMs = Math.round(performance.now() - t0);
  console.info(
    `[plans] createPlan ${planId}: ${result.lines.length} lines, ₹${result.planTotal}, ${result.supplierTotals.length} POs (${result.impact.posNeedingApproval} above ₹${approvalLimit}) in ${durationMs} ms`,
  );
  return { planId, durationMs };
}

// ---------------------------------------------------------------------------
// editLine (§7.3)
// ---------------------------------------------------------------------------

export type EditResult = { preview: boolean; before: LineView; after: LineView; plan: PlanSummary };

const LOCKED_PLAN: ReadonlySet<PlanStatus> = new Set(["approved", "rejected"]);

export async function editLine(
  planId: string,
  lineId: string,
  change: LineChange,
  opts: { preview?: boolean; actor?: Actor } = {},
  sql: postgres.Sql = getSql(),
): Promise<EditResult> {
  const actor = opts.actor ?? defaultActor();
  const preview = opts.preview === true;

  return sql.begin(async (tx) => {
    // One round trip: lock the plan, read its lines and the planning state (pipelined on the transaction).
    const [plan, lineRows, state] = await Promise.all([selectPlan(tx, planId, true), selectLines(tx, planId), resolvePlanningState(tx)]);
    if (!plan) throw notFound("Plan", planId);
    const lines = lineRows.map(toLineView);
    const before = lines.find((l) => l.id === lineId);
    if (!before) throw notFound("Line", lineId);
    if (LOCKED_PLAN.has(plan.status)) {
      throw new ServiceError("LINE_LOCKED", 409, `The plan is ${plan.status}; its lines can no longer change.`);
    }
    if (before.status === "approved_for_po") {
      throw new ServiceError("LINE_LOCKED", 409, "This line is already on a purchase order.");
    }

    let after: LineView = { ...before };
    let action = "line.edited";
    let evidencePatch: Record<string, unknown> | null = null;

    if (change.kind === "note") {
      after.userNote = change.note || null;
    } else if (change.kind === "status") {
      after.status = change.status;
      after.deferReason = change.reason;
      action = change.status === "deferred" ? "line.deferred" : "line.rejected";
    } else {
      // qty, offer or restore: re-check against fresh data for this SKU.
      const { sku, analysis } = await analyseOne(tx, before.productId, state);
      const { asOf } = state;
      const supplierOf = (o: OfferInput) => sku.suppliers[o.supplierId];
      const engineOfferId = analysis.chosen?.offerId ?? null;

      let offer: OfferInput | undefined;
      let qty = before.qty;
      if (change.kind === "offer") {
        offer = sku.offers.find((o) => o.id === change.offerId);
        if (!offer) throw new ServiceError("OFFER_NOT_FOUND", 400, "That offer is not for this product.");
        const ev = analysis.offers.find((e) => e.offerId === offer!.id);
        // A slower supplier is the owner's call (it adds a warning); every other exclusion blocks.
        const blocking = (ev?.exclusions ?? []).filter((c) => c !== "TOO_SLOW_FOR_COVER" && c !== "INSUFFICIENT_AVAILABILITY");
        if (blocking.length > 0) {
          throw new ServiceError("OFFER_NOT_ELIGIBLE", 400, "That offer cannot be used.", { exclusions: blocking });
        }
        // Keep the current quantity if it is valid for the new offer, else use what the engine would buy from it.
        const fits = hardStops({ product: sku.product, offer, supplier: supplierOf(offer), qty, asOf, batches: sku.batches }).length === 0;
        if (!fits) {
          const engineQty = ev?.scheme?.qty ?? 0;
          qty = engineQty > 0 ? engineQty : Math.ceil(Math.max(qty, offer.moq, 1) / offer.packMultiple) * offer.packMultiple;
        }
      } else {
        offer = sku.offers.find((o) => o.id === before.offerId);
        if (!offer) throw new ServiceError("NO_ELIGIBLE_OFFER", 400, "This line has no eligible offer to buy from.");
        if (change.kind === "qty") qty = change.qty;
      }

      const stops = hardStops({ product: sku.product, offer, supplier: supplierOf(offer), qty, asOf, batches: sku.batches });
      if (stops.length > 0) throw hardStopError(stops);

      const supplier = supplierOf(offer)!;
      const totals = lineTotals({ qty, unitPrice: offer.unitPrice!, taxRate: offer.taxRate, freightPerPack: offer.freightPerPack });
      const warnings = new Set<WarningCode>(before.warnings.filter((w) => w !== "NOT_TOP_SUPPLIER"));
      if (engineOfferId && offer.id !== engineOfferId) warnings.add("NOT_TOP_SUPPLIER");
      after = {
        ...after,
        offerId: offer.id,
        supplierId: supplier.id,
        supplierCode: supplier.code,
        supplierName: supplier.name,
        leadTimeDays: offer.leadTimeDays,
        packMultiple: offer.packMultiple,
        moq: offer.moq,
        availableQty: offer.availableQty,
        qty,
        freeQty: schemeFree(offer, qty),
        unitPrice: offer.unitPrice,
        totals,
        inBasket: true,
        warnings: [...warnings],
        status: change.kind === "restore" ? "proposed" : "edited",
        deferReason: null,
      };
      if (change.kind === "restore") action = "line.restored";
      else evidencePatch = { userEdit: { qty, offerId: offer.id, engineOfferId, engineQty: analysis.qty, asOf } };
    }
    after.counted = isCounted(after);

    const nextLines = lines.map((l) => (l.id === lineId ? after : l));
    const total = totalOf(nextLines);
    const impact = impactFromLines(nextLines, plan.approval_limit, plan.impact);
    if (preview) return { preview: true, before, after, plan: summarize(plan, nextLines, { total, impact }) };

    const pick = (l: LineView) => ({
      status: l.status,
      qty: l.qty,
      freeQty: l.freeQty,
      offerId: l.offerId,
      supplierCode: l.supplierCode,
      lineTotal: l.totals.lineTotal,
      inBasket: l.inBasket,
      note: l.userNote,
    });
    // Line, plan totals, audit and the re-read go out pipelined, in this order, in one round trip.
    const [, , , saved] = await Promise.all([
      tx`
        update purchase_recommendations set
          selected_offer_id = ${after.offerId},
          selected_supplier_id = ${after.supplierId},
          suggested_qty = ${after.qty},
          free_qty = ${after.freeQty},
          unit_price = ${after.unitPrice},
          line_subtotal = ${after.totals.lineSubtotal},
          line_tax = ${after.totals.lineTax},
          line_freight = ${after.totals.lineFreight},
          line_total = ${after.totals.lineTotal},
          in_basket = ${after.inBasket},
          warnings = ${tx.json(after.warnings)},
          status = ${after.status},
          defer_reason = ${after.deferReason},
          user_note = ${after.userNote},
          evidence_json = evidence_json || ${tx.json((evidencePatch ?? {}) as postgres.JSONValue)},
          updated_at = now()
        where id = ${lineId}
      `.execute(),
      updatePlanTotals(tx, planId, { total, impact }),
      writeAudit(
        {
          actorType: actor.type,
          actorId: actor.id,
          action,
          entityType: "recommendation",
          entityId: lineId,
          before: { ...pick(before), planTotal: plan.proposed_total },
          after: { ...pick(after), planTotal: total },
          reason: change.kind === "status" ? change.reason : null,
        },
        tx,
      ),
      selectPlan(tx, planId),
    ]);
    return { preview: false, before, after, plan: summarize(saved!, nextLines) };
  });
}

// ---------------------------------------------------------------------------
// recalculatePlan (§7.5)
// ---------------------------------------------------------------------------

export async function recalculatePlan(planId: string, opts: { actor?: Actor } = {}, sql: postgres.Sql = getSql()): Promise<PlanView> {
  const actor = opts.actor ?? defaultActor();

  return sql.begin(async (tx) => {
    const t0 = performance.now();
    const [plan, lineRows, { asOf, scenarioId, approvalLimit }] = await Promise.all([
      selectPlan(tx, planId, true),
      selectLines(tx, planId),
      resolvePlanningState(tx),
    ]);
    if (!plan) throw notFound("Plan", planId);
    if (LOCKED_PLAN.has(plan.status)) {
      throw new ServiceError("PLAN_LOCKED", 409, `The plan is ${plan.status} and cannot be recalculated.`);
    }

    const beforeLines = lineRows.map(toLineView);
    const ctx = await loadPlanningContext(tx, asOf, scenarioId);
    const skuById = new Map(ctx.skus.map((s) => [s.product.id, s]));

    // Partition the saved lines (§7.5): approved lines are frozen, rejected and owner-deferred lines stay as they are,
    // edited lines keep the owner's qty/offer at fresh prices, every other SKU is re-planned by the engine.
    const byRank = [...beforeLines].sort((a, b) => a.rank - b.rank);
    const frozen = byRank.filter((l) => l.status === "approved_for_po");
    const edited = byRank.filter((l) => l.status === "edited");
    const kept = byRank.filter((l) => l.status === "rejected" || l.status === "deferred");
    const fixedIds = new Set([...frozen, ...edited, ...kept].map((l) => l.productId));

    const analyses = new Map<string, SkuAnalysis>();
    for (const l of [...frozen, ...edited, ...kept]) {
      const s = skuById.get(l.productId);
      if (s) analyses.set(l.productId, analyseSku(s));
    }

    // An edited line that now fails a hard stop stays edited but is not counted (in_basket false, reason = the code).
    const editedRows: RecRow[] = edited.map((l) => {
      const s = skuById.get(l.productId);
      const a = analyses.get(l.productId);
      const offer = s?.offers.find((o) => o.id === l.offerId);
      const base = {
        product_id: l.productId,
        selected_offer_id: l.offerId,
        selected_supplier_id: l.supplierId,
        suggested_qty: l.qty,
        free_qty: l.freeQty,
        unit_price: l.unitPrice,
        priority_score: a?.priority ?? l.priority,
        rank: 0,
        reason_codes: a?.reasons ?? l.reasons,
        warnings: l.warnings,
        status: "edited" as const,
        user_note: l.userNote,
        evidence_json: a ? lineEvidence(a) : {},
      };
      const stops = s && offer ? hardStops({ product: s.product, offer, supplier: s.suppliers[offer.supplierId], qty: l.qty, asOf, batches: s.batches }) : ["INVALID_SKU"];
      if (!s || !offer || stops.length > 0) {
        return { ...base, ...rowTotals(l.totals), in_basket: false, defer_reason: stops[0] ?? "OFFER_UNAVAILABLE" };
      }
      const totals = lineTotals({ qty: l.qty, unitPrice: offer.unitPrice!, taxRate: offer.taxRate, freightPerPack: offer.freightPerPack });
      return { ...base, unit_price: offer.unitPrice, free_qty: schemeFree(offer, l.qty), ...rowTotals(totals), in_basket: true, defer_reason: null };
    });

    const sub = buildPlan({ asOf, skus: ctx.skus.filter((s) => !fixedIds.has(s.product.id)) }, { ...ENGINE_CONFIG, poApprovalLimit: approvalLimit });

    // Ranks: approved, edited, engine lines, then rejected / owner-deferred.
    let rank = 0;
    const next = () => ++rank;
    const rankOnly = frozen.map((l) => ({ id: l.id, rank: next() }));
    editedRows.forEach((r) => (r.rank = next()));
    const engineRows = sub.lines.map((l) => planLineToRow(l, next()));
    rankOnly.push(...kept.map((l) => ({ id: l.id, rank: next() })));

    // Writes and the re-read are pipelined on the transaction: one round trip (plus the upload).
    const keepProducts = [...fixedIds, ...sub.lines.map((l) => l.productId)];
    const [, , , afterRows] = await Promise.all([
      upsertRows(tx, planId, [...editedRows, ...engineRows]),
      rankOnly.length > 0
        ? tx`
            update purchase_recommendations r set rank = x.rank, updated_at = now()
            from jsonb_to_recordset(${tx.json(rankOnly)}) as x(id uuid, rank int)
            where r.id = x.id
          `.execute()
        : Promise.resolve(),
      tx`
        delete from purchase_recommendations
        where plan_id = ${planId} and status = 'proposed' and not (product_id = any(${keepProducts}::uuid[]))
      `.execute(),
      selectLines(tx, planId),
    ]);
    const afterLines = afterRows.map(toLineView);
    const total = totalOf(afterLines);
    const skuStatuses = [...sub.skuStatuses, ...[...analyses.values()].map((a) => ({ status: a.status, atRiskValue: a.expiry.atRiskValue }))];
    const impact = impactFromLines(afterLines, approvalLimit, {
      skusAtRisk: skuStatuses.filter((s) => s.status === "STOCKOUT_RISK").length,
      expiryExposure: sumMoney(skuStatuses.map((s) => s.atRiskValue)).toFixed(2),
    });
    const assumptions = { ...plan.assumptions, config: ENGINE_CONFIG, asOf, scenarioId, approvalLimit, recalculatedAt: new Date().toISOString() };

    const beforeIn = new Map(beforeLines.map((l) => [l.sku, l.counted]));
    const afterIn = new Map(afterLines.map((l) => [l.sku, l.counted]));
    const changed = [...new Set([...beforeIn.keys(), ...afterIn.keys()])]
      .filter((sku) => beforeIn.get(sku) !== afterIn.get(sku))
      .sort()
      .map((sku) => ({ sku, includedBefore: beforeIn.get(sku) ?? null, includedAfter: afterIn.get(sku) ?? null }));
    const [, , saved] = await Promise.all([
      updatePlanTotals(tx, planId, {
        total,
        impact,
        extra: tx`, as_of_date = ${asOf}, scenario_id = ${scenarioId}, assumptions_json = ${tx.json(assumptions as postgres.JSONValue)}`,
      }),
      writeAudit(
        {
          actorType: actor.type,
          actorId: actor.id,
          action: "plan.recalculated",
          entityType: "plan",
          entityId: planId,
          before: { planTotal: plan.proposed_total, lines: beforeLines.length, posNeedingApproval: plan.impact.posNeedingApproval },
          after: { planTotal: total, lines: afterLines.length, posNeedingApproval: impact.posNeedingApproval, asOf, scenarioId, changed },
        },
        tx,
      ),
      selectPlan(tx, planId),
    ]);
    console.info(
      `[plans] recalculatePlan ${planId}: ₹${total}, ${changed.length} lines changed, ${impact.posNeedingApproval} POs above the limit, in ${Math.round(performance.now() - t0)} ms`,
    );

    return { ...summarize(saved!, afterLines), lines: afterLines };
  });
}

// ---------------------------------------------------------------------------
// rejectPlan (§7.7)
// ---------------------------------------------------------------------------

/** Reject a whole plan (reason required). It creates no POs; POs already created from it are not touched. */
export async function rejectPlan(planId: string, reason: string, actor: Actor = defaultActor(), sql: postgres.Sql = getSql()): Promise<PlanSummary> {
  const why = reason.trim();
  if (why.length < 3) throw new ServiceError("REASON_REQUIRED", 400, "Give a reason (at least 3 characters) to reject the plan.");
  return sql.begin(async (tx) => {
    const plan = await selectPlan(tx, planId, true);
    if (!plan) throw notFound("Plan", planId);
    if (plan.status === "approved" || plan.status === "rejected") {
      throw new ServiceError("PLAN_LOCKED", 409, `The plan is already ${plan.status}.`);
    }
    const [, , , saved, rows] = await Promise.all([
      tx`update purchase_plans set status = 'rejected', reject_reason = ${why}, updated_at = now() where id = ${planId}`.execute(),
      tx`insert into approvals (entity_type, entity_id, decision, user_id, note) values ('plan', ${planId}, 'rejected', ${actor.id}, ${why})`.execute(),
      writeAudit(
        { actorType: actor.type, actorId: actor.id, action: "plan.rejected", entityType: "plan", entityId: planId, before: { status: plan.status }, after: { status: "rejected" }, reason: why },
        tx,
      ),
      selectPlan(tx, planId),
      selectLines(tx, planId),
    ]);
    return summarize(saved!, rows.map(toLineView));
  });
}
