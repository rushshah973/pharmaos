import { type PillStatus, StatusPill } from "@/components/layout/StatusPill";
import type { PoStatus } from "@/lib/services/purchase-orders";

// Wording rule: never "ordered" or "confirmed"; "sent" always says it is simulated.
const MAP: Record<PoStatus, { tone: PillStatus; label: string }> = {
  ready: { tone: "healthy", label: "Ready to send" },
  pending_approval: { tone: "expiry", label: "Awaiting Owner approval" },
  approved: { tone: "excess", label: "Owner approved" },
  sent: { tone: "healthy", label: "Sent · simulated" },
  rejected: { tone: "stockout", label: "Rejected by Owner" },
  open: { tone: "neutral", label: "In transit" },
  received: { tone: "neutral", label: "Received" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export function PoStatusPill({ status }: { status: PoStatus }) {
  const m = MAP[status];
  return <StatusPill status={m.tone}>{m.label}</StatusPill>;
}
