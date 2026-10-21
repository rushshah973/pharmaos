// Request schemas for the API routes (implementationplan.md §8).
import { z } from "zod";

const budget = z.number().finite().positive().max(1_000_000_000);

export const analyzeBody = z.object({
  budget,
  priorities: z.string().trim().max(500).optional(),
});
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

export const recalculateBody = z.object({ budget: budget.optional() }).strict();
export type RecalculateBody = z.infer<typeof recalculateBody>;
