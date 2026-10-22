import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowUpRight, ChevronRight, ClipboardList, PackageX, Send, ShieldCheck, Sparkles, TimerOff } from "lucide-react";
import { cn } from "cn";
import { CountUp } from "@/components/dashboard/CountUp";
import { CriticalCards } from "@/components/dashboard/CriticalCards";
import { CriticalSkuList, CriticalSkuListSkeleton } from "@/components/dashboard/CriticalSkuList";
import { DemandChart } from "@/components/dashboard/DemandChart";
import { ReorderSoonList } from "@/components/dashboard/ReorderSoonList";
import { ErrorState } from "@/components/layout/ErrorState";
import { CreatePlanDialog } from "@/components/procurement/CreatePlanDialog";
import { PlanStatusPill } from "@/components/procurement/PlanStatusPill";
import type { SkuStatus } from "@/lib/business-logic/types";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import { type CommandCenter, getCommandCenter } from "@/lib/services/dashboard";
import { type PoPipeline, getPoPipeline } from "@/lib/services/purchase-orders";

// Command Center (§10.3). The async component sits inside <Suspense> and calls connection() first.
export default function CommandCenterPage() {
  return (
    <Suspense fallback={<CommandCenterSkeleton />}>
      <CommandCenterContent />
    </Suspense>
  );
}

async function CommandCenterContent() {
  await connection();
  let data: CommandCenter;
  let pipeline: PoPipeline;
  try {
    [data, pipeline] = await Promise.all([getCommandCenter(), getPoPipeline()]);
  } catch (err) {
    console.error("[command-center]", err);
    return <ErrorState title="The Command Center could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }

  return (
    <div className="space-y-5">
      <Header data={data} />
      <StatusChips data={data} />
      <div className="grid grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] gap-5 max-xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] max-lg:grid-cols-1">
        <div className="flex min-w-0 flex-col gap-5">
          <DemandCard data={data} />
          <PipelineStrip pipeline={pipeline} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 max-lg:grid max-lg:grid-cols-2 max-md:grid-cols-1">
          <SpendCard data={data} />
          <AttentionPanel data={data} pipeline={pipeline} />
        </div>
      </div>
      <SectionTitle title="Closest to running out" note="Days of stock left against the fastest delivery" href={data.latestPlan ? `/procurement/${data.latestPlan.id}` : undefined} />
      <CriticalCards skus={data.criticalSkus} latestPlanId={data.latestPlan?.id ?? null} />
      <CriticalSkuList skus={data.criticalSkus} latestPlanId={data.latestPlan?.id ?? null} totalAtRisk={data.stockoutRisk} />
      <ReorderSoonList items={data.reorderSoon} total={data.reorderSoonCount} />
    </div>
  );
}

function Header({ data }: { data: CommandCenter }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-5 pt-2">
      <div className="min-w-0">
        <p className="text-[13px] text-fg-3">
          As of {formatDisplayDate(data.asOf)} · {data.totalSkus.toLocaleString("en-IN")} active SKUs
          {data.scenario.id !== "baseline" && <span className="text-expiry"> · Scenario: {data.scenario.name}</span>}
        </p>
        <h1 className="mt-1 text-[56px] leading-[60px] font-light tracking-[-0.05em] text-fg-1 max-lg:text-[40px] max-lg:leading-[46px]">Command Center</h1>
      </div>
      <div className="flex items-center gap-2">
        {data.latestPlan && (
          <Link href={`/procurement/${data.latestPlan.id}`} className="glass-pill inline-flex h-9 items-center gap-2 px-4 text-[13px] text-fg-1 transition-colors hover:bg-white/[0.08]">
            <ClipboardList className="size-4 text-fg-2" strokeWidth={1.6} aria-hidden />
            Latest plan
            <ChevronRight className="size-3.5 text-fg-3" aria-hidden />
          </Link>
        )}
        <CreatePlanDialog />
      </div>
    </div>
  );
}

const STATUS_CHIPS: { status: SkuStatus; label: string; short?: string; dot: string }[] = [
  { status: "STOCKOUT_RISK", label: "Stockout risk", dot: "bg-stockout shadow-[0_0_10px_var(--stockout)]" },
  { status: "BELOW_ROP", label: "Below reorder point", short: "Below ROP", dot: "bg-expiry" },
  { status: "HEALTHY", label: "Healthy", dot: "bg-healthy" },
  { status: "EXCESS", label: "Excess", dot: "bg-excess" },
  { status: "NO_DEMAND", label: "No demand", dot: "bg-fg-3" },
];

