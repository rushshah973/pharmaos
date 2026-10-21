import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { getLayout } from "@/lib/services/warehouse";

// GET /api/warehouse/layout — every bin with its geometry and fill, plus the scene bounds.
export async function GET() {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => NextResponse.json(await getLayout()));
}
