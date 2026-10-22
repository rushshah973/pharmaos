import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowRight, ArrowUpRight, MapPin, Truck } from "lucide-react";
import { cn } from "cn";
import { RunAgentsButton } from "@/components/agents/RunAgentsButton";
import { CountUp } from "@/components/dashboard/CountUp";
import { DemandChart } from "@/components/dashboard/DemandChart";
import { ErrorState } from "@/components/layout/ErrorState";
import { CreatePlanDialog } from "@/components/procurement/CreatePlanDialog";
import { type RailStep, type StepId, WorkflowRail } from "@/components/workflow/WorkflowSteps";
import { formatDisplayDate } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import { type CommandCenter, type CriticalSku, getCommandCenter } from "@/lib/services/dashboard";
import { type PoPipeline, getPoPipeline } from "@/lib/services/purchase-orders";

// Today (the Command Center, §10.3), built around the workflow: one sentence on what needs doing, the four steps
// with the current one highlighted, then the medicines closest to running out and the demand forecast.
export default function CommandCenterPage() {
  return (
    <Suspense fallback={<TodaySkeleton />}>
      <TodayContent />
    </Suspense>
  );
}

async function TodayContent() {
  await connection();
  let data: CommandCenter;
  let pipeline: PoPipeline;
  try {
    [data, pipeline] = await Promise.all([getCommandCenter(), getPoPipeline()]);
  } catch (err) {
    console.error("[command-center]", err);
    return <ErrorState title="Today's overview could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }

  const forecast = forecastPerDay(data);
  const openPlan = data.latestPlan && (data.latestPlan.status === "draft" || data.latestPlan.status === "partially_approved") ? data.latestPlan : null;
  const planHref = openPlan ? `/procurement/${openPlan.id}` : "/procurement";
  const toOrder = data.stockoutRisk + data.belowReorderPoint;
  const toSend = pipeline.ready + pipeline.awaitingOwner;
  const limit = formatINR(data.approvalLimit, { paise: false });

  // The step that needs a person now: approve an open plan, then send its POs, then receive them; with nothing
  // in flight, plan again if anything needs ordering, else everything is done (0).
  const current: StepId | 0 =
    openPlan && data.linesAwaitingPo > 0 ? 2 : toSend > 0 ? 3 : pipeline.sent > 0 ? 4 : toOrder > 0 ? 2 : 0;

  const steps: RailStep[] = [
    { id: 1, value: forecast.toLocaleString("en-IN"), unit: "packs/day", note: `ML forecast for the next 14 days across ${data.totalSkus} SKUs`, action: { label: "How it forecasts", href: "/data" } },
    openPlan && data.linesAwaitingPo > 0
      ? { id: 2, value: formatINR(data.proposedSpend, { paise: false }), note: `${data.linesAwaitingPo} lines ranked by urgency, waiting for your approval`, action: { label: "Review & approve", href: planHref } }
      : { id: 2, value: String(toOrder), unit: "SKUs", note: "below their reorder point and ready to plan", action: { label: "Open plans", href: "/procurement" } },
    {
      id: 3,
      value: String(toSend),
      unit: toSend === 1 ? "PO" : "POs",
      note: pipeline.awaitingOwner > 0 ? `${pipeline.awaitingOwner} above ${limit} wait for the Owner` : `One per supplier; above ${limit} needs the Owner`,
      action: { label: "Send purchase orders", href: pipeline.awaitingOwner > 0 ? "/purchase-orders?filter=awaiting" : "/purchase-orders?filter=ready" },
    },
    { id: 4, value: String(pipeline.sent), unit: "on the way", note: "Book batch, expiry and bin when stock arrives", action: { label: "Receive goods", href: "/purchase-orders?filter=sent" } },
  ];

  return (
    <div className="space-y-6">
      <Hero data={data} current={current} toOrder={toOrder} toSend={toSend} sent={pipeline.sent} awaitingOwner={pipeline.awaitingOwner} openPlanId={openPlan?.id ?? null} planHref={planHref} />
      <WorkflowRail steps={steps} current={current} />
      <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-5 max-lg:grid-cols-1">
        <RunningOut skus={data.criticalSkus.slice(0, 5)} total={data.stockoutRisk} soon={data.reorderSoonCount} planId={openPlan?.id ?? null} planHref={planHref} />
        <Demand data={data} forecast={forecast} />
      </div>
    </div>
  );
}

function forecastPerDay(data: CommandCenter) {
  const future = data.demandTrend.filter((p) => p.forecast !== null && p.actual === null);
  return future.length ? Math.round(future.reduce((a, p) => a + (p.forecast ?? 0), 0) / future.length) : 0;
}

function Hero(props: {
  data: CommandCenter;
  current: StepId | 0;
  toOrder: number;
  toSend: number;
  sent: number;
  awaitingOwner: number;
  openPlanId: string | null;
  planHref: string;
}) {
  const { data, current, toOrder, toSend, sent, awaitingOwner, openPlanId, planHref } = props;
  const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-IN")} ${n === 1 ? one : many}`;

  let title: React.ReactNode;
  let body: string;
  let cta: React.ReactNode;
  if (current === 2 && openPlanId && data.linesAwaitingPo > 0) {
    title = (
      <>
        Your plan is ready: <span className="text-brand">{plural(data.linesAwaitingPo, "line", "lines")}</span> to approve
      </>
    );
    body = `${formatINR(data.proposedSpend, { paise: false })} of stock, ranked by how soon each medicine runs out. Check the reasons, let the AI agents review it, then approve.`;
    cta = (
      <>
        <PrimaryLink href={planHref}>Review & approve plan</PrimaryLink>
        <RunAgentsButton planId={openPlanId} />
      </>
    );
  } else if (current === 3) {
    title = (
      <>
        <span className="text-brand">{plural(toSend, "purchase order", "purchase orders")}</span> ready to go out
      </>
    );
    body =
      awaitingOwner > 0
        ? `${plural(awaitingOwner, "order is", "orders are")} above the approval limit and need the Owner first. Sending is simulated: nothing is emailed.`
        : "One per supplier, with GST and freight. Mark them sent once you've placed them; sending is simulated.";
    cta = <PrimaryLink href={awaitingOwner > 0 ? "/purchase-orders?filter=awaiting" : "/purchase-orders?filter=ready"}>Go to purchase orders</PrimaryLink>;
  } else if (current === 4) {
    title = (
      <>
        <span className="text-brand">{plural(sent, "order", "orders")}</span> on the way
      </>
    );
    body = "When a delivery arrives, receive it line by line with batch, expiry and bin. Stock is available as soon as it's booked.";
    cta = <PrimaryLink href="/purchase-orders?filter=sent">Receive goods</PrimaryLink>;
  } else if (current === 2) {
    title = (
      <>
        <span className="text-brand">{plural(toOrder, "medicine needs", "medicines need")}</span> reordering
      </>
    );
    body = `${plural(data.stockoutRisk, "runs out", "run out")} before a new delivery could arrive. PharmaOS has forecast demand for all ${data.totalSkus} SKUs; build today's plan to order in time.`;
    cta = <CreatePlanDialog label="Create today's plan" className="h-11 px-5 text-[14px]" />;
  } else {
    title = "All caught up";
    body = "Nothing is below its reorder point and no orders are waiting. PharmaOS keeps watching demand and stock.";
    cta = <PrimaryLink href="/warehouse">Open the warehouse</PrimaryLink>;
  }

  return (
    <section className="surface-hero relative overflow-hidden px-8 py-9 max-sm:px-5" aria-label="Today">
      <p className="text-[13px] text-fg-3">
        Today · {formatDisplayDate(data.asOf)}
        {data.scenario.id !== "baseline" && <span className="text-expiry"> · Scenario: {data.scenario.name}</span>}
      </p>
      <h1 className="mt-3 max-w-[880px] text-[44px] leading-[50px] font-light tracking-[-0.04em] text-fg-1 max-lg:text-[34px] max-lg:leading-[40px]">{title}</h1>
      <p className="mt-3 max-w-[640px] text-[15px] leading-6 text-fg-2">{body}</p>
      <div className="mt-7 flex flex-wrap items-center gap-3">{cta}</div>
    </section>
  );
}

function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex h-11 items-center gap-2 rounded-full bg-brand px-5 text-[14px] font-medium text-black shadow-[0_8px_30px_-8px_rgba(255,141,77,0.7)] transition-colors hover:bg-brand-strong">
      {children}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}

