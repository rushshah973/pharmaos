import type { SkuStatus } from "@/lib/business-logic/types";
import { type PillStatus, StatusPill } from "./StatusPill";

const MAP: Record<SkuStatus, { tone: PillStatus; label: string }> = {
  STOCKOUT_RISK: { tone: "stockout", label: "Stockout risk" },
  BELOW_ROP: { tone: "neutral", label: "Below reorder point" },
  EXCESS: { tone: "excess", label: "Excess" },
  HEALTHY: { tone: "healthy", label: "Healthy" },
  NO_DEMAND: { tone: "neutral", label: "No demand" },
};

/** SKU status, or "Expiry risk" when the SKU is otherwise fine but has stock that will not sell in time. */
export function SkuStatusPill({ status, expiryRisk = false }: { status: SkuStatus; expiryRisk?: boolean }) {
  if (expiryRisk && status !== "STOCKOUT_RISK" && status !== "BELOW_ROP") return <StatusPill status="expiry">Expiry risk</StatusPill>;
  const m = MAP[status];
  return <StatusPill status={m.tone}>{m.label}</StatusPill>;
}
