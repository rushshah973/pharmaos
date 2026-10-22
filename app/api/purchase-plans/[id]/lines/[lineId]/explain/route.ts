import { connection, NextResponse } from "next/server";
import { notFound } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { runAgent } from "@/lib/agents/orchestrator";
import { explainLine } from "@/lib/services/explain";
import { getLine } from "@/lib/services/plans";
import { uuid } from "@/lib/validation/api";

// POST /api/purchase-plans/[id]/lines/[lineId]/explain — the agent first (grounded in tool results for this
// line), then the deterministic explanation from the line's evidence if the AI is unavailable or fails.
export async function POST(_req: Request, ctx: RouteContext<"/api/purchase-plans/[id]/lines/[lineId]/explain">) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { id, lineId } = await ctx.params;
    if (!uuid.safeParse(id).success) throw notFound("Plan", id);
    if (!uuid.safeParse(lineId).success) throw notFound("Line", lineId);
    const line = await getLine(id, lineId);
    const agent = await runAgent({
      planId: id,
      message:
        `Explain in 3 to 5 short sentences why this purchase plan recommends line ${lineId}: SKU ${line.sku}, ` +
        `${line.qty} packs from ${line.supplierCode ?? "no supplier"}. Use the tools for every number ` +
        `(stock, demand, supplier comparison, reorder quantity).`,
    });
    if (agent.source === "agent") return NextResponse.json({ text: agent.reply, source: "agent" as const, toolCalls: agent.toolCalls });
    return NextResponse.json({ text: explainLine(line.evidence, line), source: "deterministic" as const });
  });
}
