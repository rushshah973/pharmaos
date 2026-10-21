import { Suspense } from "react";
import { connection } from "next/server";
import { getSql } from "@/lib/db/client";

// Placeholder Command Center. Proves the DB-read pattern under Cache Components:
// the async server component sits inside <Suspense> and calls connection() first.
export default function CommandCenterPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Command Center</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
        <ScenarioCount />
      </Suspense>
    </div>
  );
}

async function ScenarioCount() {
  await connection();
  const sql = getSql();
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from scenarios`;
  return <p>Scenarios in database: {row.count}</p>;
}
