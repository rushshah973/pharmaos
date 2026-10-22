// Supplier Agent (implementationplan.md §9.5): runs after the Demand Agent's decisions are saved, so it compares
// offers for the forecast each line now uses. It may switch a line to another offer — faster, cheaper, consolidating
// suppliers, or keeping a supplier PO under the Owner limit — but only to an offer with NO exclusion codes that also
// passes every hard stop for the line's quantity (editLine's validation). Anything else is rejected and logged; the
// line keeps its offer. Effect: editLine with actor supplier-agent, the agent's reason and evidence.supplierDecision.
import { z } from "zod";
import { ServiceError } from "@/lib/api/errors";
import { formatINR } from "@/lib/money";
import { analyseLine } from "@/lib/services/agent-data";
import { resolvePlanningState } from "@/lib/services/as-of";
import { editLine, getPlan } from "@/lib/services/plans";
import { type RunContext, lineFor, runLinesText } from "./context";
import { type AgentOutcome, type AgentTool, runAgentLoop } from "./loop";

const SYSTEM = `You are the Supplier Agent in PharmaOS, a procurement system for an Indian pharmaceutical stockist.
For each SKU you are given, decide which supplier offer the purchase plan should buy from.
Rules:
- Use compare_supplier_offers for each SKU: it shows every offer for the forecast the Demand Agent chose, with exclusion
  codes, quantity, landed cost, lead time, score and the offer the plan uses now. Use get_po_projection and
  get_approval_limit to see each supplier's purchase order total and the Owner approval limit.
- Only choose an offer with no exclusion codes. Keep the current offer unless another one is clearly better: it avoids a
  stockout, costs less, consolidates SKUs onto one supplier, or keeps a supplier PO at or below the Owner approval limit.
- Never switch to an offer whose quantity is less than half of the line's current quantity (small top-up offers):
  that would under-order the medicine, and the system refuses it.
- Never invent numbers; give a short reason (at least 10 characters) that cites the evidence.
- Only decide for the SKUs listed. Finish by calling submit_supplier_decisions exactly once with one decision per SKU
  (the current offer id when you keep it).`;

export const supplierTerminalDecision = z
  .object({
    sku: z.string().trim().min(3),
    offerId: z.uuid(),
    reason: z.string().trim().min(10).max(500),
  })
  .strict();

export type SupplierSummary = { accepted: number; rejected: number; switched: { sku: string; from: string | null; to: string; qty: number }[] };

export function supplierTools(ctx: RunContext): AgentTool[] {
  return [
    {
      name: "compare_supplier_offers",
      description: "Every offer for one SKU in this run, evaluated with the forecast method saved on the line: exclusion codes, quantity and free packs, landed cost per pack, line total, lead time, factor scores and score, the engine's pick and the offer the line uses now.",
      schema: z.object({ sku: z.string().trim().min(3).max(32) }),
      handler: async ({ sku }: { sku: string }) => {
        const line = lineFor(ctx, sku);
        const { line: row, sku: s, analysis: a, override } = await analyseLine(ctx.planId, line.lineId);
        return {
          sku: a.sku,
          demandMethod: a.demand.method,
          demandChosenBy: override ? "demand-agent" : "default rule",
          dailyDemand: a.demand.avgDailyDemand,
          coverDays: a.cover,
          currentOfferId: row.offerId,
          currentQty: row.qty,
          enginePick: a.chosen?.offerId ?? null,
          offers: a.offers.map((e) => {
            const o = s.offers.find((x) => x.id === e.offerId)!;
            return {
              offerId: e.offerId,
              supplierCode: e.supplierCode,
              exclusions: e.exclusions,
              qty: e.scheme?.qty ?? e.order?.q ?? null,
              freeQty: e.scheme?.freeQty ?? 0,
              effectiveCost: e.effectiveCost,
              lineTotal: e.totals?.lineTotal ?? null,
              leadTimeDays: o.leadTimeDays,
              moq: o.moq,
              packMultiple: o.packMultiple,
              availableQty: o.availableQty,
              score: e.score,
              factors: e.factors,
            };
          }),
        };
      },
    },
    {
      name: "get_po_projection",
      description: "The purchase order each supplier would get from this plan now: lines, total and whether it needs the Owner's approval.",
      schema: z.object({}),
      handler: async () => {
        const p = await getPlan(ctx.planId);
        return { planTotal: p.proposedTotal, approvalLimit: p.approvalLimit, supplierPos: p.supplierPos.map((s) => ({ supplierCode: s.supplierCode, lines: s.lines, total: s.total, ownerApproval: s.needsApproval ? "required" : "not required" })) };
      },
    },
    {
      name: "get_approval_limit",
      description: "The Owner approval limit: a supplier purchase order above it needs the Owner's approval before it can be sent.",
      schema: z.object({}),
      handler: async () => {
        const { approvalLimit } = await resolvePlanningState();
        return { approvalLimit, formatted: formatINR(approvalLimit, { paise: false }) };
      },
    },
  ];
}

