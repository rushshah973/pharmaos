import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { resetScenario } from "@/lib/services/scenarios";

// POST /api/scenarios/reset — back to the baseline (audit scenario.reset). The seed tables were never changed.
export async function POST() {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => NextResponse.json(await resetScenario()));
}