/** The five medicines that run out first: days of stock left against how long a delivery takes. */
function RunningOut({ skus, total, soon, planId, planHref }: { skus: CriticalSku[]; total: number; soon: number; planId: string | null; planHref: string }) {
  return (
    <section className="surface flex flex-col p-6" aria-label="Running out soonest">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] leading-6 tracking-[-0.015em] text-fg-1">Running out soonest</h2>
          <p className="text-[12.5px] text-fg-3">Days of stock left vs. how long a delivery takes</p>
        </div>
        <span className="rounded-full bg-stockout/15 px-2.5 py-1 text-[12px] text-stockout ring-1 ring-stockout/25">{total} at risk</span>
      </header>
      {skus.length === 0 ? (
        <p className="mt-6 text-fg-2">No medicine runs out before its next delivery.</p>
      ) : (
        <ul className="mt-4 divide-y divide-white/[0.06]">
          {skus.map((s) => (
            <RunningOutRow key={s.productId} s={s} planId={planId} />
          ))}
        </ul>
      )}
      <footer className="mt-auto flex items-center justify-between gap-3 pt-4 text-[12.5px]">
        <span className="text-fg-3">{soon > 0 ? `${soon} more reach their reorder point this week` : "Nothing else due this week"}</span>
        <Link href={planHref} className="inline-flex items-center gap-1 text-fg-2 hover:text-fg-1">
          See all in the plan <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      </footer>
    </section>
  );
}

