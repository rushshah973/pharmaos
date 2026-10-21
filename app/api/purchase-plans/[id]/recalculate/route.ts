import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { handle, parseBody } from "@/lib/api/http";
import { recalculatePlan } from "@/lib/services/plans";
import { recalculateBody, uuid } from "@/lib/validation/api";

// POST /api/purchase-plans/[id]/recalculate — rebuild the basket with fresh data, optionally a new budget (§7.5).
export async function POST(req: Request, ctx: RouteContext<"/api/purchase-plans/[id]/recalculate">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw notFound("Plan", id);
    const body = await parseBody(req, recalculateBody, "INVALID_BUDGET");
    return NextResponse.json(await recalculatePlan(id, { budget: body.budget }));
  });
}
