import { connection, NextResponse } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { getRun } from "@/lib/services/agent-runs";
import { uuid } from "@/lib/validation/api";

// GET /api/agents/runs/[id] — the run and every step (tool calls, decisions, rejected decisions, fallbacks).
export async function GET(_req: Request, ctx: RouteContext<"/api/agents/runs/[id]">) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { id } = await ctx.params;
    if (!uuid.safeParse(id).success) throw new ServiceError("RUN_NOT_FOUND", 404, `Agent run ${id} was not found.`);
    return NextResponse.json(await getRun(id));
  });
}
