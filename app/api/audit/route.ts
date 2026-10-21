import { connection, NextResponse } from "next/server";
import { handle } from "@/lib/api/http";
import { listAudit } from "@/lib/services/audit";

// GET /api/audit?limit=&before=&action=&entity= — newest first, for the Activity log's "Load more".
export async function GET(req: Request) {
  await connection(); // outside handle(): Next rejects it on purpose to stop prerendering
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const before = q.get("before");
    const rows = await listAudit({
      limit: Number(q.get("limit") ?? 50) || 50,
      before: before && /^\d+$/.test(before) ? before : undefined,
      action: q.get("action")?.slice(0, 64) || undefined,
      entity: q.get("entity")?.slice(0, 64) || undefined,
    });
    return NextResponse.json({ rows });
  });
}
