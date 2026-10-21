import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { explainLine } from "@/lib/services/explain";
import { getLine } from "@/lib/services/plans";
import { uuid } from "@/lib/validation/api";

// POST /api/purchase-plans/[id]/lines/[lineId]/explain — deterministic for now; the agent arrives in stage 6.
export async function POST(_req: Request, ctx: RouteContext<"/api/purchase-plans/[id]/lines/[lineId]/explain">) {
  return handle(async () => {
    const { id, lineId } = await ctx.params;
    if (!uuid.safeParse(id).success) throw notFound("Plan", id);
    if (!uuid.safeParse(lineId).success) throw notFound("Line", lineId);
    const line = await getLine(id, lineId);
    const text = explainLine(line.evidence, line);
    return NextResponse.json({ text, source: "deterministic" as const });
  });
}
