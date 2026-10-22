import { ShieldAlert } from "lucide-react";
import { formatINR } from "@/lib/money";
import type { SupplierPo } from "@/lib/services/plans";

/** One chip per supplier: the PO it would get if every line were approved, flagged above the approval limit. */
export function SupplierPoStrip({ pos, approvalLimit }: { pos: SupplierPo[]; approvalLimit: string }) {
  if (pos.length === 0) return null;
  const limit = formatINR(approvalLimit, { paise: false });
  const gated = pos.filter((p) => p.needsApproval).length;
  return (
    <section className="surface p-5" aria-label="Projected purchase orders">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] leading-[22px] font-semibold text-fg-1">Projected purchase orders</h2>
        {/* State the outcome for this plan, not only the rule, so nobody reads the rule as a pending request. */}
        <p className={`text-[12.5px] ${gated > 0 ? "text-expiry" : "text-fg-3"}`}>
          One PO per supplier ·{" "}
          {gated > 0
            ? `${gated} PO${gated === 1 ? " is" : "s are"} above ${limit} and will need the Owner's approval before sending`
            : `no Owner approval needed: every PO is at or below ${limit}`}
        </p>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-6">
        {pos.map((po) => (
          <li
            key={po.supplierId}
            className={`rounded-lg border bg-surface-2 px-3 py-2.5 ${po.needsApproval ? "border-expiry/40" : "border-border"}`}
            title={po.supplierName}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[12.5px] text-fg-1">{po.supplierCode}</span>
              <span className="text-[11.5px] text-fg-3">
                {po.lines} line{po.lines === 1 ? "" : "s"}
              </span>
            </div>
            <div className="num mt-1 text-[15px] font-semibold text-fg-1">{formatINR(po.total, { paise: false })}</div>
            {po.needsApproval ? (
              <span className="mt-1.5 inline-flex h-5 items-center gap-1 rounded-full bg-expiry-bg px-2 text-[11px] font-medium text-expiry">
                <ShieldAlert className="size-3" strokeWidth={2} aria-hidden /> Owner approval
              </span>
            ) : (
              <span className="mt-1.5 block truncate text-[11.5px] text-fg-3">{po.supplierName}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
