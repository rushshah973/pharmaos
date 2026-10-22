import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { ErrorState } from "@/components/layout/ErrorState";
import { PoActions } from "@/components/purchase-orders/PoActions";
import { PoStatusPill } from "@/components/purchase-orders/PoStatusPill";
import { PoTimeline } from "@/components/purchase-orders/PoTimeline";
import { ServiceError } from "@/lib/api/errors";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import { type PoDetail, getPurchaseOrder } from "@/lib/services/purchase-orders";
import { uuid } from "@/lib/validation/api";

export const metadata: Metadata = { title: "Purchase order" };

export default function PoPage({ params }: PageProps<"/purchase-orders/[poId]">) {
  return (
    <Suspense fallback={<div className="surface shimmer h-[640px]" aria-hidden />}>
      <Po params={params} />
    </Suspense>
  );
}

async function Po({ params }: { params: PageProps<"/purchase-orders/[poId]">["params"] }) {
  await connection();
  const { poId } = await params;
  if (!uuid.safeParse(poId).success) notFound();
  let po: PoDetail;
  try {
    po = await getPurchaseOrder(poId);
  } catch (err) {
    if (err instanceof ServiceError && err.status === 404) notFound();
    console.error("[po]", err);
    return <ErrorState title="This purchase order could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  const pharmaos = po.origin === "pharmaos";
  const sent = po.status === "sent";
  const watermark = pharmaos ? (sent ? "SENT (simulated)" : "NOT SENT") : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/purchase-orders" className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-2 hover:text-fg-1">
          <ArrowLeft className="size-3.5" aria-hidden /> All purchase orders
        </Link>
        <PoActions poId={po.id} poNumber={po.poNumber} status={po.status} pharmaos={pharmaos} />
      </div>

      {pharmaos && <PoTimeline po={po} />}

      <article className="surface relative overflow-hidden p-8 print:border-0 print:p-0 print:shadow-none" aria-label={`Purchase order ${po.poNumber}`}>
        {watermark && (
          <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
            <span className={`-rotate-[18deg] text-[88px] font-bold tracking-[0.08em] whitespace-nowrap select-none ${sent ? "text-healthy/10" : "text-fg-1/[0.06]"} print:text-black/10`}>
              {watermark}
            </span>
          </div>
        )}

        <header className="relative flex flex-wrap items-start justify-between gap-6 border-b border-border pb-6">
          <div>
            <p className="micro-label">Purchase order</p>
            <h1 className="mt-1 font-mono text-[22px] leading-7 font-semibold text-fg-1">{po.poNumber}</h1>
            <div className="mt-2 flex items-center gap-2">
              <PoStatusPill status={po.status} />
              {!pharmaos && <span className="text-[12px] text-fg-3">Earlier purchase (before PharmaOS) · reference only</span>}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-[12.5px]">
            <Meta label="Created">{formatDateTime(po.createdAt)}</Meta>
            <Meta label="Expected delivery">{po.expectedDeliveryDate ? formatDisplayDate(po.expectedDeliveryDate) : "—"}</Meta>
            <Meta label="Source">{po.sourcePlanId ? <Link href={`/procurement/${po.sourcePlanId}`} className="text-brand hover:underline print:text-black">Purchase plan</Link> : "Seeded history"}</Meta>
            <Meta label="Payment terms">{po.supplierPaymentTermsDays ? `${po.supplierPaymentTermsDays} days` : "—"}</Meta>
          </dl>
        </header>

        <section className="relative grid gap-6 border-b border-border py-6 md:grid-cols-2">
          <div>
            <p className="micro-label">From (buyer)</p>
            <p className="mt-1 font-medium text-fg-1">Demo pharma stockist</p>
            <p className="text-[12.5px] text-fg-2">PharmaOS workspace · synthetic demo data</p>
          </div>
          <div>
            <p className="micro-label">To (supplier)</p>
            <p className="mt-1 font-medium text-fg-1">
              {po.supplierName} <span className="font-mono text-[12.5px] text-fg-2">{po.supplierCode}</span>
            </p>
            <p className="text-[12.5px] text-fg-2">Approved supplier · quote prices</p>
          </div>
        </section>

        <div className="relative overflow-x-auto py-6">
          <table className="w-full min-w-[760px] border-collapse text-[12.5px] whitespace-nowrap">
            <thead>
              <tr className="border-b border-border">
                {["SKU", "Product", "Manufacturer", "Pack", "Qty", "Free", "Price", "GST", "Freight", "Line total"].map((h, i) => (
                  <th key={h} className={`micro-label h-9 px-2 font-medium first:pl-0 last:pr-0 ${i >= 4 ? "text-right" : "text-left"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {po.lineItems.map((l) => (
                <tr key={l.id} className="h-11 border-b border-border last:border-b-0">
                  <td className="px-2 pl-0 font-mono text-fg-1">{l.sku}</td>
                  <td className="max-w-[240px] truncate px-2 text-fg-1">
                    {l.brandName} {l.strength} <span className="text-fg-3">· {l.dosageForm}</span>
                  </td>
                  <td className="px-2 text-fg-2">{l.manufacturer}</td>
                  <td className="px-2 text-fg-2">{l.packSize}/pack</td>
                  <td className="num px-2 text-right text-fg-1">{l.qty}</td>
                  <td className="num px-2 text-right text-fg-2">{l.freeQty || "—"}</td>
                  <td className="num px-2 text-right text-fg-1">{formatINR(l.unitPrice)}</td>
                  <td className="num px-2 text-right text-fg-2">
                    {Number(l.taxRate)}% · {formatINR(l.lineTax)}
                  </td>
                  <td className="num px-2 text-right text-fg-2">{formatINR(l.lineFreight)}</td>
                  <td className="num px-2 pr-0 text-right font-medium text-fg-1">{formatINR(l.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="relative flex flex-wrap items-start justify-between gap-8 border-t border-border pt-6">
          <dl className="space-y-2 text-[12.5px]">
            {pharmaos && (
              <>
                <Meta label="Lines approved by">
                  {po.approvedBy ?? "—"}
                  {po.approvedAt && <span className="text-fg-3"> · {formatDateTime(po.approvedAt)}</span>}
                </Meta>
                <Meta label="Owner approval">
                  {po.ownerDecision
                    ? `${po.ownerDecision.decision === "approved" ? "Approved" : "Rejected"} by ${po.ownerDecision.by} · ${formatDateTime(po.ownerDecision.at)}${po.ownerDecision.note ? ` · “${po.ownerDecision.note}”` : ""}`
                    : po.status === "pending_approval"
                      ? "Required (above the approval limit) · waiting"
                      : "Not required (at or below the approval limit)"}
                </Meta>
                <Meta label="Sent">
                  {sent ? (
                    <>
                      {formatDateTime(po.sentAt!)} by {po.sentBy} <span className="text-fg-3">· simulated, nothing was emailed</span>
                    </>
                  ) : (
                    "Not sent"
                  )}
                </Meta>
              </>
            )}
          </dl>
          <dl className="w-[280px] space-y-1.5 text-[13px]">
            <Total label="Subtotal" value={po.subtotal} />
            <Total label="GST" value={po.taxTotal} />
            <Total label="Freight" value={po.freightTotal} />
            <div className="flex items-baseline justify-between border-t border-border pt-2">
              <dt className="font-semibold text-fg-1">Grand total</dt>
              <dd className="num text-[18px] font-semibold text-fg-1">{formatINR(po.grandTotal)}</dd>
            </div>
          </dl>
        </section>

        <p className="relative mt-8 text-[11.5px] text-fg-3">
          Synthetic demo data. PharmaOS never sends anything to suppliers: “Send” only marks the PO as sent (simulated).
        </p>
      </article>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] text-fg-3">{label}</dt>
      <dd className="text-fg-1">{children}</dd>
    </div>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-fg-2">{label}</dt>
      <dd className="num text-fg-1">{formatINR(value)}</dd>
    </div>
  );
}
