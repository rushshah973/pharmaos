// Request schemas for the API routes (implementationplan.md §8).
import { z } from "zod";
import { HEATMAP_MODES } from "@/lib/business-logic/heatmap";

export const analyzeBody = z
  .object({
    priorities: z.string().trim().max(500).optional(),
  })
  .strict();
export type AnalyzeBody = z.infer<typeof analyzeBody>;

/** Route ids. A malformed id is a 404 (no such plan), not a 400. */
export const uuid = z.uuid();

/**
 * PATCH a line: exactly one change, plus optional `preview`.
 * `reason` belongs to the status change (required for deferred / rejected).
 */
export const patchLineBody = z
  .object({
    qty: z.number().int().positive().optional(),
    offerId: z.uuid().optional(),
    status: z.enum(["deferred", "rejected", "proposed"]).optional(),
    reason: z.string().trim().min(3).max(500).optional(),
    note: z.string().trim().max(1000).optional(),
    preview: z.boolean().optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const changes = [b.qty !== undefined, b.offerId !== undefined, b.status !== undefined, b.note !== undefined].filter(Boolean).length;
    if (changes !== 1) {
      ctx.addIssue({ code: "custom", message: "Send exactly one change: qty, offerId, status or note.", path: [] });
    }
    if ((b.status === "deferred" || b.status === "rejected") && !b.reason) {
      ctx.addIssue({ code: "custom", message: "A reason (3+ characters) is required to defer or reject a line.", path: ["reason"] });
    }
    if (b.reason !== undefined && b.status === undefined) {
      ctx.addIssue({ code: "custom", message: "reason is only used with a status change.", path: ["reason"] });
    }
  });
export type PatchLineBody = z.infer<typeof patchLineBody>;

export type LineChange =
  | { kind: "qty"; qty: number }
  | { kind: "offer"; offerId: string }
  | { kind: "status"; status: "deferred" | "rejected"; reason: string }
  | { kind: "restore" }
  | { kind: "note"; note: string };

export function toLineChange(b: PatchLineBody): LineChange {
  if (b.qty !== undefined) return { kind: "qty", qty: b.qty };
  if (b.offerId !== undefined) return { kind: "offer", offerId: b.offerId };
  if (b.status === "proposed") return { kind: "restore" };
  if (b.status) return { kind: "status", status: b.status, reason: b.reason! };
  return { kind: "note", note: b.note! };
}

export const recalculateBody = z.object({}).strict();
export type RecalculateBody = z.infer<typeof recalculateBody>;

/** POST /api/purchase-plans/[id]/approve — the client generates idempotencyKey once per confirmation dialog. */
export const approveBody = z
  .object({
    lineIds: z.array(z.uuid()).min(1).max(200),
    idempotencyKey: z.uuid(),
  })
  .strict();

const reason = z.string().trim().min(3, "Give a reason of at least 3 characters.").max(500);

export const rejectPlanBody = z.object({ reason }).strict();
export const approvePoBody = z.object({ note: z.string().trim().max(500).optional() }).strict();
export const rejectPoBody = z.object({ reason }).strict();

/** GET /api/warehouse/heatmap?mode=&planId= — planId is required for the proposed mode (checked by the service). */
export const heatmapQuery = z
  .object({
    mode: z.enum(HEATMAP_MODES, { error: `mode must be one of ${HEATMAP_MODES.join(", ")}.` }),
    planId: z.uuid({ error: "planId must be a plan id." }).optional(),
  })
  .strict();

/** POST /api/agent/chat — Ask PharmaOS. */
export const chatBody = z
  .object({
    message: z.string().trim().min(1, "Type a question.").max(2000, "Keep the question under 2000 characters."),
    planId: z.uuid().optional(),
  })
  .strict();

/** POST /api/agents/run — the three-agent pipeline on a plan's top N proposed lines. */
export const runAgentsBody = z
  .object({
    planId: z.uuid(),
    maxSkus: z.number().int().min(1).max(30).default(15),
  })
  .strict();

/** PATCH /api/settings: the Owner approval limit in rupees (a PO above it needs the Owner). */
export const settingsBody = z.object({ poApprovalLimit: z.number().positive().max(1e9) }).strict();

/** POST /api/purchase-orders/[id]/receive: what arrived, per line. */
export const receiveBody = z
  .object({
    lines: z
      .array(
        z.object({
          lineId: z.uuid(),
          qty: z.number().int().min(0).max(1_000_000),
          batchNumber: z.string().trim().max(24),
          expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          binId: z.uuid(),
        }),
      )
      .min(1)
      .max(200),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
