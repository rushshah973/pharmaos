import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { CountUp } from "./CountUp";

export type KpiTone = "brand" | "stockout" | "expiry" | "neutral";

const TONES: Record<KpiTone, string> = {
  brand: "bg-brand-glow text-brand",
  stockout: "bg-stockout-bg text-stockout",
  expiry: "bg-expiry-bg text-expiry",
  neutral: "bg-neutral-bg text-neutral",
};

/** KPI tile (§10.1): micro label, hero number that counts up once, one line of context. */
export function KpiTile({
  label,
  value,
  kind = "int",
  context,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  kind?: "inr" | "int";
  context: React.ReactNode;
  icon: LucideIcon;
  tone?: KpiTone;
}) {
  return (
    <div className="surface flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="micro-label">{label}</span>
        <span className={cn("flex size-7 items-center justify-center rounded-md", TONES[tone])} aria-hidden>
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
      </div>
      <div className="text-[32px] leading-9 font-semibold tracking-[-0.02em] text-fg-1">
        <CountUp value={value} kind={kind} />
      </div>
      <p className="truncate text-fg-2">{context}</p>
    </div>
  );
}

export function KpiTileSkeleton() {
  return (
    <div className="surface flex flex-col gap-3 p-5" aria-hidden>
      <div className="flex items-center justify-between">
        <span className="shimmer h-4 w-28 rounded" />
        <span className="shimmer size-7 rounded-md" />
      </div>
      <span className="shimmer h-9 w-32 rounded-md" />
      <span className="shimmer h-5 w-44 rounded" />
    </div>
  );
}