function RunningOutRow({ s, planId }: { s: CriticalSku; planId: string | null }) {
  const cover = Math.max(0, s.cover ?? 0);
  const waiting = s.shortBeforeDelivery && s.nextArrival ? s.nextArrival : null;
  const delivery = waiting ? waiting.inDays : s.leadTimeDays;
  const span = Math.max(cover, delivery, 1);
  const href = planId && s.planLineId ? `/procurement/${planId}?line=${s.planLineId}` : null;
  const content = (
    <>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-fg-1">{s.brandName}</p>
        <p className="truncate text-[12px] text-fg-3">
          <span className="font-mono">{s.sku}</span> · {s.strength}
        </p>
      </div>
      <div className="w-[180px] shrink-0 max-sm:w-[120px]">
        <div className="relative h-1.5 rounded-full bg-white/[0.07]" aria-hidden>
          <span className="absolute inset-y-0 left-0 rounded-full bg-stockout" style={{ width: `${(cover / span) * 100}%` }} />
          <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-brand" style={{ left: `calc(${(delivery / span) * 100}% - 1px)` }} />
        </div>
        <p className="mt-1.5 flex justify-between text-[11.5px] text-fg-3">
          <span className={cn(cover < 1 && "text-stockout")}>{cover < 0.05 ? "Out of stock" : `${cover.toFixed(1)} d left`}</span>
          <span className="inline-flex items-center gap-1">
            <Truck className="size-3" aria-hidden />
            {waiting ? `PO in ${delivery} d` : `${delivery} d`}
          </span>
        </p>
      </div>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="-mx-2 flex items-center gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-white/[0.04]">
          {content}
        </Link>
      ) : (
        <div className="flex items-center gap-4 py-3">
          {content}
          <Link href={`/warehouse?sku=${encodeURIComponent(s.sku)}`} aria-label={`Locate ${s.sku}`} className="text-fg-3 hover:text-fg-1">
            <MapPin className="size-4" aria-hidden />
          </Link>
        </div>
      )}
    </li>
  );
}

function Demand({ data, forecast }: { data: CommandCenter; forecast: number }) {
  const past = data.demandTrend.filter((p) => p.actual !== null).slice(-14);
  const pastAvg = past.length ? past.reduce((a, p) => a + (p.actual ?? 0), 0) / past.length : 0;
  const change = pastAvg > 0 ? ((forecast - pastAvg) / pastAvg) * 100 : 0;
  return (
    <section className="surface flex flex-col p-6" aria-label="Demand forecast">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] leading-6 tracking-[-0.015em] text-fg-1">Demand forecast</h2>
          <p className="text-[12.5px] text-fg-3">Packs sold per day, then the forecast plans use</p>
        </div>
        <Link href="/data" aria-label="How the forecast works" className="glass-pill flex size-8 items-center justify-center text-fg-2 hover:text-fg-1">
          <ArrowUpRight className="size-4" strokeWidth={1.6} />
        </Link>
      </header>
      <div className="mt-4 flex items-end gap-3">
        <span className="display text-[40px] leading-[44px] text-fg-1">
          <CountUp value={forecast} />
        </span>
        <span className="pb-1.5 text-[12.5px] text-fg-3">
          packs/day ·{" "}
          <span className={cn("num", change >= 0 ? "text-brand" : "text-healthy")}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(1)}%
          </span>{" "}
          vs last 14 days
        </span>
      </div>
      <div className="mt-4">
        <DemandChart points={data.demandTrend} />
      </div>
    </section>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="surface-hero space-y-4 px-8 py-9">
        <span className="shimmer block h-4 w-40 rounded-full" />
        <span className="shimmer block h-12 w-[560px] max-w-full rounded-2xl" />
        <span className="shimmer block h-5 w-[420px] max-w-full rounded-full" />
        <span className="shimmer block h-11 w-52 rounded-full" />
      </div>
      <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="surface h-[220px]" />
        ))}
      </div>
      <div className="grid grid-cols-[1.15fr_1fr] gap-5 max-lg:grid-cols-1">
        <div className="surface h-[380px]" />
        <div className="surface h-[380px]" />
      </div>
    </div>
  );
}
