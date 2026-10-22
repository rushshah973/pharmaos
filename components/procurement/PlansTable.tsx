import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusPill } from "@/components/layout/StatusPill";
import { formatDateTime } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import type { PlanListItem } from "@/lib/services/plans";
import { PlanStatusPill } from "./PlanStatusPill";

const HEADERS: { label: string; align?: "right" }[] = [
  { label: "Created" },
  { label: "Total", align: "right" },
  { label: "Lines", align: "right" },
  { label: "Owner approval" },
  { label: "Status" },
  { label: "Scenario" },
];

/** Procurement list (§10.3): newest first; the whole row opens the plan. */
export function PlansTable({ plans }: { plans: PlanListItem[] }) {
  return (
    <section className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[660px] border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-b border-border bg-surface-2">
              {HEADERS.map((h) => (
                <th key={h.label} className={`micro-label h-10 px-4 font-medium first:pl-5 ${h.align === "right" ? "text-right" : "text-left"}`}>
                  {h.label}
                </th>
              ))}
              <th className="w-10" aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="group relative h-11 border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-white/[0.04]">
                <td className="pr-4 pl-5">
                  <Link href={`/procurement/${p.id}`} className="text-fg-1 after:absolute after:inset-0 after:content-['']">
                    {formatDateTime(p.createdAt)}
                  </Link>
                </td>
                <td className="num px-4 text-right font-medium text-fg-1">{formatINR(p.proposedTotal)}</td>
                <td className="num px-4 text-right text-fg-1">
                  {p.included}
                  <span className="text-fg-3"> / {p.lines}</span>
                </td>
                <td className="px-4">
                  {p.posNeedingApproval > 0 ? (
                    <StatusPill status="expiry">
                      {p.posNeedingApproval} PO{p.posNeedingApproval === 1 ? "" : "s"} · Owner approval
                    </StatusPill>
                  ) : (
                    <span className="text-fg-3">None</span>
                  )}
                </td>
                <td className="px-4">
                  <PlanStatusPill status={p.status} />
                </td>
                <td className="px-4 text-fg-2">{p.scenarioName}</td>
                <td className="pr-4 text-right">
                  <ChevronRight className="ml-auto size-4 text-fg-3 transition-colors group-hover:text-fg-1" aria-hidden />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function PlansTableSkeleton() {
  return (
    <section className="surface overflow-hidden" aria-hidden>
      <div className="h-10 border-b border-border bg-surface-2" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-11 items-center gap-8 border-b border-border px-5 last:border-b-0">
          <span className="shimmer h-4 w-36 rounded" />
          <span className="shimmer ml-auto h-4 w-24 rounded" />
          <span className="shimmer h-4 w-12 rounded" />
          <span className="shimmer h-[22px] w-32 rounded-full" />
          <span className="shimmer h-[22px] w-16 rounded-full" />
          <span className="shimmer h-4 w-20 rounded" />
        </div>
      ))}
    </section>
  );
}
