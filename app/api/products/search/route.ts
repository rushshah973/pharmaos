import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { searchProducts } from "@/lib/services/warehouse";

// GET /api/products/search?q= — up to 20 SKUs (q ≥ 2 characters) with the bins that hold them.
export async function GET(req: Request) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return NextResponse.json({ results: await searchProducts(q) });
  });
}