/** Applies a submitted decision list: per-item guardrail (no exclusions, hard stops via editLine), then the effect. */
/** A supplier switch may not leave the line with less than this share of its packs. */
export const MIN_QTY_KEPT = 0.5;

export async function applySupplierDecisions(ctx: RunContext, decisions: Record<string, unknown>[]): Promise<SupplierSummary> {
  const out: SupplierSummary = { accepted: 0, rejected: 0, switched: [] };
  for (const raw of decisions) {
    const parsed = supplierTerminalDecision.safeParse(raw);
    const reject = async (code: string, message: string, extra: Record<string, unknown> = {}) => {
      out.rejected++;
      await ctx.log.add({ agent: "supplier", kind: "rejected_decision", input: raw, output: { code, message, ...extra }, ok: false });
    };
    if (!parsed.success) {
      await reject("INVALID_DECISION", "A decision is a SKU, an offer id and a reason of 10+ characters.", { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      continue;
    }
    const d = parsed.data;
    try {
      const line = lineFor(ctx, d.sku);
      const { line: row, analysis: a } = await analyseLine(ctx.planId, line.lineId);
      const ev = a.offers.find((e) => e.offerId === d.offerId);
      if (!ev) {
        await reject("OFFER_NOT_FOR_SKU", `Offer ${d.offerId} is not an offer for ${line.sku}.`);
        continue;
      }
      if (ev.exclusions.length > 0) {
        await reject("OFFER_EXCLUDED", `${ev.supplierCode}'s offer is excluded (${ev.exclusions.join(", ")}); the line keeps its offer.`, { exclusions: ev.exclusions });
        continue;
      }
      if (row.offerId === d.offerId) {
        out.accepted++;
        await ctx.log.add({ agent: "supplier", kind: "decision", input: d, output: { changed: false, supplierCode: ev.supplierCode } });
        continue;
      }
      // A switch keeps the line's quantity when the new offer allows it, else takes what the engine would buy from
      // that offer. A small top-up offer can then cut the order sharply (22 Oct: 880 → 15 packs of a SKU about to
      // run out), so the switch is previewed first and refused if the line would lose more than half its packs.
      const preview = await editLine(ctx.planId, line.lineId, { kind: "offer", offerId: d.offerId }, { preview: true });
      if (preview.after.qty < preview.before.qty * MIN_QTY_KEPT) {
        await reject(
          "QTY_CUT_TOO_FAR",
          `Switching ${line.sku} to ${ev.supplierCode} would cut the order from ${preview.before.qty} to ${preview.after.qty} packs (more than half); the line keeps its offer.`,
          { qtyBefore: preview.before.qty, qtyAfter: preview.after.qty },
        );
        continue;
      }
      const r = await editLine(
        ctx.planId,
        line.lineId,
        { kind: "offer", offerId: d.offerId },
        {
          actor: { type: "agent", id: "supplier-agent" },
          reason: d.reason,
          evidence: { supplierDecision: { offerId: d.offerId, supplierCode: ev.supplierCode, reason: d.reason, by: "supplier-agent" } },
        },
      );
      out.accepted++;
      out.switched.push({ sku: line.sku, from: r.before.supplierCode, to: ev.supplierCode, qty: r.after.qty });
      await ctx.log.add({
        agent: "supplier",
        kind: "decision",
        input: d,
        output: { changed: true, from: r.before.supplierCode, to: r.after.supplierCode, qtyBefore: r.before.qty, qtyAfter: r.after.qty, lineTotalBefore: r.before.totals.lineTotal, lineTotalAfter: r.after.totals.lineTotal },
      });
    } catch (err) {
      await reject(err instanceof ServiceError ? err.code : "FAILED", err instanceof Error ? err.message : String(err), err instanceof ServiceError && err.details ? { details: err.details } : {});
    }
  }
  return out;
}

export function runSupplierAgent(ctx: RunContext): Promise<AgentOutcome<SupplierSummary>> {
  return runAgentLoop({
    agent: "supplier",
    client: ctx.client,
    model: ctx.model,
    deadline: ctx.deadline,
    systemPrompt: SYSTEM,
    userMessage: `Choose the supplier offer for each of these SKUs (plan ${ctx.planId}, as of ${ctx.asOf}):\n${runLinesText(ctx)}`,
    tools: supplierTools(ctx),
    terminal: {
      name: "submit_supplier_decisions",
      description: "Submit one decision per SKU: { sku, offerId, reason }. Use the current offer id to keep it.",
      declared: z.object({ decisions: z.array(supplierTerminalDecision).min(1).max(30) }),
      schema: z.object({ decisions: z.array(z.record(z.string(), z.unknown())).min(1).max(30) }),
      apply: ({ decisions }: { decisions: Record<string, unknown>[] }) => applySupplierDecisions(ctx, decisions),
    },
    log: ctx.log,
  });
}
