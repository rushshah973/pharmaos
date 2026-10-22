// A PO's journey as a timeline: created from the plan → Owner approval (if above the limit) → sent to the
// supplier (simulated) → expected delivery. Each step says who and when, or what it is waiting for.
import Link from "next/link";
import { Check, Circle, Clock, X } from "lucide-react";
import { cn } from "cn";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import type { PoDetail } from "@/lib/services/purchase-orders";

type StepState = "done" | "current" | "todo" | "skipped" | "failed";

export function PoTimeline({ po }: { po: PoDetail }) {
  const rejected = po.status === "rejected";
  const sent = po.status === "sent";
  const ownerDone = po.ownerDecision?.decision === "approved";
  const steps: { title: string; detail: React.ReactNode; state: StepState }[] = [
    {
      title: "Created from the purchase plan",
      state: "done",
      detail: (
        <>
          {po.lines} product line{po.lines === 1 ? "" : "s"} approved by {po.approvedBy ?? "the buyer"}
          {po.approvedAt && <> · {formatDateTime(po.approvedAt)}</>}
          {po.sourcePlanId && (
            <>
              {" · "}
              <Link href={`/procurement/${po.sourcePlanId}`} className="text-brand hover:underline">
                open the plan
              </Link>
            </>
          )}
        </>
      ),
    },
    {
      title: "Owner approval",
      state: !po.needsOwnerApproval ? "skipped" : rejected ? "failed" : ownerDone ? "done" : "current",
      detail: !po.needsOwnerApproval
        ? "Not needed: the total is at or below the approval limit"
        : po.ownerDecision
          ? `${po.ownerDecision.decision === "approved" ? "Approved" : "Rejected"} by ${po.ownerDecision.by} · ${formatDateTime(po.ownerDecision.at)}${po.ownerDecision.note ? ` · “${po.ownerDecision.note}”` : ""}`
          : "Waiting: the total is above the approval limit, so the Owner must approve it before it can be sent",
    },
    {
      title: `Sent to ${po.supplierName}`,
      state: sent ? "done" : rejected ? "todo" : po.status === "ready" || po.status === "approved" ? "current" : "todo",
      detail: sent
        ? `${formatDateTime(po.sentAt!)} by ${po.sentBy} · simulated, nothing was emailed`
        : rejected
          ? "Will not be sent (rejected)"
          : po.status === "pending_approval"
            ? "After the Owner approves"
            : "Ready: press “Send to supplier (simulated)” above",
    },
    {
      title: "Delivery",
      state: sent ? "current" : "todo",
      detail: po.expectedDeliveryDate
        ? `Expected ${formatDisplayDate(po.expectedDeliveryDate)}${sent ? " · counts as incoming stock in new plans" : ""}`
        : "No date yet",
    },
  ];

  return (
    <section className="surface p-5 print:hidden" aria-label="Where this purchase order is">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] leading-[22px] font-semibold text-fg-1">Where this PO is</h2>
        <span className="text-[12.5px] text-fg-2">
          Goes to <span className="font-medium text-fg-1">{po.supplierName}</span> <span className="font-mono text-fg-3">{po.supplierCode}</span>
        </span>
      </div>
      <ol className="mt-4 grid gap-4 md:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex gap-3 md:flex-col">
            <div className="flex items-center md:w-full">
              <Dot state={s.state} />
              {i < steps.length - 1 && (
                <span aria-hidden className={cn("hidden h-px flex-1 md:block", s.state === "done" || s.state === "skipped" ? "bg-healthy/40" : "bg-border")} />
              )}
            </div>
            <div className="min-w-0 md:pr-4">
              <div className={cn("text-[13px] font-semibold", s.state === "todo" ? "text-fg-3" : "text-fg-1")}>{s.title}</div>
              <p className="mt-0.5 text-[12px] leading-[17px] text-fg-2">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Dot({ state }: { state: StepState }) {
  const base = "flex size-7 shrink-0 items-center justify-center rounded-full ring-1";
  if (state === "done")
    return (
      <span className={cn(base, "bg-healthy-bg text-healthy ring-healthy/30")}>
        <Check className="size-3.5" strokeWidth={2.5} aria-label="Done" />
      </span>
    );
  if (state === "failed")
    return (
      <span className={cn(base, "bg-stockout-bg text-stockout ring-stockout/30")}>
        <X className="size-3.5" strokeWidth={2.5} aria-label="Rejected" />
      </span>
    );
  if (state === "current")
    return (
      <span className={cn(base, "bg-expiry-bg text-expiry ring-expiry/30")}>
        <Clock className="size-3.5" strokeWidth={2} aria-label="In progress" />
      </span>
    );
  if (state === "skipped")
    return (
      <span className={cn(base, "bg-surface-2 text-fg-3 ring-border")}>
        <Check className="size-3.5" strokeWidth={2} aria-label="Not needed" />
      </span>
    );
  return (
    <span className={cn(base, "bg-surface-2 text-fg-3 ring-border")}>
      <Circle className="size-2.5" aria-label="Not yet" />
    </span>
  );
}
