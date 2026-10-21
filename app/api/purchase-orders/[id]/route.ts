import { connection, NextResponse } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { getPurchaseOrder } from "@/lib/services/purchase-orders";
import { uuid } from "@/lib/validation/api";

// GET /api/purchase-orders/[id] — PO with its lines, approvals and (simulated) send details.
export async function GET(_req: Request, ctx: RouteContext<"/api/purchase-orders/[id]">) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw new ServiceError("PO_NOT_FOUND", 404, `Purchase order ${id} was not found.`);
    return NextResponse.json(await getPurchaseOrder(id));
  });
}
