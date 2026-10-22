// The purchase-order flow as four numbered steps with live counts, so it is clear where every PO is and what
// happens next. Sending is simulated: nothing leaves the app.
import Link from "next/link";
import { CheckCheck, ClipboardCheck, FileText, Send, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import type { PoPipeline } from "@/lib/services/purchase-orders";

export function PoWorkflow({ pipeline, approvalLimit }: { pipeline: PoPipeline; approvalLimit: string }) {
  const steps = [
    {
      n: 1,
      icon: ClipboardCheck,
      title: "Approve plan lines",
      text: "On the purchase plan, tick the lines to buy and press Approve.",
      count: pipeline.linesAwaitingPo,
      unit: "lines waiting in the latest plan",
      href: "/procurement",
      tone: "brand" as const,
    },
    {
      n: 2,
      icon: FileText,
      title: "One PO per supplier",
      text: "PharmaOS groups the approved lines by supplier and creates one purchase order for each.",
      count: pipeline.ready,
      unit: "ready to send",
      href: "/purchase-orders?filter=ready",
      tone: "healthy" as const,
    },
    {
      n: 3,
      icon: ShieldCheck,
      title: "Owner approval if large",
      text: `A PO above ${approvalLimit} waits for the Owner to approve it before it can be sent.`,
      count: pipeline.awaitingOwner,
      unit: "awaiting Owner",
      href: "/purchase-orders?filter=awaiting",
      tone: "expiry" as const,
    },
    {
      n: 4,
      icon: Send,
      title: "Send to supplier",
      text: "Marks the PO as sent to its supplier (simulated, nothing is emailed). From step 2 on, new plans already count its stock as on order.",
      count: pipeline.sent,
      unit: "sent (simulated)",
      href: "/purchase-orders?filter=sent",
      tone: "healthy" as const,
    },
  ];
  const TONE = { brand: "text-brand bg-brand-glow ring-brand/25", healthy: "text-healthy bg-healthy-bg ring-healthy/25", expiry: "text-expiry bg-expiry-bg ring-expiry/25" };

  return (
    <section className="surface p-5" aria-label="How purchase orders work">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">How a purchase order is made</h2>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-fg-3">
          <CheckCheck className="size-3.5" aria-hidden /> Every step is recorded in the Activity log
        </span>
      </div>
      <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.n} className="relative">
            <Link href={s.href} className="group flex h-full flex-col rounded-lg border border-border bg-surface-2 p-4 transition-colors hover:border-border-strong hover:bg-white/[0.04]">
              <div className="flex items-center gap-2.5">
                <span className={cn("flex size-8 items-center justify-center rounded-full ring-1", TONE[s.tone])}>
                  <s.icon className="size-4" strokeWidth={1.75} aria-hidden />
                </span>
                <span className="micro-label">Step {s.n}</span>
              </div>
              <div className="mt-3 text-[13.5px] font-semibold text-fg-1">{s.title}</div>
              <p className="mt-1 flex-1 text-[12.5px] leading-[18px] text-fg-2">{s.text}</p>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="num text-[20px] leading-6 font-semibold text-fg-1">{s.count}</span>
                <span className="text-[12px] text-fg-3 group-hover:text-fg-2">{s.unit} →</span>
              </div>
            </Link>
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute top-1/2 -right-2.5 z-10 hidden size-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-1 text-[11px] text-fg-3 xl:flex">
                ›
              </span>
            )}
          </li>
        ))}
      </ol>
      {pipeline.rejected > 0 && <p className="mt-3 text-[12px] text-fg-3">{pipeline.rejected} PO(s) were rejected by the Owner; their lines can be planned again.</p>}
    </section>
  );
}

/** What happens next for one PO, in plain words. */
export function poNextStep(status: string): string {
  switch (status) {
    case "ready":
      return "Next: send it to the supplier";
    case "pending_approval":
      return "Next: Owner approves or rejects";
    case "approved":
      return "Owner approved · next: send it";
    case "sent":
      return "Sent to the supplier (simulated) · arriving as incoming stock";
    case "rejected":
      return "Rejected by the Owner · not sent";
    case "open":
      return "Earlier order, still in transit";
    case "received":
      return "Earlier order, received";
    default:
      return "Earlier order, cancelled";
  }
}
