import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { type PoFilter, listPurchaseOrders } from "@/lib/services/purchase-orders";

const FILTERS: PoFilter[] = ["all", "awaiting", "ready", "sent", "external"];

// GET /api/purchase-orders?filter=all|awaiting|ready|sent|external — newest first.
export async function GET(req: Request) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const f = new URL(req.url).searchParams.get("filter") as PoFilter | null;
    return NextResponse.json({ purchaseOrders: await listPurchaseOrders(f && FILTERS.includes(f) ? f : "all") });
  });
}
