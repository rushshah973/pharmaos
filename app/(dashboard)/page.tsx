import { Suspense } from "react";
import { connection } from "next/server";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { getSql } from "@/lib/db/client";

// Placeholder Command Center; the KPI tiles and critical-SKU list arrive in P14.
// The DB-read pattern under Cache Components: the async component sits inside <Suspense> and calls connection() first.
export default function CommandCenterPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Center"
        description="Today's stock risk and budget at a glance, and one click to a ranked, budget-capped purchase plan."
        action={
          <Button disabled className="h-9 px-4">
            <Sparkles className="size-4" strokeWidth={1.75} aria-hidden />
            Create Purchase Plan
          </Button>
        }
      />
      <section className="surface-hero p-6">
        <p className="micro-label">Catalogue in this workspace</p>
        <Suspense fallback={<CountsSkeleton />}>
          <Counts />
        </Suspense>
        <p className="mt-6 text-fg-3">KPI tiles, critical SKUs and plan creation arrive in the next steps of stage 3.</p>
      </section>
    </div>
  );
}

async function Counts() {
  await connection();
  const sql = getSql();
  const [row] = await sql<{ skus: number; suppliers: number; batches: number }[]>`
    select
      (select count(*)::int from products where is_active) as skus,
      (select count(*)::int from suppliers where approved_status = 'approved') as suppliers,
      (select count(*)::int from batches) as batches
  `;
  const items = [
    { label: "Active SKUs", value: row.skus },
    { label: "Approved suppliers", value: row.suppliers },
    { label: "Batches on hand", value: row.batches },
  ];
  return (
    <dl className="mt-4 grid grid-cols-3 gap-6">
      {items.map((i) => (
        <div key={i.label}>
          <dd className="num text-[32px] leading-9 font-semibold tracking-[-0.02em] text-fg-1">{i.value.toLocaleString("en-IN")}</dd>
          <dt className="mt-1 text-fg-2">{i.label}</dt>
        </div>
      ))}
    </dl>
  );
}

function CountsSkeleton() {
  return (
    <div className="mt-4 grid grid-cols-3 gap-6" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div className="shimmer h-9 w-24 rounded-md" />
          <div className="shimmer mt-1 h-5 w-32 rounded-md" />
        </div>
      ))}
    </div>
  );
}
