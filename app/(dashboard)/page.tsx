import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowRight, ClipboardList, PackageX, ShieldCheck, TimerOff } from "lucide-react";
import { CriticalSkuList, CriticalSkuListSkeleton } from "@/components/dashboard/CriticalSkuList";
import { CountUp } from "@/components/dashboard/CountUp";
import { KpiTile, KpiTileSkeleton } from "@/components/dashboard/KpiTile";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreatePlanDialog } from "@/components/procurement/CreatePlanDialog";
import { PlanStatusPill } from "@/components/procurement/PlanStatusPill";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import { type CommandCenter, getCommandCenter } from "@/lib/services/dashboard";

// Command Center (§10.3). The async component sits inside <Suspense> and calls connection() first.
export default function CommandCenterPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Center"
        description="Today's stock and expiry risk at a glance, and one click to a ranked, explainable purchase plan."
        action={<CreatePlanDialog />}
      />
      <Suspense fallback={<CommandCenterSkeleton />}>
        <CommandCenterContent />
      </Suspense>
    </div>
  );
}

async function CommandCenterContent() {
  await connection();
  let data: CommandCenter;
  try {
    data = await getCommandCenter();
  } catch (err) {
    console.error("[command-center]", err);
    return <ErrorState title="The Command Center could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  const limit = formatINR(data.approvalLimit, { paise: false });

  return (
    <>
      <Hero data={data} />
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile
          label="Stockout risk"
          value={data.stockoutRisk}
          icon={PackageX}
          tone="stockout"
          context={`${data.belowReorderPoint} more below reorder point`}
        />
        <KpiTile label="Expiry exposure" value={Number(data.expiryExposure)} kind="inr" icon={TimerOff} tone="expiry" context="Stock that won't sell before expiry" />
        <KpiTile label="Lines awaiting PO" value={data.linesAwaitingPo} icon={ClipboardList} tone="brand" context="In open plans, not on a PO yet" />
        <KpiTile
          label="Owner approval"
          value={data.posAwaitingApproval}
          icon={ShieldCheck}
          tone={data.posAwaitingApproval > 0 ? "expiry" : "neutral"}
          context={`POs above ${limit} to approve`}
        />
      </div>
      <CriticalSkuList skus={data.criticalSkus} latestPlanId={data.latestPlan?.id ?? null} totalAtRisk={data.stockoutRisk} />
    </>
  );
}

function Hero({ data }: { data: CommandCenter }) {
  const plan = data.latestPlan;
  return (
    <section className="surface-hero grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-end">
      <div className="max-w-xl space-y-2">
        <p className="micro-label">
          As of {formatDisplayDate(data.asOf)} · {data.totalSkus.toLocaleString("en-IN")} active SKUs
          {data.scenario.id !== "baseline" && <span className="text-expiry"> · Scenario: {data.scenario.name}</span>}
        </p>
        <h2 className="text-[22px] leading-7 font-semibold tracking-[-0.01em] text-fg-1">
          {data.stockoutRisk > 0
            ? `${data.stockoutRisk} SKUs will run out before new stock can arrive.`
            : "No SKU is at risk of running out before its next delivery."}
        </h2>
        <p className="text-fg-2">
          PharmaOS plans every SKU that needs stock, ranks it by the loss each rupee prevents, and explains every line. Purchase orders above{" "}
          {formatINR(data.approvalLimit, { paise: false })} wait for the Owner before they are sent.
        </p>
      </div>
      <div className="min-w-[260px] rounded-xl border border-border bg-bg/40 p-5">
        <p className="micro-label">Proposed spend · latest plan</p>
        <p className="mt-2 text-[32px] leading-9 font-semibold tracking-[-0.02em] text-fg-1">
          <CountUp value={Number(data.proposedSpend)} kind="inr" />
        </p>
        {plan ? (
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[12.5px] text-fg-2">
              <PlanStatusPill status={plan.status} />
              {formatDateTime(plan.createdAt)}
            </span>
            <Link href={`/procurement/${plan.id}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">
              Open <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        ) : (
          <p className="mt-2 text-[12.5px] text-fg-2">No plan yet. Create one to see what to buy.</p>
        )}
      </div>
    </section>
  );
}

function CommandCenterSkeleton() {
  return (
    <>
      <section className="surface-hero grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-end" aria-hidden>
        <div className="max-w-xl space-y-3">
          <span className="shimmer block h-4 w-56 rounded" />
          <span className="shimmer block h-7 w-[420px] max-w-full rounded" />
          <span className="shimmer block h-10 w-full rounded" />
        </div>
        <div className="h-[118px] min-w-[260px] rounded-xl border border-border bg-bg/40" />
      </section>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <KpiTileSkeleton key={i} />
        ))}
      </div>
      <CriticalSkuListSkeleton />
    </>
  );
}
