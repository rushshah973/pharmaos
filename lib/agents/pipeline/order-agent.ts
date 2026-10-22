// Order Agent (implementationplan.md §9.5): checks the run's lines and creates purchase orders through the same
// approval service a person uses (approveLines, actor order-agent, idempotencyKey = the run id, so a retry never
// duplicates POs). POs come out ready (≤ the Owner limit) or pending_approval (> the limit). This agent has NO tool to
// send a PO, Owner-approve a PO, reject a plan or change the approval limit — those tools do not exist for any AI.
import { z } from "zod";
import { ServiceError } from "@/lib/api/errors";
import { getSql } from "@/lib/db/client";
import { approveLines } from "@/lib/services/approval";
import { getPlan } from "@/lib/services/plans";
import { callToolHandler } from "../tools";
import { type RunContext, runLinesText } from "./context";
import { type AgentOutcome, type AgentTool, runAgentLoop } from "./loop";

const SYSTEM = `You are the Order Agent in PharmaOS, a procurement system for an Indian pharmaceutical stockist.
Your job: turn this run's plan lines into purchase orders.
Rules:
- The message already holds get_plan (this run's lines now) and validate_po (hard stops per line).
- In ONE reply, call create_purchase_orders with every run line that is still proposed or edited, counted in the plan,
  not on a PO yet and has no hard stop; then call submit_order_summary with created = [] (the system records the real
  POs) and each skipped SKU with its reason. The system groups lines into one purchase order per supplier; a PO above
  the Owner approval limit waits for the Owner.
- You cannot send purchase orders, approve them for the Owner, reject the plan or change the approval limit.
- Finish by calling submit_order_summary exactly once with the created PO ids and the skipped SKUs with reasons.`;

export const orderSummary = z
  .object({
    created: z.array(z.uuid()).max(30),
    skipped: z.array(z.object({ sku: z.string().trim().min(1), reason: z.string().trim().min(3) }).strict()).max(30),
  })
  .strict();

/** created = every PO this run's lines are on; addedTo = the run added its lines to a PO an earlier approval created. */
export type OrderSummary = { created: { poId: string; poNumber: string; supplierCode: string; status: string; grandTotal: string; lines: number; ownerApproval: string; addedTo: boolean }[]; skipped: { sku: string; reason: string }[] };

/** POs created by this run: the approval's own audit row for the run's idempotency key. */
async function runPoIds(ctx: RunContext): Promise<string[]> {
  const [row] = await getSql()<{ ids: string[] | null }[]>`
    select array_agg(e->>'id') as ids from audit_logs a, jsonb_array_elements(a.after_json->'purchaseOrders') e
    where a.action = 'plan.lines_approved' and a.entity_id = ${ctx.planId} and a.after_json->>'idempotencyKey' = ${ctx.runId}
  `;
  return row?.ids ?? [];
}

export function orderTools(ctx: RunContext): AgentTool[] {
  const runLineIds = new Set(ctx.lines.map((l) => l.lineId));
  const lineIds = z.array(z.uuid()).min(1).max(30).describe("Line ids from this run");
  const onlyRunLines = (ids: string[]) => {
    const outside = ids.filter((id) => !runLineIds.has(id));
    if (outside.length > 0) throw new ServiceError("LINE_NOT_IN_RUN", 400, `These lines are not in this run: ${outside.join(", ")}.`);
  };
  return [
    {
      name: "get_plan",
      description: "This run's lines as they are now (after the Demand and Supplier agents): line id, SKU, status, quantity, supplier, line total, warnings; and the supplier PO projection with the Owner approval limit.",
      schema: z.object({}),
      handler: async () => {
        const p = await getPlan(ctx.planId);
        return {
          approvalLimit: p.approvalLimit,
          supplierPos: p.supplierPos.map((s) => ({ supplierCode: s.supplierCode, lines: s.lines, total: s.total, ownerApproval: s.needsApproval ? "required" : "not required" })),
          runLines: p.lines
            .filter((l) => runLineIds.has(l.id))
            .map((l) => ({ lineId: l.id, sku: l.sku, status: l.status, counted: l.counted, qty: l.qty, freeQty: l.freeQty, supplierCode: l.supplierCode, lineTotal: l.totals.lineTotal, warnings: l.warnings, poNumber: l.poNumber })),
        };
      },
    },
    {
      name: "validate_po",
      description: "Checks this run's lines against every hard stop (pack multiple, MOQ, availability, quote validity, approved supplier, recall). Writes nothing.",
      schema: z.object({ lineIds }),
      handler: async ({ lineIds: ids }: { lineIds: string[] }) => {
        onlyRunLines(ids);
        return callToolHandler("validate_po", { planId: ctx.planId, lineIds: ids });
      },
    },
    {
      name: "create_purchase_orders",
      description: "Creates purchase orders for these lines: one PO per supplier, ready or awaiting the Owner above the approval limit. Call once with every line to order; repeating the call returns the same POs.",
      schema: z.object({ lineIds }),
      handler: async ({ lineIds: ids }: { lineIds: string[] }) => {
        onlyRunLines(ids);
        try {
          const r = await approveLines(ctx.planId, ids, ctx.runId, { type: "agent", id: "order-agent" });
          return {
            alreadyProcessed: r.alreadyProcessed,
            purchaseOrders: r.purchaseOrders.map((po) => ({ poId: po.id, poNumber: po.poNumber, supplierCode: po.supplierCode, status: po.status, grandTotal: po.grandTotal, lines: po.lines, ownerApproval: po.needsApproval ? "required" : "not required", newPo: !po.addedTo })),
          };
        } catch (err) {
          if (err instanceof ServiceError && err.code === "HARD_STOP") {
            const failures = (err.details as { failures?: { sku: string; codes: string[] }[] } | undefined)?.failures ?? [];
            throw new ServiceError("HARD_STOP", 422, `No POs created: ${failures.map((f) => `${f.sku} (${f.codes.join(", ")})`).join("; ")}. Remove those lines and call again.`);
          }
          throw err;
        }
      },
    },
  ];
}

