import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { handle, parseBody } from "@/lib/api/http";
import { approveLines } from "@/lib/services/approval";
import { approveBody, uuid } from "@/lib/validation/api";

// POST /api/purchase-plans/[id]/approve — the only route that creates purchase orders (§7.6). Idempotent per key.
export async function POST(req: Request, ctx: RouteContext<"/api/purchase-plans/[id]/approve">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw notFound("Plan", id);
    const body = await parseBody(req, approveBody);
    const result = await approveLines(id, body.lineIds, body.idempotencyKey);
    return NextResponse.json(result, { status: result.alreadyProcessed ? 200 : 201 });
  });
}
