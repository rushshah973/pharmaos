import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { getCommandCenter } from "@/lib/services/dashboard";

// GET /api/dashboard — Command Center metrics (§7.7).
export async function GET() {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    return NextResponse.json(await getCommandCenter());
  });
}
