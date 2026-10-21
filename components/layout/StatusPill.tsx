import { cn } from "cn";

export type PillStatus = "stockout" | "expiry" | "excess" | "healthy" | "neutral";

const STYLES: Record<PillStatus, string> = {
  stockout: "bg-stockout-bg text-stockout",
  expiry: "bg-expiry-bg text-expiry",
  excess: "bg-excess-bg text-excess",
  healthy: "bg-healthy-bg text-healthy",
  neutral: "bg-neutral-bg text-neutral",
};

/** Status is always dot + label, never colour alone (§10.1). */
export function StatusPill({ status, children, className }: { status: PillStatus; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap",
        STYLES[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}
