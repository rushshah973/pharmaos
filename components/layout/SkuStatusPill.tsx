import type { SkuStatus } from "@/lib/business-logic/types";
import { type PillStatus, StatusPill } from "./StatusPill";

const MAP: Record<SkuStatus, { tone: PillStatus; label: string; short?: string }> = {
  STOCKOUT_RISK: { tone: "stockout", label: "Stockout risk", short: "Stockout" },
  BELOW_ROP: { tone: "neutral", label: "Below reorder point", short: "Below ROP" },
  EXCESS: { tone: "excess", label: "Excess" },
  HEALTHY: { tone: "healthy", label: "Healthy" },
  NO_DEMAND: { tone: "neutral", label: "No demand" },
};

/** SKU status, or "Expiry risk" when the SKU is otherwise fine but has stock that will not sell in time. */
/** `compact` uses short labels for dense tables (the full label is the title). */
export function SkuStatusPill({ status, expiryRisk = false, compact = false }: { status: SkuStatus; expiryRisk?: boolean; compact?: boolean }) {
  if (expiryRisk && status !== "STOCKOUT_RISK" && status !== "BELOW_ROP") return <StatusPill status="expiry">Expiry risk</StatusPill>;
  const m = MAP[status];
  return (
    <span title={m.label} className="inline-flex">
      <StatusPill status={m.tone}>{compact ? (m.short ?? m.label) : m.label}</StatusPill>
    </span>
  );
}
