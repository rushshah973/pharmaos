import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { AskPanel } from "@/components/agent/AskPanel";
import { RunAgentsButton } from "@/components/agents/RunAgentsButton";
import { PlanSummaryCard } from "@/components/agent/PlanSummaryCard";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import { ImpactCard } from "@/components/procurement/ImpactCard";
import { type DrawerPayload, LineDrawer } from "@/components/procurement/drawer/LineDrawer";
import { AlreadyOnOrderList } from "@/components/procurement/AlreadyOnOrderList";
import { NotInPlanList } from "@/components/procurement/NotInPlanList";
import { PlanStatusPill } from "@/components/procurement/PlanStatusPill";
import { PlanTable } from "@/components/procurement/PlanTable";
import { RecalculateButton } from "@/components/procurement/RecalculateButton";
import { RejectPlanButton } from "@/components/procurement/RejectPlanButton";
import { SupplierPoStrip } from "@/components/procurement/SupplierPoStrip";
import { ServiceError } from "@/lib/api/errors";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import { getLineDetail } from "@/lib/services/line-detail";
import { type PlanView, getPlanForRender } from "@/lib/services/plans";
import { uuid } from "@/lib/validation/api";

export const metadata: Metadata = { title: "Purchase plan" };

// Procurement Plan (§10.3): Impact Card, supplier PO strip, ranked plan table, lines not in the plan.
export default function PlanPage({ params, searchParams }: PageProps<"/procurement/[planId]">) {
  return (
    <>
      <Suspense fallback={<PlanSkeleton />}>
        <Plan params={params} />
      </Suspense>
      {/* The line drawer is its own boundary: opening a line never waits on (or re-suspends) the plan. */}
      {/* No fallback: the drawer reads the URL, which is unknown while prerendering. A click from the table
          keeps the mounted drawer (showing its skeleton) while the new line's data streams in. */}
      <Suspense fallback={null}>
        <Drawer params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Drawer({ params, searchParams }: Pick<PageProps<"/procurement/[planId]">, "params" | "searchParams">) {
  await connection();
  const [{ planId }, query] = await Promise.all([params, searchParams]);
  if (!uuid.safeParse(planId).success) return null;
  const raw = query.line;
  const lineId = typeof raw === "string" ? raw : null;
  let plan: PlanView;
  try {
    plan = await getPlanForRender(planId);
  } catch {
    return null;
  }
  let payload: DrawerPayload = null;
  if (lineId) {
    let failed = false;
    const detail = uuid.safeParse(lineId).success
      ? await getLineDetail(planId, lineId).catch((err) => {
          // A missing line is "not found"; anything else is a failure the drawer reports as one.
          failed = !(err instanceof ServiceError && err.status === 404);
          if (failed) console.error("[line drawer]", err);
          return null;
        })
      : null;
    payload = { lineId, detail, failed };
  }
  const locked = plan.status === "approved" || plan.status === "rejected";
  return <LineDrawer planId={planId} payload={payload} planTotal={plan.proposedTotal} supplierPos={plan.supplierPos} locked={locked} />;
}

async function Plan({ params }: { params: PageProps<"/procurement/[planId]">["params"] }) {
  await connection();
  const { planId } = await params;
  if (!uuid.safeParse(planId).success) notFound();
  let plan: PlanView;
  try {
    plan = await getPlanForRender(planId);
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
        action={
          <>
            <RejectPlanButton planId={plan.id} disabled={locked} />
            <RecalculateButton planId={plan.id} disabled={locked} />
            <RunAgentsButton planId={plan.id} locked={locked} />
            {/* The panel reads ?line= (the line in focus), so it renders inside its own Suspense boundary. */}
            <Suspense fallback={null}>
              <AskPanel planId={plan.id} lines={plan.lines.map((l) => ({ id: l.id, sku: l.sku, rank: l.rank }))} />
            </Suspense>
          </>
        }
      />
      <PlanSummaryCard key={plan.id} planId={plan.id} initial={plan.aiSummary} />
      <ImpactCard impact={plan.impact} approvalLimit={plan.approvalLimit} />
      <SupplierPoStrip pos={plan.supplierPos} approvalLimit={plan.approvalLimit} />
      <PlanTable planId={plan.id} planStatus={plan.status} lines={inPlan} approvalLimit={plan.approvalLimit} onOrder={plan.alreadyOnOrder}>
        <NotInPlanList planId={plan.id} planStatus={plan.status} lines={notInPlan} />
        <AlreadyOnOrderList items={plan.alreadyOnOrder} lines={plan.lines} />
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
        <div className="h-10 border-y border-white/[0.06] bg-white/[0.025]" />
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
