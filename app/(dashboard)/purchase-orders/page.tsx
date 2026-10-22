import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { ChevronRight, FileText } from "lucide-react";
import { cn } from "cn";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import { PoStatusPill } from "@/components/purchase-orders/PoStatusPill";
import { PoWorkflow, poNextStep } from "@/components/purchase-orders/PoWorkflow";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import { resolvePlanningState } from "@/lib/services/as-of";
import { type PoFilter, type PoListItem, type PoPipeline, countAwaitingApproval, getPoPipeline, listPurchaseOrders } from "@/lib/services/purchase-orders";

export const metadata: Metadata = { title: "Purchase Orders" };

const FILTERS: { id: PoFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "awaiting", label: "Awaiting Owner approval" },
  { id: "ready", label: "Ready to send" },
  { id: "sent", label: "Sent (simulated)" },
  { id: "external", label: "Earlier purchases" },
];

export default function PurchaseOrdersPage({ searchParams }: PageProps<"/purchase-orders">) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase orders"
        description="One PO per supplier, created when plan lines are approved. POs above the Owner approval limit wait for the Owner; sending is simulated — nothing is emailed."
      />
      <Suspense fallback={<ListSkeleton />}>
        <PoList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function PoList({ searchParams }: Pick<PageProps<"/purchase-orders">, "searchParams">) {
  await connection();
  const q = await searchParams;
  const raw = typeof q.filter === "string" ? q.filter : "all";
  const filter = (FILTERS.some((f) => f.id === raw) ? raw : "all") as PoFilter;
  let data: { pos: PoListItem[]; awaiting: number; pipeline: PoPipeline; approvalLimit: string };
  try {
    const [pos, awaiting, pipeline, state] = await Promise.all([listPurchaseOrders(filter), countAwaitingApproval(), getPoPipeline(), resolvePlanningState()]);
    data = { pos, awaiting, pipeline, approvalLimit: state.approvalLimit };
  } catch (err) {
    console.error("[purchase-orders]", err);
    return <ErrorState title="Purchase orders could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  return (
    <>
      <PoWorkflow pipeline={data.pipeline} approvalLimit={formatINR(data.approvalLimit, { paise: false })} />
      <nav className="flex flex-wrap gap-2" aria-label="Filter purchase orders">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={f.id === "all" ? "/purchase-orders" : `/purchase-orders?filter=${f.id}`}
            aria-current={f.id === filter ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-colors duration-150",
              f.id === filter ? "border-brand/40 bg-brand-glow text-brand" : "border-border-strong text-fg-2 hover:bg-surface-2 hover:text-fg-1",
            )}
          >
            {f.label}
            {f.id === "awaiting" && data.awaiting > 0 && <span className="num rounded-full bg-expiry-bg px-1.5 text-[11px] text-expiry">{data.awaiting}</span>}
          </Link>
        ))}
      </nav>
      {data.pos.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={filter === "awaiting" ? "Nothing waiting for the Owner" : "No purchase orders here yet"}
          description={filter === "awaiting" ? "POs above the approval limit appear here until the Owner approves or rejects them." : "Approve lines on a purchase plan to create purchase orders."}
        />
      ) : (
        <section className="surface overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-2">
                  {["Purchase order", "Sent to supplier", "Products on this PO", "Grand total", "Status and next step", "Delivery", ""].map((h, i) => (
                    <th key={h || i} className={`micro-label h-10 px-4 font-medium whitespace-nowrap first:pl-5 ${i === 3 ? "text-right" : "text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.pos.map((po) => (
                  <tr key={po.id} className="group relative border-b border-border align-top transition-colors duration-150 last:border-b-0 hover:bg-surface-3">
                    <td className="py-3 pr-4 pl-5 whitespace-nowrap">
                      <Link href={`/purchase-orders/${po.id}`} className="font-mono text-[12.5px] font-medium text-fg-1 after:absolute after:inset-0 after:content-['']">
                        {po.poNumber}
                      </Link>
                      <div className="mt-0.5 text-[11.5px] text-fg-3">
                        {formatDateTime(po.createdAt)} · {po.origin === "pharmaos" ? "from a purchase plan" : "earlier purchase"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-medium text-fg-1">{po.supplierName}</div>
                      <div className="font-mono text-[11.5px] text-fg-3">{po.supplierCode}</div>
                    </td>
                    <td className="px-4 py-3">
                      <ul className="space-y-0.5 text-[12.5px]">
                        {po.products.map((p) => (
                          <li key={p.sku} className="flex gap-2 whitespace-nowrap">
                            <span className="font-mono text-fg-3">{p.sku}</span>
                            <span className="max-w-[220px] truncate text-fg-1">
                              {p.brandName} {p.strength}
                            </span>
                            <span className="num text-fg-3">× {p.qty}</span>
                          </li>
                        ))}
                      </ul>
                      {po.lines > po.products.length && <div className="mt-0.5 text-[11.5px] text-fg-3">+ {po.lines - po.products.length} more products</div>}
                    </td>
                    <td className="num px-4 py-3 text-right font-medium whitespace-nowrap text-fg-1">
                      {formatINR(po.grandTotal)}
                      <div className="text-[11.5px] font-normal text-fg-3">
                        {po.lines} line{po.lines === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <PoStatusPill status={po.status} />
                      <div className="mt-1 max-w-[220px] text-[11.5px] leading-4 text-fg-3">{poNextStep(po.status)}</div>
                    </td>
                    <td className="px-4 py-3 text-[12.5px] whitespace-nowrap text-fg-2">{po.expectedDeliveryDate ? formatDisplayDate(po.expectedDeliveryDate) : "—"}</td>
                    <td className="py-3 pr-4 text-right">
                      <ChevronRight className="ml-auto size-4 text-fg-3 transition-colors group-hover:text-fg-1" aria-hidden />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="shimmer h-8 w-32 rounded-full" />
        ))}
      </div>
      <div className="surface overflow-hidden">
        <div className="h-10 border-b border-border bg-surface-2" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex h-12 items-center gap-8 border-b border-border px-5">
            <span className="shimmer h-4 w-36 rounded" />
            <span className="shimmer h-4 w-48 rounded" />
            <span className="shimmer ml-auto h-4 w-24 rounded" />
            <span className="shimmer h-[22px] w-32 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
