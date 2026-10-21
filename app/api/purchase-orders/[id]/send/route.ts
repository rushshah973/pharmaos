import { NextResponse } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { sendPo } from "@/lib/services/purchase-orders";
import { uuid } from "@/lib/validation/api";

// POST /api/purchase-orders/[id]/send — Mark as sent (SIMULATED: nothing is emailed). 409 APPROVAL_REQUIRED above the limit until the Owner approves.
export async function POST(_req: Request, ctx: RouteContext<"/api/purchase-orders/[id]/send">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${id} was not found.`);
    return NextResponse.json(await sendPo(id));
  });
}
