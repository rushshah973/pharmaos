import { after, connection, NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api/http";
import { runPipeline } from "@/lib/agents/pipeline/run";
import { createRun } from "@/lib/services/agent-runs";
import { runAgentsBody } from "@/lib/validation/api";

// after() work counts toward this limit: three agents, each Gemini call up to 30 s plus retries on the backup model.
export const maxDuration = 300;

// POST /api/agents/run { planId, maxSkus? } → 202 { runId }. The pipeline runs after the response (next/server
// after); the UI polls GET /api/agents/runs/[id]. One running run per plan (409 RUN_IN_PROGRESS).
export async function POST(req: Request) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const { planId, maxSkus } = await parseBody(req, runAgentsBody);
    const runId = await createRun(planId, maxSkus);
    after(() => runPipeline(runId));
    return NextResponse.json({ runId }, { status: 202 });
  });
}
