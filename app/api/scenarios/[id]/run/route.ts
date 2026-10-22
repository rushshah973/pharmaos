import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { runScenario } from "@/lib/services/scenarios";

// POST /api/scenarios/[id]/run — make a scenario active (in memory on the next context load; audit scenario.run).
export async function POST(_req: Request, ctx: RouteContext<"/api/scenarios/[id]/run">) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { id } = await ctx.params;
    return NextResponse.json(await runScenario(id));
  });
}
