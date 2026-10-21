import { connection, NextResponse } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { getBinDetails } from "@/lib/services/warehouse";
import { uuid } from "@/lib/validation/api";

// GET /api/warehouse/bins/[id] — the bin, its stock by SKU and batch, and each SKU's engine status.
export async function GET(_req: Request, ctx: RouteContext<"/api/warehouse/bins/[id]">) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw new ServiceError("BIN_NOT_FOUND", 404, `Bin ${id} was not found.`);
    return NextResponse.json(await getBinDetails(id));
  });
}
