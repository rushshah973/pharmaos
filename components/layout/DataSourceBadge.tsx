import { FlaskConical } from "lucide-react";
import { cn } from "cn";

/** Every screen says where its numbers come from: all rows are synthetic_demo. */
export function DataSourceBadge({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand-glow text-[11.5px] font-medium text-brand",
        compact ? "size-7 justify-center" : "h-6 px-2.5",
        className,
      )}
      title="Every record and every supplier price is generated synthetic demo data, shaped by public reference sources. Nothing here is real customer data or a real quote."
    >
      <FlaskConical className="size-3.5" strokeWidth={1.75} aria-hidden />
      {compact ? <span className="sr-only">Synthetic demo data</span> : "Synthetic demo data"}
    </span>
  );
}
