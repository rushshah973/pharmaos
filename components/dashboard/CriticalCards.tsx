import Link from "next/link";
import { ArrowUpRight, MapPin, Pill } from "lucide-react";
import { cn } from "cn";
import { SkuStatusPill } from "@/components/layout/SkuStatusPill";
import { dec } from "@/lib/money";
import type { CriticalSku } from "@/lib/services/dashboard";

/**
 * The four SKUs that run out first, as cards. The rail runs from today to the later of "runs out" and "next
 * delivery": the white marker is when stock runs out, the copper one when the fastest supplier can deliver. A gap
 * between them (runs out first) is the stockout window.
 */
export function CriticalCards({ skus, latestPlanId }: { skus: CriticalSku[]; latestPlanId: string | null }) {
  if (skus.length === 0) return null;
  return (
    <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2">
      {skus.slice(0, 4).map((s, i) => (
        <Card key={s.productId} s={s} hero={i === 0} latestPlanId={latestPlanId} />
      ))}
    </div>
  );
}

function Card({ s, hero, latestPlanId }: { s: CriticalSku; hero: boolean; latestPlanId: string | null }) {
  const cover = s.cover ?? 0;
  const span = Math.max(cover, s.leadTimeDays, 1) * 1.15;
  const out = Math.min(1, cover / span);
  const lead = Math.min(1, s.leadTimeDays / span);
  const gap = Math.max(0, s.leadTimeDays - cover);
  const href = latestPlanId && s.planLineId ? `/procurement/${latestPlanId}?line=${s.planLineId}` : null;
  return (
    <article className={cn("group relative flex min-h-[248px] flex-col overflow-hidden p-5", hero ? "surface-hero" : "surface")}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[18px] leading-6 font-normal tracking-[-0.02em] text-fg-1">{s.brandName}</h3>
          <p className="truncate text-[12.5px] text-fg-3">
            <span className="font-mono">{s.sku}</span> · {s.strength}
          </p>
        </div>
        {href ? (
          <Link href={href} aria-label={`Open ${s.sku} in the plan`} className="glass-pill flex size-8 shrink-0 items-center justify-center text-fg-2 transition-colors hover:text-fg-1">
            <ArrowUpRight className="size-4" strokeWidth={1.6} />
          </Link>
        ) : null}
      </header>

      <div className="mt-4 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-fg-2">
          <Pill className="size-5" strokeWidth={1.4} aria-hidden />
        </span>
        <div className="flex flex-col gap-1.5">
          <SkuStatusPill status={s.status} expiryRisk={dec(s.atRiskValue).greaterThan(0)} />
          <Link href={`/warehouse?sku=${encodeURIComponent(s.sku)}`} className="inline-flex items-center gap-1 text-[12px] text-fg-3 transition-colors hover:text-fg-1">
            <MapPin className="size-3" aria-hidden /> Locate in warehouse
          </Link>
        </div>
      </div>

      <div className="mt-auto pt-5">
        <div className="mb-2 flex items-end justify-between">
          <div>
            <div className="display text-[30px] leading-8 text-fg-1">
              {s.cover === null ? "—" : s.cover.toFixed(1)}
              <span className="dim text-[16px]"> days</span>
            </div>
            <div className="text-[11.5px] text-fg-3">of stock left</div>
          </div>
          <div className="text-right">
            <div className={cn("num text-[13px]", gap > 0 ? "text-stockout" : "text-fg-2")}>{gap > 0 ? `${gap.toFixed(1)} d short` : "covered"}</div>
            <div className="text-[11.5px] text-fg-3">delivery in {s.leadTimeDays} d</div>
          </div>
        </div>
        <div className="relative h-6">
          <div className="tick-rail absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 opacity-60" style={{ maskImage: `linear-gradient(90deg, #000 ${out * 100}%, rgba(0,0,0,0.25) ${out * 100}%)` }} />
          {gap > 0 && (
            <div className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-stockout/25" style={{ left: `${out * 100}%`, width: `${(lead - out) * 100}%` }} aria-hidden />
          )}
          <Marker at={out} className="bg-white" label="Runs out" />
          <Marker at={lead} className="bg-brand" label="Delivery" />
        </div>
        <div className="mt-1 flex justify-between text-[10.5px] tracking-[0.04em] text-fg-3 uppercase" aria-hidden>
          <span>Today</span>
          <span>{Math.round(span)} d</span>
        </div>
        <span className="sr-only">
          {s.cover === null ? "No cover figure." : `Runs out in ${s.cover.toFixed(1)} days.`} The fastest supplier delivers in {s.leadTimeDays} days.
        </span>
      </div>
    </article>
  );
}

function Marker({ at, className, label }: { at: number; className: string; label: string }) {
  return (
    <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${at * 100}%` }} title={label}>
      <span className={cn("block h-5 w-[3px] rounded-full shadow-[0_0_12px_rgba(255,255,255,0.4)]", className)} />
    </span>
  );
}
