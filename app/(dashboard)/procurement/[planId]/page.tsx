import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { LayoutList } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill } from "@/components/layout/StatusPill";
import { PlanStatusPill } from "@/components/procurement/PlanStatusPill";
import { ServiceError } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import { type PlanView, getPlan } from "@/lib/services/plans";
import { uuid } from "@/lib/validation/api";

export const metadata: Metadata = { title: "Purchase plan" };

// Plan summary and its projected supplier POs. The full plan screen (table, drawer, edits) arrives in P15.
export default function PlanPage({ params }: PageProps<"/procurement/[planId]">) {
  return (
    <Suspense fallback={<PlanSkeleton />}>
      <Plan params={params} />
    </Suspense>
  );
}

async function Plan({ params }: { params: PageProps<"/procurement/[planId]">["params"] }) {
  await connection();
  const { planId } = await params;
  if (!uuid.safeParse(planId).success) notFound();
  let plan: PlanView;
  try {
    plan = await getPlan(planId);
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    throw err;
  }
  const included = plan.lines.filter((l) => l.counted).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase plan"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <PlanStatusPill status={plan.status} />
            Created {formatDateTime(plan.createdAt)} · {plan.scenarioName}
          </span>
        }
      />
      <section className="surface-hero grid gap-6 p-6 md:grid-cols-3">
        <Figure label="Total spend" value={formatINR(plan.proposedTotal, { paise: false })} note={`${included} of ${plan.lines.length} lines in the plan`} />
        <Figure label="Supplier POs" value={String(plan.supplierPos.length)} note={`${plan.impact.posNeedingApproval} above ${formatINR(plan.approvalLimit, { paise: false })}`} />
        <Figure label="Stockouts covered" value={`${plan.impact.stockoutsCovered} / ${plan.impact.skusAtRisk}`} note="SKUs at stockout risk this plan buys" />
      </section>
      <section className="surface p-5">
        <h2 className="text-[15px] leading-[22px] font-semibold text-fg-1">Projected purchase orders</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {plan.supplierPos.map((po) => (
            <div key={po.supplierId} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="font-mono text-[12.5px] text-fg-1">{po.supplierCode}</span>
              <span className="num text-fg-1">{formatINR(po.total, { paise: false })}</span>
              <span className="text-[12px] text-fg-3">{po.lines} lines</span>
              {po.needsApproval && <StatusPill status="expiry">Owner approval</StatusPill>}
            </div>
          ))}
        </div>
      </section>
      <EmptyState icon={LayoutList} title="Plan table coming next" description="The ranked line table, line details and edits arrive in the next step of stage 3." />
    </div>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div>
      <p className="micro-label">{label}</p>
      <p className="num mt-2 text-[32px] leading-9 font-semibold tracking-[-0.02em] text-fg-1">{value}</p>
      <p className="mt-1 text-fg-2">{note}</p>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <span className="shimmer block h-7 w-48 rounded" />
        <span className="shimmer block h-5 w-72 rounded" />
      </div>
      <div className="surface-hero h-[132px]" />
      <div className="surface h-[108px]" />
    </div>
  );
}
