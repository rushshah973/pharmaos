// Purchase plans (implementationplan.md §7.2–§7.5): create, read, edit a line (with preview), recalculate.
// Every mutation runs in one transaction and writes its audit row inside it.
import type postgres from "postgres";
import { ServiceError, notFound } from "@/lib/api/errors";
import { ENGINE_CONFIG } from "@/lib/business-logic/config";
import { analyseSku, buildPlan } from "@/lib/business-logic/engine";
import { computeImpact } from "@/lib/business-logic/impact";
import { budgetRemaining, lineTotals, planTotal } from "@/lib/business-logic/totals";
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
  WarningCode,
} from "@/lib/business-logic/types";
import { hardStops } from "@/lib/business-logic/validation";
import { getSql } from "@/lib/db/client";
import { dec, sumMoney, toMoneyString } from "@/lib/money";
import type { LineChange } from "@/lib/validation/api";
import { resolvePlanningState } from "./as-of";
import { type SqlHandle, writeAudit } from "./audit";
import { loadPlanningContext } from "./context";

export type PlanStatus = "draft" | "partially_approved" | "approved" | "rejected";
export type Actor = { type: "user" | "agent"; id: string };

const defaultActor = (): Actor => ({
  type: "user",
  id: process.env.DEMO_USER ?? "demo.owner",
});

