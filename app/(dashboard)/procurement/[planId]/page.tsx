import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import { ImpactCard } from "@/components/procurement/ImpactCard";
import { NotInPlanList } from "@/components/procurement/NotInPlanList";
import { PlanStatusPill } from "@/components/procurement/PlanStatusPill";
import { PlanTable } from "@/components/procurement/PlanTable";
import { RecalculateButton } from "@/components/procurement/RecalculateButton";
import { SupplierPoStrip } from "@/components/procurement/SupplierPoStrip";
import { ServiceError } from "@/lib/api/errors";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import { type PlanView, getPlan } from "@/lib/services/plans";
import { uuid } from "@/lib/validation/api";

export const metadata: Metadata = { title: "Purchase plan" };

// Procurement Plan (§10.3): Impact Card, supplier PO strip, ranked plan table, lines not in the plan.
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
    console.error("[plan]", err);
    return <ErrorState title="This plan could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }

  const inPlan = plan.lines.filter((l) => l.counted);
  const notInPlan = plan.lines.filter((l) => !l.counted);
  const locked = plan.status === "approved" || plan.status === "rejected";

  return (
    <div className="space-y-6 pb-2">
      <PageHeader
        title="Purchase plan"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <PlanStatusPill status={plan.status} />
            Created {formatDateTime(plan.createdAt)} · as of {formatDisplayDate(plan.asOf)} · {plan.scenarioName}
          </span>
        }
        action={<RecalculateButton planId={plan.id} disabled={locked} />}
      />
      <ImpactCard impact={plan.impact} approvalLimit={plan.approvalLimit} />
      <SupplierPoStrip pos={plan.supplierPos} approvalLimit={plan.approvalLimit} />
      <PlanTable planId={plan.id} planStatus={plan.status} lines={inPlan}>
        <NotInPlanList planId={plan.id} planStatus={plan.status} lines={notInPlan} />
      </PlanTable>
    </div>
  );
}

function PlanSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <span className="shimmer block h-7 w-48 rounded" />
          <span className="shimmer block h-5 w-80 rounded" />
        </div>
        <span className="shimmer h-9 w-32 rounded-lg" />
      </div>
      <div className="surface-hero space-y-6 p-6">
        <div className="grid gap-6 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <span className="shimmer block h-4 w-28 rounded" />
              <span className="shimmer block h-9 w-36 rounded" />
              <span className="shimmer block h-4 w-48 rounded" />
            </div>
          ))}
        </div>
        <div className="h-16 border-t border-border" />
      </div>
      <div className="surface h-[124px]" />
      <div className="surface overflow-hidden">
        <div className="h-[76px]" />
        <div className="h-10 border-y border-border bg-surface-2" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex h-14 items-center gap-6 border-b border-border px-5">
            <span className="shimmer h-8 w-60 rounded" />
            <span className="shimmer h-[22px] w-28 rounded-full" />
            <span className="shimmer ml-auto h-4 w-24 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
