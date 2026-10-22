import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { listScenarios } from "@/lib/services/scenarios";

// GET /api/scenarios — every scenario and the active one (§12).
export async function GET() {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => NextResponse.json(await listScenarios()));
}