/** The SKU base split by stock status, as glass chips (one per status). */
function StatusChips({ data }: { data: CommandCenter }) {
  const count = new Map(data.statusMix.map((m) => [m.status, m.count]));
  return (
    <div className="grid grid-cols-5 gap-3 max-lg:grid-cols-3" role="list" aria-label="SKUs by stock status">
      {STATUS_CHIPS.map((c) => (
        <div key={c.status} role="listitem" className="glass-pill flex h-14 items-center justify-between gap-3 px-5">
          <span className="flex min-w-0 items-center gap-2.5">
            <span className={cn("size-2 shrink-0 rounded-full", c.dot)} aria-hidden />
            <span className="truncate text-[13px] text-fg-2" title={c.label}>
              {c.short ? (
                <>
                  <span className="max-xl:hidden">{c.label}</span>
                  <span className="xl:hidden">{c.short}</span>
                </>
              ) : (
                c.label
              )}
            </span>
          </span>
          <span className="num text-[20px] font-light tracking-[-0.03em] text-fg-1">{(count.get(c.status) ?? 0).toLocaleString("en-IN")}</span>
        </div>
      ))}
    </div>
  );
}

function DemandCard({ data }: { data: CommandCenter }) {
  const past = data.demandTrend.filter((p) => p.actual !== null).slice(-14);
  const future = data.demandTrend.filter((p) => p.actual === null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const pastAvg = avg(past.map((p) => p.actual!));
  const nextAvg = avg(future.map((p) => p.forecast!));
  const change = pastAvg > 0 ? ((nextAvg - pastAvg) / pastAvg) * 100 : 0;
  return (
    <section className="surface p-6" aria-label="Demand">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[17px] leading-6 tracking-[-0.015em] text-fg-1">Demand · packs per day</h2>
          <p className="text-[12.5px] text-fg-3">Last 6 weeks sold, then the forecast the plan uses for the next 14 days</p>
        </div>
        <Link href="/data" aria-label="Open the demand model" className="glass-pill flex size-8 items-center justify-center text-fg-2 hover:text-fg-1">
          <ArrowUpRight className="size-4" strokeWidth={1.6} />
        </Link>
      </header>
      <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-2">
        <div className="display text-[56px] leading-[56px] text-fg-1">
          <CountUp value={Math.round(nextAvg)} />
          <span className="dim ml-2 text-[18px] tracking-normal">packs / day next 14 d</span>
        </div>
        <div className="pb-1.5 text-[13px]">
          <span className={cn("num", change >= 0 ? "text-brand" : "text-healthy")}>
            {change >= 0 ? "+" : ""}
            {change.toFixed(1)}%
          </span>
          <span className="text-fg-3"> vs last 14 days ({Math.round(pastAvg).toLocaleString("en-IN")} / day)</span>
        </div>
      </div>
      <div className="mt-5">
        <DemandChart points={data.demandTrend} />
      </div>
    </section>
  );
}

function SpendCard({ data }: { data: CommandCenter }) {
  const plan = data.latestPlan;
  return (
    <section className="surface-warm relative flex min-h-[260px] flex-col overflow-hidden p-6" aria-label="Proposed spend">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] leading-6 tracking-[-0.015em] text-fg-1">Proposed spend</h2>
          <p className="text-[12.5px] text-white/55">Latest plan · ranked by loss prevented per rupee</p>
        </div>
        {plan && <PlanStatusPill status={plan.status} />}
      </div>
      <div className="mt-auto pt-8">
        <div className="display text-[52px] leading-[54px] text-white">
          <CountUp value={Number(data.proposedSpend)} kind="inr-paise" dimDecimals />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-white/60">
          {plan ? (
            <>
              <span>Created {formatDateTime(plan.createdAt)}</span>
              <Link href={`/procurement/${plan.id}`} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-white transition-colors hover:bg-white/20">
                Open plan <ArrowUpRight className="size-3.5" aria-hidden />
              </Link>
            </>
          ) : (
            <span>No plan yet. Create one to see what to buy.</span>
          )}
        </div>
      </div>
    </section>
  );
}

