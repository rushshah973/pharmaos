import { connection, NextResponse } from "next/server";
import { getSql, transactionPoolerUrl } from "@/lib/db/client";

// GET /api/health — is the database reachable from this deployment? Reports which host/port the app is
// configured for (on Vercel: the transaction pooler port it switches to) and the database error code and message, never the password or the full connection string.
export async function GET() {
  await connection();
  const raw = process.env.DATABASE_URL?.trim() ?? "";
  let target: { host: string; port: string; user: string } | null = null;
  try {
    const u = new URL(process.env.VERCEL && process.env.DATABASE_POOLER !== "session" ? transactionPoolerUrl(raw) : raw);
    target = { host: u.hostname, port: u.port || "5432", user: u.username };
  } catch {
    target = null;
  }
  const t0 = performance.now();
  try {
    const [row] = await getSql()<{ skus: number; asOf: string | null }[]>`
      select (select count(*)::int from products where is_active) as skus,
        (select to_char(max(sale_date), 'YYYY-MM-DD') from sales_history) as "asOf"
    `;
    return NextResponse.json({
      ok: true,
      region: process.env.VERCEL_REGION ?? "local",
      database: { ...target, ms: Math.round(performance.now() - t0), activeSkus: row.skus, latestSale: row.asOf },
      gemini: Boolean(process.env.GEMINI_API_KEY?.trim()),
    });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    const message = (e.message ?? String(err)).replace(/postgres(ql)?:\/\/\S+/g, "[url]").slice(0, 300);
    return NextResponse.json(
      {
        ok: false,
        region: process.env.VERCEL_REGION ?? "local",
        databaseUrlSet: raw.length > 0,
        databaseUrlParses: target !== null,
        database: target,
        error: { code: e.code ?? null, message, ms: Math.round(performance.now() - t0) },
      },
      { status: 503 },
    );
  }
}
