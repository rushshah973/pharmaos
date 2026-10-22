import { cn } from "cn";

export type PillStatus = "stockout" | "expiry" | "excess" | "healthy" | "neutral";

// Outlined glass pills: a tinted hairline and a faint fill of the status colour.
const STYLES: Record<PillStatus, string> = {
  stockout: "border-stockout/30 bg-stockout-bg text-stockout",
  expiry: "border-expiry/30 bg-expiry-bg text-expiry",
  excess: "border-excess/30 bg-excess-bg text-excess",
  healthy: "border-healthy/30 bg-healthy-bg text-healthy",
  neutral: "border-white/12 bg-white/[0.04] text-fg-2",
};

/** Status is always dot + label, never colour alone (§10.1). */
export function StatusPill({ status, children, className }: { status: PillStatus; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[24px] items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-normal whitespace-nowrap",
        STYLES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