/** What needs a person today, like an incident panel: each row says what and links to where it is handled. */
function AttentionPanel({ data, pipeline }: { data: CommandCenter; pipeline: PoPipeline }) {
  const limit = formatINR(data.approvalLimit, { paise: false });
  const planHref = data.latestPlan ? `/procurement/${data.latestPlan.id}` : "/procurement";
  const rows = [
    {
      n: data.stockoutRisk,
      icon: PackageX,
      tone: "stockout" as const,
      title: `${data.stockoutRisk} SKU${data.stockoutRisk === 1 ? "" : "s"} will run out before delivery`,
      note: `${data.belowReorderPoint} more below reorder point`,
      href: planHref,
    },
    {
      n: Number(data.expiryExposure) > 0 ? 1 : 0,
      icon: TimerOff,
      tone: "expiry" as const,
      title: `${formatINR(data.expiryExposure, { paise: false })} of stock may expire unsold`,
      note: "Use FEFO and avoid re-ordering these",
      href: "/warehouse?mode=expiry",
    },
    {
      n: pipeline.awaitingOwner,
      icon: ShieldCheck,
      tone: "expiry" as const,
      title: `${pipeline.awaitingOwner} PO${pipeline.awaitingOwner === 1 ? "" : "s"} waiting for the Owner`,
      note: `Above ${limit}; cannot be sent until approved`,
      href: "/purchase-orders",
    },
    {
      n: data.linesAwaitingPo,
      icon: ClipboardList,
      tone: "brand" as const,
      title: `${data.linesAwaitingPo} plan line${data.linesAwaitingPo === 1 ? "" : "s"} not on a PO yet`,
      note: "Approve them in the plan to create POs",
      href: planHref,
    },
  ].filter((r) => r.n > 0);

  return (
    <section className="surface-alert flex flex-col p-5" aria-label="Needs attention">
      <header className="flex items-center justify-between px-1">
        <h2 className="text-[17px] leading-6 tracking-[-0.015em] text-fg-1">Needs attention</h2>
        <span className="text-[12px] text-fg-3">{rows.length ? `${rows.length} open` : "All clear"}</span>
      </header>
      {rows.length === 0 ? (
        <p className="mt-3 px-1 text-fg-2">Nothing needs a person right now.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => (
            <li key={r.title}>
              <Link href={r.href} className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.035] px-3.5 py-3 transition-colors hover:bg-white/[0.07]">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full",
                    r.tone === "stockout" && "bg-stockout text-white shadow-[0_0_16px_rgba(255,92,92,0.5)]",
                    r.tone === "expiry" && "bg-expiry-bg text-expiry ring-1 ring-expiry/30",
                    r.tone === "brand" && "bg-brand-glow text-brand ring-1 ring-brand/30",
                  )}
                >
                  <r.icon className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-fg-1">{r.title}</span>
                  <span className="block truncate text-[12px] text-fg-3">{r.note}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-fg-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Approve → PO → Owner → Send, with how many are at each step. */
function PipelineStrip({ pipeline }: { pipeline: PoPipeline }) {
  const steps = [
    { label: "Lines to approve", value: pipeline.linesAwaitingPo, icon: Sparkles, href: "/procurement" },
    { label: "POs ready to send", value: pipeline.ready, icon: ClipboardList, href: "/purchase-orders" },
    { label: "Waiting for Owner", value: pipeline.awaitingOwner, icon: ShieldCheck, href: "/purchase-orders" },
    { label: "Sent · simulated", value: pipeline.sent, icon: Send, href: "/purchase-orders" },
  ];
  return (
    <section className="surface grid grid-cols-4 p-2 max-sm:grid-cols-2" aria-label="Purchase order pipeline">
      {steps.map((s, i) => (
        <Link key={s.label} href={s.href} className="group relative flex flex-col gap-3 rounded-[18px] p-4 transition-colors hover:bg-white/[0.04]">
          <span className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[12.5px] text-fg-3">
              <s.icon className="size-3.5" strokeWidth={1.6} aria-hidden />
              {s.label}
            </span>
            {i < steps.length - 1 && <ChevronRight className="size-3.5 text-fg-3/60 max-sm:hidden" aria-hidden />}
          </span>
          <span className="display text-[34px] leading-9 text-fg-1">{s.value.toLocaleString("en-IN")}</span>
        </Link>
      ))}
    </section>
  );
}

function SectionTitle({ title, note, href }: { title: string; note: string; href?: string }) {
  return (
    <div className="flex items-end justify-between gap-4 px-1 pt-3">
      <div>
        <h2 className="text-[24px] leading-8 font-light tracking-[-0.03em] text-fg-1">{title}</h2>
        <p className="text-[12.5px] text-fg-3">{note}</p>
      </div>
      {href && (
        <Link href={href} className="inline-flex items-center gap-1 text-[12.5px] text-fg-2 hover:text-fg-1">
          All lines in the plan <ArrowUpRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function CommandCenterSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="space-y-2 pt-2">
        <span className="shimmer block h-4 w-56 rounded-full" />
        <span className="shimmer block h-14 w-[420px] max-w-full rounded-2xl" />
      </div>
      <div className="grid grid-cols-5 gap-3 max-lg:grid-cols-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="shimmer h-14 rounded-full" />
        ))}
      </div>
      <div className="grid grid-cols-[1.65fr_1fr] gap-5 max-lg:grid-cols-1">
        <div className="surface h-[420px]" />
        <div className="space-y-5">
          <div className="surface h-[260px]" />
          <div className="surface h-[220px]" />
        </div>
      </div>
      <CriticalSkuListSkeleton />
    </div>
  );
}
