import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle, parseBody } from "@/lib/api/http";
import { approvePo } from "@/lib/services/purchase-orders";
import { approvePoBody, uuid } from "@/lib/validation/api";

// POST /api/purchase-orders/[id]/approve — Owner approval: pending_approval → approved.
export async function POST(req: Request, ctx: RouteContext<"/api/purchase-orders/[id]/approve">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${id} was not found.`);
    const body = await parseBody(req, approvePoBody);
    return NextResponse.json(await approvePo(id, { note: body.note }));
  });
}
