import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle, parseBody } from "@/lib/api/http";
import { rejectPo } from "@/lib/services/purchase-orders";
import { rejectPoBody, uuid } from "@/lib/validation/api";

// POST /api/purchase-orders/[id]/reject — Owner rejection: pending_approval → rejected (reason required).
export async function POST(req: Request, ctx: RouteContext<"/api/purchase-orders/[id]/reject">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${id} was not found.`);
    const body = await parseBody(req, rejectPoBody, "REASON_REQUIRED");
    return NextResponse.json(await rejectPo(id, body.reason));
  });
}