/** Checks the agent's summary against what the run really created; unknown PO ids are rejected. */
export async function applyOrderSummary(ctx: RunContext, summary: unknown): Promise<OrderSummary> {
  const parsed = orderSummary.safeParse(summary);
  if (!parsed.success) throw new ServiceError("INVALID_TOOL_INPUT", 400, parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const real = new Set(await runPoIds(ctx));
  if (real.size === 0) {
    // Nothing ordered yet: refuse a summary that leaves orderable lines unexplained (the loop asks again).
    const runIds = new Set(ctx.lines.map((l) => l.lineId));
    const orderable = (await getPlan(ctx.planId)).lines.filter((l) => runIds.has(l.id) && l.counted && (l.status === "proposed" || l.status === "edited") && !l.poId);
    if (orderable.length > parsed.data.skipped.length) {
      throw new ServiceError("NO_POS_CREATED", 400, `No purchase orders were created. Call create_purchase_orders with the orderable lines (${orderable.map((l) => l.sku).join(", ")}) first, or list each one under skipped with its reason.`);
    }
  }
  const claimed = parsed.data.created.filter((id) => !real.has(id));
  if (claimed.length > 0) {
    await ctx.log.add({ agent: "order", kind: "rejected_decision", input: { created: claimed }, output: { code: "PO_NOT_CREATED_BY_RUN", message: "These ids are not purchase orders created by this run." }, ok: false });
  }
  const pos = real.size
    ? await getSql()<OrderSummary["created"]>`
        select po.id as "poId", po.po_number as "poNumber", s.supplier_code as "supplierCode", po.status, po.grand_total::text as "grandTotal",
          (select count(*)::int from purchase_order_lines l where l.po_id = po.id) as lines,
          case when po.status = 'pending_approval' then 'required' else 'not required' end as "ownerApproval",
          po.idempotency_key is distinct from ${ctx.runId} as "addedTo"
        from purchase_orders po join suppliers s on s.id = po.supplier_id where po.id = any(${[...real]}::uuid[]) order by po.po_number
      `
    : [];
  const result: OrderSummary = { created: pos, skipped: parsed.data.skipped };
  await ctx.log.add({ agent: "order", kind: "decision", input: parsed.data, output: result });
  return result;
}

export function runOrderAgent(ctx: RunContext): Promise<AgentOutcome<OrderSummary>> {
  return runAgentLoop({
    agent: "order",
    client: ctx.client,
    model: ctx.model,
    deadline: ctx.deadline,
    systemPrompt: SYSTEM,
    userMessage: `Create purchase orders for this run's lines (plan ${ctx.planId}, as of ${ctx.asOf}):\n${runLinesText(ctx)}`,
    tools: orderTools(ctx),
    briefing: [
      { tool: "get_plan", args: {} },
      { tool: "validate_po", args: { lineIds: ctx.lines.map((l) => l.lineId) } },
    ],
    terminal: {
      name: "submit_order_summary",
      description: "Finish: the created PO ids and the skipped SKUs with reasons.",
      declared: orderSummary,
      schema: orderSummary,
      apply: (summary: unknown) => applyOrderSummary(ctx, summary),
    },
    log: ctx.log,
  });
}
