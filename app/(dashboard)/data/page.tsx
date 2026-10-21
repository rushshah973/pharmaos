import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Database } from "lucide-react";
import { DemandModelCard } from "@/components/data/DemandModelCard";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import { getSql } from "@/lib/db/client";
import { loadLatestModel } from "@/lib/services/forecast-model";

export const metadata: Metadata = { title: "Data & Scenarios" };

export default function DataPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Data & Scenarios" description="Where the demo data comes from, the demand model trained on it, and what-if scenarios to stress the plan." />
      <Suspense fallback={<div className="surface shimmer h-[300px]" aria-hidden />}>
        <ModelSection />
      </Suspense>
      <EmptyState icon={Database} title="Coming in stage 7" description="Data summary, reference sources, scenario runs, the approval limit and the ROI model arrive in the scenarios stage." />
    </div>
  );
}

async function ModelSection() {
  await connection();
  let data: { model: Awaited<ReturnType<typeof loadLatestModel>>; skus: number };
  try {
    const [latest, [count]] = await Promise.all([loadLatestModel(), getSql()<{ n: number }[]>`select count(*)::int as n from products where is_active`]);
    data = { model: latest, skus: count?.n ?? 0 };
  } catch (err) {
    console.error("[data]", err);
    return <ErrorState title="The demand model could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  return <DemandModelCard model={data.model?.model ?? null} skus={data.skus} />;
}
