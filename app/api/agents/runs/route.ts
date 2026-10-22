import { connection, NextResponse } from "next/server";
import { ServiceError } from "@/lib/api/errors";
import { handle } from "@/lib/api/http";
import { listRuns } from "@/lib/services/agent-runs";
import { uuid } from "@/lib/validation/api";

// GET /api/agents/runs?planId= — past runs for a plan, newest first.
export async function GET(req: Request) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const planId = new URL(req.url).searchParams.get("planId") ?? "";
    if (!uuid.safeParse(planId).success) throw new ServiceError("VALIDATION_ERROR", 400, "planId must be a plan id.");
    return NextResponse.json({ runs: await listRuns(planId) });
  });
}
