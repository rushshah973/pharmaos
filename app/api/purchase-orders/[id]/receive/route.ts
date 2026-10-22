import { connection, NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api/http";
import { getReceiptDraft, receivePurchaseOrder } from "@/lib/services/receiving";
import { receiveBody } from "@/lib/validation/api";

// GET  /api/purchase-orders/[id]/receive — the receipt draft (full quantities, batch numbers, suggested bins).
// POST /api/purchase-orders/[id]/receive { lines } — receive the goods into bins (audit po.received).
export async function GET(_req: Request, ctx: RouteContext<"/api/purchase-orders/[id]/receive">) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { id } = await ctx.params;
    return NextResponse.json(await getReceiptDraft(id));
  });
}

export async function POST(req: Request, ctx: RouteContext<"/api/purchase-orders/[id]/receive">) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await parseBody(req, receiveBody);
    return NextResponse.json(await receivePurchaseOrder(id, body));
  });
}
