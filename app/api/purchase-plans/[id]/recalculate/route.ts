import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { handle, parseBody } from "@/lib/api/http";
import { recalculatePlan } from "@/lib/services/plans";
import { recalculateBody, uuid } from "@/lib/validation/api";

// POST /api/purchase-plans/[id]/recalculate — re-plan with fresh data and the active scenario (§7.5).
export async function POST(req: Request, ctx: RouteContext<"/api/purchase-plans/[id]/recalculate">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw notFound("Plan", id);
    await parseBody(req, recalculateBody);
    return NextResponse.json(await recalculatePlan(id));
  });
}
