import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { ExternalLink } from "lucide-react";
import { DemandModelCard } from "@/components/data/DemandModelCard";
import { RetrainButton } from "@/components/data/RetrainButton";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import { ApprovalLimitForm } from "@/components/scenarios/ApprovalLimitForm";
import { RoiModel } from "@/components/scenarios/RoiModel";
import { ScenarioCards } from "@/components/scenarios/ScenarioCards";
import { getSql } from "@/lib/db/client";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import { getShellState } from "@/lib/services/app-state";
import { loadLatestModel } from "@/lib/services/forecast-model";
import { type DataSummary, getDataSummary, listScenarios } from "@/lib/services/scenarios";
import { getLatestOpenPlan } from "@/lib/services/warehouse";

export const metadata: Metadata = { title: "Data & Scenarios" };

// Data & Scenarios (§10.3): scenarios with Run / Reset, the Owner approval limit, the demand model, where the
// demo data comes from, and the illustrative ROI model. Each data block streams in its own Suspense boundary.
export default function DataPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Data & Scenarios" description="Stress the plan with what-if scenarios, set the Owner approval limit, and see where the demo data and its demand model come from." />
      <Suspense fallback={<ScenarioSkeleton />}>
        <ScenarioSection />
      </Suspense>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-5 max-lg:grid-cols-1">
        <Suspense fallback={<CardSkeleton rows={3} />}>
          <LimitSection />
        </Suspense>
        <Suspense fallback={<CardSkeleton rows={6} grid />}>
          <SummarySection />
        </Suspense>
      </div>
      <Suspense fallback={<CardSkeleton rows={3} grid />}>
        <ModelSection />
      </Suspense>
      <RoiModel />
    </div>
  );
}

async function ScenarioSection() {
  await connection();
  let data: [Awaited<ReturnType<typeof listScenarios>>, Awaited<ReturnType<typeof getLatestOpenPlan>>];
  try {
    data = await Promise.all([listScenarios(), getLatestOpenPlan()]);
  } catch (err) {
    console.error("[data scenarios]", err);
    return <ErrorState title="The scenarios could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  const [{ active, scenarios }, latest] = data;
  return <ScenarioCards scenarios={scenarios} active={active} latestPlanId={latest?.id ?? null} />;
}

async function LimitSection() {
  await connection();
  let limit: string;
  try {
    limit = (await getShellState()).approvalLimit;
  } catch (err) {
    console.error("[data limit]", err);
    return <ErrorState title="The approval limit could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  return <ApprovalLimitForm current={limit} />;
}

async function SummarySection() {
  await connection();
  let data: DataSummary;
  try {
    data = await getDataSummary();
  } catch (err) {
    console.error("[data summary]", err);
    return <ErrorState title="The data summary could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  return <DataSummaryCard data={data} />;
}

const TABLE_LABEL: Record<string, string> = {
  products: "Products (SKUs)",
  suppliers: "Suppliers",
  supplier_offers: "Supplier offers",
  sales_history: "Sales (SKU × day)",
  batches: "Batches",
  inventory_locations: "Bins",
  inventory_balances: "Stock balances",
  purchase_orders: "Purchase orders",
  purchase_order_lines: "PO lines",
};
const SOURCE_LABEL: Record<string, string> = {
  public_reference: "Public reference",
  unverified_sample: "Unverified sample",
  verified_customer_data: "Verified customer data",
  synthetic_demo: "Synthetic demo",
};

function DataSummaryCard({ data }: { data: DataSummary }) {
  return (
    <section className="surface p-6" aria-label="Data summary">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] leading-6 tracking-[-0.015em] text-fg-1">Data summary</h2>
          <p className="text-[12.5px] text-fg-3">Every row is generated synthetic demo data, shaped by the reference sources below.</p>
        </div>
        <span className="rounded-full border border-border-strong px-2.5 text-[12px] leading-6 text-fg-2">
          As of {formatDisplayDate(data.asOf)} · seed {data.seed}
          {data.seededAt ? ` · seeded ${formatDateTime(data.seededAt)}` : ""}
        </span>
      </div>
      <dl className="mt-5 grid grid-cols-3 gap-x-6 gap-y-4 max-md:grid-cols-2">
        {data.tables.map((t) => (
          <div key={t.table}>
            <dt className="micro-label">{TABLE_LABEL[t.table] ?? t.table}</dt>
            <dd className="num mt-0.5 text-[20px] font-light tracking-[-0.02em] text-fg-1">{t.rows.toLocaleString("en-IN")}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 border-t border-white/[0.06] pt-5">
        <h3 className="micro-label">Data sources</h3>
        <ul className="mt-3 space-y-3">
          {data.sources.map((s) => (
            <li key={s.id} className="text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-fg-1 hover:text-brand hover:underline">
                    {s.name} <ExternalLink className="size-3" aria-hidden />
                  </a>
                ) : (
                  <span className="text-fg-1">{s.name}</span>
                )}
                <span className="rounded-full border border-white/12 px-2 text-[11px] leading-5 text-fg-2">{SOURCE_LABEL[s.sourceType] ?? s.sourceType}</span>
              </div>
              <p className="mt-0.5 text-fg-2">{s.usedFor}</p>
              {s.licenceNote && <p className="text-[11.5px] text-fg-3">{s.licenceNote}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
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
  return <DemandModelCard model={data.model?.model ?? null} skus={data.skus} action={<RetrainButton />} />;
}

function ScenarioSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <span className="shimmer block h-8 w-40 rounded-full" />
      <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="surface h-[220px]" />
        ))}
      </div>
    </div>
  );
}

/** A card-shaped placeholder: title, subtitle and rows of figures (in a 3-column grid when `grid`). */
function CardSkeleton({ rows, grid = false }: { rows: number; grid?: boolean }) {
  return (
    <div className="surface space-y-5 p-6" aria-hidden>
      <div className="space-y-2">
        <span className="shimmer block h-5 w-44 rounded-full" />
        <span className="shimmer block h-4 w-72 max-w-full rounded-full" />
      </div>
      <div className={grid ? "grid grid-cols-3 gap-5" : "space-y-3"}>
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="shimmer block h-10 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
