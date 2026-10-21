import { connection, NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { getPlan } from "@/lib/services/plans";
import { uuid } from "@/lib/validation/api";

// GET /api/purchase-plans/[id] — plan, lines and Impact Card.
export async function GET(_req: Request, ctx: RouteContext<"/api/purchase-plans/[id]">) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw notFound("Plan", id);
    return NextResponse.json(await getPlan(id));
  });
}
