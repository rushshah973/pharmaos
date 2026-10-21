import { type PillStatus, StatusPill } from "@/components/layout/StatusPill";
import type { PlanStatus } from "@/lib/services/plans";

const MAP: Record<PlanStatus, { tone: PillStatus; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  partially_approved: { tone: "expiry", label: "Partly approved" },
  approved: { tone: "healthy", label: "Approved" },
  rejected: { tone: "stockout", label: "Rejected" },
};

export function PlanStatusPill({ status }: { status: PlanStatus }) {
  const m = MAP[status];
  return <StatusPill status={m.tone}>{m.label}</StatusPill>;
}