export type PlanSummary = {
  id: string;
  status: PlanStatus;
  budget: Money;
  proposedTotal: Money;
  budgetRemaining: Money;
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
  totals: LineTotals;
  priority: number;
  inBasket: boolean;
  /** In the basket and counted in the plan total (status proposed, edited or approved_for_po). */
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
export type LineWithEvidence = LineView & { evidence: Record<string, unknown> };

const COUNTED_STATUSES: ReadonlySet<RecommendationStatus> = new Set(["proposed", "edited", "approved_for_po"]);
const isCounted = (l: { inBasket: boolean; status: RecommendationStatus }) => l.inBasket && COUNTED_STATUSES.has(l.status);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type PlanRow = {
  id: string;
  status: PlanStatus;
  budget: string;
  proposed_total: string;
  budget_remaining: string;
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
      pp.budget_limit::text as budget,
      pp.proposed_total::text as proposed_total,
      pp.budget_remaining::text as budget_remaining,
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

function toSummary(r: PlanRow): PlanSummary {
  return {
    id: r.id,
    status: r.status,
    budget: r.budget,
    proposedTotal: r.proposed_total,
    budgetRemaining: r.budget_remaining,
    scenarioId: r.scenario_id,
    scenarioName: r.scenario_name,
    asOf: r.as_of,
    rejectReason: r.reject_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    impact: r.impact,
  };
}

type LineRow = Omit<LineView, "totals" | "counted"> & {
  lineSubtotal: string;
  lineTax: string;
  lineFreight: string;
  lineTotal: string;
  evidence?: Record<string, unknown>;
};

async function selectLines(sql: SqlHandle, planId: string, opts: { lineId?: string; withEvidence?: boolean } = {}): Promise<LineRow[]> {
  const evidence = opts.withEvidence ? sql`, r.evidence_json as evidence` : sql``;
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
  const { lineSubtotal, lineTax, lineFreight, lineTotal, evidence: _evidence, ...rest } = r;
  void _evidence;
  return {
    ...rest,
    totals: { lineSubtotal, lineTax, lineFreight, lineTotal },
    counted: isCounted(r),
  };
}

export async function getPlan(planId: string, sql: SqlHandle = getSql()): Promise<PlanView> {
  const [plan, lines] = await Promise.all([selectPlan(sql, planId), selectLines(sql, planId)]);
  if (!plan) throw notFound("Plan", planId);
  return { ...toSummary(plan), lines: lines.map(toLineView) };
}

export async function getPlanSummary(planId: string, sql: SqlHandle = getSql()): Promise<PlanSummary> {
  const plan = await selectPlan(sql, planId);
  if (!plan) throw notFound("Plan", planId);
  return toSummary(plan);
}

/** One line with its full evidence_json (line drawer, explain). */
export async function getLine(planId: string, lineId: string, sql: SqlHandle = getSql()): Promise<LineWithEvidence> {
  const [row] = await selectLines(sql, planId, { lineId, withEvidence: true });
  if (!row) throw notFound("Line", lineId);
  return { ...toLineView(row), evidence: row.evidence ?? {} };
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

const ZERO_TOTALS: LineTotals = {
  lineSubtotal: "0.00",
  lineTax: "0.00",
  lineFreight: "0.00",
  lineTotal: "0.00",
};

function planLineToRow(l: PlanLine, rank: number): RecRow {
  const t = l.totals ?? ZERO_TOTALS;
  return {
    product_id: l.productId,
    selected_offer_id: l.offerId,
    selected_supplier_id: l.supplierId,
    suggested_qty: l.qty,
    free_qty: l.freeQty,
    unit_price: l.unitPrice,
    line_subtotal: t.lineSubtotal,
    line_tax: t.lineTax,
    line_freight: t.lineFreight,
    line_total: t.lineTotal,
    priority_score: l.priority,
    rank,
    in_basket: l.inBasket,
    reason_codes: l.reasons,
    warnings: l.warnings,
    status: "proposed",
    defer_reason: null,
    user_note: null,
    evidence_json: {
      ...l.evidence,
      skuStatus: l.status,
      lossPrevented: l.lossPrevented,
      expiryAvoidedValue: l.expiryAvoidedValue,
    },
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
function impactFromLines(lines: LineView[], budget: Money, skus: SkuSummary): ImpactCard {
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
    budget,
  });
  return {
    ...impact,
    skusAtRisk: skus.skusAtRisk,
    expiryExposure: skus.expiryExposure,
  };
}

const totalOf = (
  lines: {
    inBasket: boolean;
    status: RecommendationStatus;
    totals: LineTotals;
  }[],
) =>
  planTotal(
    lines.map((l) => ({
      lineTotal: l.totals.lineTotal,
      inBasket: l.inBasket,
      status: l.status,
    })),
  );

async function updatePlanTotals(
  sql: SqlHandle,
  planId: string,
  args: {
    budget: Money;
    total: Money;
    impact: ImpactCard;
    extra?: postgres.PendingQuery<postgres.Row[]>;
  },
) {
  await sql`
    update purchase_plans set
      budget_limit = ${args.budget},
      proposed_total = ${args.total},
      budget_remaining = ${budgetRemaining(args.budget, args.total)},
      impact_json = ${sql.json(args.impact as unknown as postgres.JSONValue)},
      updated_at = now()
      ${args.extra ?? sql``}
    where id = ${planId}
  `;
}

function overBudget(total: Money, budget: Money): ServiceError {
  const overBy = toMoneyString(dec(total).minus(budget));
  return new ServiceError("OVER_BUDGET", 409, `This change takes the plan ₹${overBy} over its ₹${budget} budget.`, {
    overBy,
    budget,
    planTotal: total,
  });
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
async function analyseOne(
  sql: SqlHandle,
  productId: string,
  state: { asOf: string; scenarioId: string },
): Promise<{ sku: SkuContext; analysis: SkuAnalysis; asOf: string }> {
  const { asOf } = state;
  const ctx = await loadPlanningContext(sql, asOf, state.scenarioId, productId);
  const sku = ctx.skus[0];
  if (!sku) throw new ServiceError("INVALID_SKU", 400, "The product is no longer active.");
  return { sku, analysis: analyseSku(sku), asOf };
}

// ---------------------------------------------------------------------------
// createPlan (§7.2)
// ---------------------------------------------------------------------------

export async function createPlan(
  input: { budget: number | string; priorities?: string },
  actor: Actor = defaultActor(),
  sql: postgres.Sql = getSql(),
): Promise<{ planId: string; durationMs: number }> {
  const budgetDec = dec(input.budget);
  if (!budgetDec.isFinite() || !budgetDec.greaterThan(0)) {
    throw new ServiceError("INVALID_BUDGET", 400, "Budget must be a positive amount in rupees.");
  }
  const budget = toMoneyString(budgetDec);
  const t0 = performance.now();

  const { asOf, scenarioId } = await resolvePlanningState(sql);
  const ctx = await loadPlanningContext(sql, asOf, scenarioId);
  const result = buildPlan(ctx, budget);

  // The id is generated here so the plan, its lines and the audit row go out in one pipelined round trip.
  const planId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    const assumptions = {
      config: ENGINE_CONFIG,
      asOf,
      scenarioId,
      priorities: input.priorities ?? null,
    };
    const plan = { id: planId };
    // Pipelining: a raw query is sent only when awaited, unless .execute() is called; the async helpers send on call.
    // So every raw query below calls .execute(), and the statements reach the database in array order.
    await Promise.all([
      tx`
        insert into purchase_plans (id, budget_limit, proposed_total, budget_remaining, status, scenario_id, as_of_date, assumptions_json, impact_json)
        values (
          ${planId}, ${budget}, ${result.planTotal}, ${result.budgetRemaining}, 'draft', ${scenarioId}, ${asOf},
          ${tx.json(assumptions as unknown as postgres.JSONValue)},
          ${tx.json(result.impact as unknown as postgres.JSONValue)}
        )
      `.execute(),
      upsertRows(
        tx,
        plan.id,
        result.lines.map((l, i) => planLineToRow(l, i + 1)),
      ),
      writeAudit(
        {
          actorType: actor.type,
          actorId: actor.id,
          action: "plan.created",
          entityType: "plan",
          entityId: plan.id,
          after: {
            budget,
            planTotal: result.planTotal,
            lines: result.lines.length,
            inBasket: result.lines.filter((l) => l.inBasket).length,
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
  console.info(`[plans] createPlan ${planId}: ${result.lines.length} lines, ₹${result.planTotal} of ₹${budget} in ${durationMs} ms`);
  return { planId, durationMs };
}

// ---------------------------------------------------------------------------
// editLine (§7.3)
// ---------------------------------------------------------------------------

export type EditResult = {
  preview: boolean;
  before: LineView;
  after: LineView;
  plan: PlanSummary;
};

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
      const { sku, analysis, asOf } = await analyseOne(tx, before.productId, state);
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
        const fits =
          hardStops({
            product: sku.product,
            offer,
            supplier: supplierOf(offer),
            qty,
            asOf,
            batches: sku.batches,
          }).length === 0;
        if (!fits) {
          const engineQty = ev?.scheme?.qty ?? 0;
          qty = engineQty > 0 ? engineQty : Math.ceil(Math.max(qty, offer.moq, 1) / offer.packMultiple) * offer.packMultiple;
        }
      } else {
        offer = sku.offers.find((o) => o.id === before.offerId);
        if (!offer) throw new ServiceError("NO_ELIGIBLE_OFFER", 400, "This line has no eligible offer to buy from.");
        if (change.kind === "qty") qty = change.qty;
      }

      const stops = hardStops({
        product: sku.product,
        offer,
        supplier: supplierOf(offer),
        qty,
        asOf,
        batches: sku.batches,
      });
      if (stops.length > 0) throw hardStopError(stops);

      const supplier = supplierOf(offer)!;
      const totals = lineTotals({
        qty,
        unitPrice: offer.unitPrice!,
        taxRate: offer.taxRate,
        freightPerPack: offer.freightPerPack,
      });
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
      else
        evidencePatch = {
          userEdit: {
            qty,
            offerId: offer.id,
            engineOfferId,
            engineQty: analysis.qty,
            asOf,
          },
        };
    }
    after.counted = isCounted(after);

    const nextLines = lines.map((l) => (l.id === lineId ? after : l));
    const total = totalOf(nextLines);
    if (dec(total).greaterThan(plan.budget)) throw overBudget(total, plan.budget);

    const impact = impactFromLines(nextLines, plan.budget, plan.impact);
    const summary: PlanSummary = {
      ...toSummary(plan),
      proposedTotal: total,
      budgetRemaining: budgetRemaining(plan.budget, total),
      impact,
    };
    if (preview) return { preview: true, before, after, plan: summary };

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
      updatePlanTotals(tx, planId, { budget: plan.budget, total, impact }),
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
    return { preview: false, before, after, plan: toSummary(saved!) };
  });
}

// ---------------------------------------------------------------------------
// recalculatePlan (§7.5)
// ---------------------------------------------------------------------------

export async function recalculatePlan(
  planId: string,
  opts: { budget?: number | string; actor?: Actor } = {},
  sql: postgres.Sql = getSql(),
): Promise<PlanView> {
  const actor = opts.actor ?? defaultActor();

  return sql.begin(async (tx) => {
    const t0 = performance.now();
    const [plan, lineRows, { asOf, scenarioId }] = await Promise.all([
      selectPlan(tx, planId, true),
      selectLines(tx, planId),
      resolvePlanningState(tx),
    ]);
    if (!plan) throw notFound("Plan", planId);
    if (LOCKED_PLAN.has(plan.status)) {
      throw new ServiceError("PLAN_LOCKED", 409, `The plan is ${plan.status} and cannot be recalculated.`);
    }
    let budget = plan.budget;
    if (opts.budget !== undefined) {
      const b = dec(opts.budget);
      if (!b.isFinite() || !b.greaterThan(0)) throw new ServiceError("INVALID_BUDGET", 400, "Budget must be a positive amount in rupees.");
      budget = toMoneyString(b);
    }

    const beforeLines = lineRows.map(toLineView);
    const ctx = await loadPlanningContext(tx, asOf, scenarioId);
    const skuById = new Map(ctx.skus.map((s) => [s.product.id, s]));

    // Partition the saved lines (§7.5).
    const byRank = [...beforeLines].sort((a, b) => a.rank - b.rank);
    const frozen = byRank.filter((l) => l.status === "approved_for_po");
    const systemDeferred = (l: LineView) => l.status === "deferred" && l.deferReason === "OVER_BUDGET";
    const edited = byRank.filter((l) => l.status === "edited" || systemDeferred(l));
    const kept = byRank.filter((l) => l.status === "rejected" || (l.status === "deferred" && !systemDeferred(l)));
    const fixedIds = new Set([...frozen, ...edited, ...kept].map((l) => l.productId));

    // 1. Approved lines count first.
    const frozenTotal = sumMoney(frozen.map((l) => l.totals.lineTotal));
    if (frozenTotal.greaterThan(budget)) throw overBudget(frozenTotal.toFixed(2), budget);
    let remaining = dec(budget).minus(frozenTotal);

    // 2. Edited lines keep the owner's qty/offer at fresh prices, placed first if they fit.
    const analyses = new Map<string, SkuAnalysis>();
    for (const l of [...frozen, ...edited, ...kept]) {
      const s = skuById.get(l.productId);
      if (s) analyses.set(l.productId, analyseSku(s));
    }
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
        reason_codes: (a?.reasons ?? l.reasons).filter((r) => r !== "BUDGET_DEFERRED"),
        warnings: l.warnings,
        user_note: l.userNote,
        evidence_json: a
          ? {
              ...a.evidence,
              skuStatus: a.status,
              lossPrevented: a.lossPrevented,
              expiryAvoidedValue: a.expiryAvoidedValue,
            }
          : {},
      };
      const stops =
        s && offer
          ? hardStops({
              product: s.product,
              offer,
              supplier: s.suppliers[offer.supplierId],
              qty: l.qty,
              asOf,
              batches: s.batches,
            })
          : ["INVALID_SKU"];
      if (!s || !offer || stops.length > 0) {
        return {
          ...base,
          ...rowTotals(l.totals),
          in_basket: false,
          status: "deferred" as const,
          defer_reason: stops[0] ?? "OFFER_UNAVAILABLE",
        };
      }
      const totals = lineTotals({
        qty: l.qty,
        unitPrice: offer.unitPrice!,
        taxRate: offer.taxRate,
        freightPerPack: offer.freightPerPack,
      });
      const row = {
        ...base,
        unit_price: offer.unitPrice,
        free_qty: schemeFree(offer, l.qty),
        ...rowTotals(totals),
      };
      if (dec(totals.lineTotal).lessThanOrEqualTo(remaining)) {
        remaining = remaining.minus(totals.lineTotal);
        return {
          ...row,
          in_basket: true,
          status: "edited" as const,
          defer_reason: null,
        };
      }
      return {
        ...row,
        in_basket: false,
        status: "deferred" as const,
        defer_reason: "OVER_BUDGET",
        reason_codes: [...row.reason_codes, "BUDGET_DEFERRED"],
      };
    });

    // 3. Every other SKU is re-planned by the engine with what is left of the budget.
    const sub = buildPlan({ asOf, skus: ctx.skus.filter((s) => !fixedIds.has(s.product.id)) }, remaining.toFixed(2));

    // Ranks: approved, edited, engine lines, then rejected / owner-deferred.
    let rank = 0;
    const next = () => ++rank;
    const rankOnly = [...frozen.map((l) => ({ id: l.id, rank: next() }))];
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
    const skuStatuses = [
      ...sub.skuStatuses,
      ...[...analyses.values()].map((a) => ({
        status: a.status,
        atRiskValue: a.expiry.atRiskValue,
      })),
    ];
    const impact = impactFromLines(afterLines, budget, {
      skusAtRisk: skuStatuses.filter((s) => s.status === "STOCKOUT_RISK").length,
      expiryExposure: sumMoney(skuStatuses.map((s) => s.atRiskValue)).toFixed(2),
    });
    const assumptions = {
      ...plan.assumptions,
      config: ENGINE_CONFIG,
      asOf,
      scenarioId,
      recalculatedAt: new Date().toISOString(),
    };
    const beforeIn = new Map(beforeLines.map((l) => [l.sku, l.counted]));
    const afterIn = new Map(afterLines.map((l) => [l.sku, l.counted]));
    const changed = [...new Set([...beforeIn.keys(), ...afterIn.keys()])]
      .filter((sku) => beforeIn.get(sku) !== afterIn.get(sku))
      .sort()
      .map((sku) => ({
        sku,
        inBasketBefore: beforeIn.get(sku) ?? null,
        inBasketAfter: afterIn.get(sku) ?? null,
      }));
    const [, , saved] = await Promise.all([
      updatePlanTotals(tx, planId, {
        budget,
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
          before: {
            budget: plan.budget,
            planTotal: plan.proposed_total,
            lines: beforeLines.length,
          },
          after: {
            budget,
            planTotal: total,
            lines: afterLines.length,
            asOf,
            scenarioId,
            changed,
          },
        },
        tx,
      ),
      selectPlan(tx, planId),
    ]);
    console.info(
      `[plans] recalculatePlan ${planId}: ₹${total} of ₹${budget}, ${changed.length} lines changed basket in ${Math.round(performance.now() - t0)} ms`,
    );

    return { ...toSummary(saved!), lines: afterLines };
  });
}

function rowTotals(t: LineTotals) {
  return {
    line_subtotal: t.lineSubtotal,
    line_tax: t.lineTax,
    line_freight: t.lineFreight,
    line_total: t.lineTotal,
  };
}
