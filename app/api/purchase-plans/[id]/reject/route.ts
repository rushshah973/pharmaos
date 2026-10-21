import { NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { handle, parseBody } from "@/lib/api/http";
import { rejectPlan } from "@/lib/services/plans";
import { rejectPlanBody, uuid } from "@/lib/validation/api";

// POST /api/purchase-plans/[id]/reject — reason required; creates no POs.
export async function POST(req: Request, ctx: RouteContext<"/api/purchase-plans/[id]/reject">) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw notFound("Plan", id);
    const body = await parseBody(req, rejectPlanBody, "REASON_REQUIRED");
    return NextResponse.json(await rejectPlan(id, body.reason));
  });
}
