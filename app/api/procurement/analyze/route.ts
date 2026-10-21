import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api/http";
import { createPlan } from "@/lib/services/plans";
import { analyzeBody } from "@/lib/validation/api";

// POST /api/procurement/analyze — build and save a ranked purchase plan (§7.2). 201 { planId }.
export async function POST(req: Request) {
  return handle(async () => {
    const body = await parseBody(req, analyzeBody);
    const { planId } = await createPlan(body);
    return NextResponse.json({ planId }, { status: 201 });
  });
}
