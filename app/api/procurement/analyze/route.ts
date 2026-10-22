import { after, NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api/http";
import { generatePlanSummary } from "@/lib/agents/summary";
import { createPlan } from "@/lib/services/plans";
import { analyzeBody } from "@/lib/validation/api";

// POST /api/procurement/analyze — build and save a ranked purchase plan (§7.2). 201 { planId }.
// With a Gemini key, the AI summary is written after the response is sent, so creating a plan never waits on it.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, analyzeBody);
    const { planId } = await createPlan(body);
    if (process.env.GEMINI_API_KEY?.trim()) after(() => generatePlanSummary(planId));
    return NextResponse.json({ planId }, { status: 201 });
  });
}
