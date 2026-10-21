import { connection, NextResponse } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { getHeatmap } from "@/lib/services/warehouse";
import { heatmapQuery } from "@/lib/validation/api";

// GET /api/warehouse/heatmap?mode=stockout|expiry|excess|normal|proposed&planId= — severity 0–3, label and value per bin.
export async function GET(req: Request) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const parsed = heatmapQuery.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      throw new ServiceError("VALIDATION_ERROR", 400, issues[0]?.message ?? "Invalid query.", issues);
    }
    return NextResponse.json(await getHeatmap(parsed.data.mode, parsed.data.planId));
  });
}
