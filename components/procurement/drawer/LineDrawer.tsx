"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { MapPin } from "lucide-react";
import { DataSourceBadge } from "@/components/layout/DataSourceBadge";
import { SkuStatusPill } from "@/components/layout/SkuStatusPill";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { WARNING_TEXT } from "@/lib/format/codes";
import { formatINR } from "@/lib/money";
import type { LineDetail } from "@/lib/services/line-detail";
import type { SupplierPo } from "@/lib/services/plans";
import { DemandChart } from "./DemandChart";
import { EditPanel } from "./EditPanel";
import { requestLine, useRequestedLine } from "./line-store";
import { BatchesTable, FormulaPanel, Section, StockSection, SupplierComparison } from "./LineSections";

export type DrawerPayload = { lineId: string; detail: LineDetail | null } | null;

const CRITICALITY: Record<string, string> = { life_saving: "Life-saving", chronic: "Chronic", acute: "Acute", otc: "OTC" };
const STORAGE: Record<string, string> = { ambient: "Ambient", cool: "Cool (8–15 °C)", cold_chain: "Cold chain (2–8 °C)" };

/**
 * Line drawer (§10.3): opens from ?line=<id>, 560 px from the right. The URL is the state, so the
 * drawer survives a refresh and can be linked from the Command Center. Content is rendered on the
 * server from evidence_json; until it arrives for the requested line, a skeleton shows.
 */
export function LineDrawer({
  planId,
  payload,
  planTotal,
  supplierPos,
  locked,
}: {
  planId: string;
  payload: DrawerPayload;
  planTotal: string;
  supplierPos: SupplierPo[];
  locked: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const requested = useRequestedLine();
  const urlLine = params.get("line");
  const lineId = requested !== undefined ? requested : urlLine;
  // Once the URL catches up (or changes for any other reason), the URL is the source of truth again.
  useEffect(() => requestLine(undefined), [urlLine]);
  const ready = payload !== null && payload.lineId === lineId;

  // Closing only changes the URL; nothing needs to be fetched.
  const close = () => {
    const next = new URLSearchParams(params.toString());
    next.delete("line");
    const q = next.toString();
    requestLine(null);
    window.history.pushState(null, "", q ? `${pathname}?${q}` : pathname);
  };

  return (
    <Sheet open={lineId !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side="right"
        className="w-[560px] max-w-[calc(100vw-2rem)] gap-0 overflow-y-auto border-l border-border-strong bg-surface-2 p-0 shadow-(--shadow-pop) data-[side=right]:sm:max-w-[560px]"
      >
        {!ready ? (
          <DrawerSkeleton />
        ) : payload.detail === null ? (
          <div className="p-6">
            <SheetTitle className="text-[15px] font-semibold text-fg-1">Line not found</SheetTitle>
            <SheetDescription className="mt-1 text-fg-2">This line is not part of this plan any more. Close the panel and pick another line.</SheetDescription>
          </div>
        ) : (
          <DrawerBody planId={planId} detail={payload.detail} planTotal={planTotal} supplierPos={supplierPos} locked={locked} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({ planId, detail, planTotal, supplierPos, locked }: { planId: string; detail: LineDetail; planTotal: string; supplierPos: SupplierPo[]; locked: boolean }) {
  const { line, product, demand } = detail;
  const edited = line.status === "edited";
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border bg-surface-2/95 px-6 pt-5 pb-4 backdrop-blur">
        <div className="flex items-center gap-2 pr-8">
          <SheetTitle className="font-mono text-[15px] font-semibold text-fg-1">{line.sku}</SheetTitle>
          <SkuStatusPill status={line.skuStatus} />
          {edited && <span className="rounded border border-brand/30 px-1.5 text-[10.5px] leading-4 font-medium text-brand">Edited</span>}
          <span className="ml-auto text-[12px] text-fg-3">Rank {line.rank}</span>
        </div>
        <SheetDescription className="mt-1 text-[13.5px] text-fg-1">
          {product.brandName} · {product.strength} · {product.dosageForm} · {product.packSize}/pack
        </SheetDescription>
        <p className="mt-0.5 text-[12.5px] text-fg-2">
          {product.genericName} · {product.manufacturer}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
          <Chip>{CRITICALITY[product.criticality] ?? product.criticality}</Chip>
          <Chip>{STORAGE[product.storageClass] ?? product.storageClass}</Chip>
          <Chip className="capitalize">{product.category}</Chip>
          <Chip>Shelf life {Math.round(product.shelfLifeDays / 30)} mo</Chip>
          {detail.dataSource === "synthetic_demo" ? <DataSourceBadge className="ml-auto" /> : <Chip className="ml-auto">{detail.dataSource}</Chip>}
        </div>
        <div className="mt-3 flex items-baseline justify-between">
          <p className="text-[13px] text-fg-2">
            Buying <span className="num font-semibold text-fg-1">{line.qty}</span>
            {line.freeQty > 0 && <span className="text-healthy"> +{line.freeQty} free</span>} from <span className="font-mono text-fg-1">{line.supplierCode ?? "—"}</span> ·{" "}
            <span className="num font-semibold text-fg-1">{formatINR(line.totals.lineTotal)}</span>
          </p>
          <Link href={`/warehouse?sku=${encodeURIComponent(line.sku)}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">
            <MapPin className="size-3.5" aria-hidden /> Locate in warehouse
          </Link>
        </div>
        {edited && detail.engine.lineTotal && (
          <p className="mt-1 text-[12px] text-fg-3">
            Engine recommended {detail.engine.qty} packs from {detail.offers.find((o) => o.winner)?.supplierCode ?? "—"} · {formatINR(detail.engine.lineTotal)}
          </p>
        )}
      </header>

      <div className="space-y-7 px-6 py-6">
        <Section title="Edit this line">
          <EditPanel key={`${line.id}:${line.qty}:${line.offerId}`} planId={planId} detail={detail} planTotal={planTotal} supplierPos={supplierPos} locked={locked} />
        </Section>

        <Section title={demand.forecast14?.length ? "Demand · last 28 days and the next 14" : "Demand · last 28 days"} aside={demand.method === "ml" ? "d̄ = ML forecast" : "d̄ = 0.6 × d7 + 0.4 × d28"}>
          <div className="rounded-lg border border-border bg-surface-1 px-3 pt-3 pb-1">
            <DemandChart series={demand.dailySeries} forecast={demand.forecast14} d7={demand.d7} d28={demand.d28} dbar={demand.avgDailyDemand} />
          </div>
          <MethodLine demand={demand} />
          {demand.flags.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {demand.flags.map((f) => (
                <li key={f} className="rounded-full border border-expiry/30 bg-expiry-bg px-2.5 text-[12px] leading-[22px] text-expiry" title={WARNING_TEXT[f].meaning}>
                  {WARNING_TEXT[f].short}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <StockSection detail={detail} />
        <BatchesTable detail={detail} />
        <SupplierComparison offers={detail.offers} />
        <FormulaPanel formulas={detail.formulas} />

        <p className="text-[11.5px] text-fg-3">Evidence captured when the plan was built or last recalculated (as of {detail.asOf}). Edits are re-checked against fresh data.</p>
      </div>
    </>
  );
}

/** The honest accuracy line: both backtest errors, the method in use and who chose it (§6.2a). */
function MethodLine({ demand }: { demand: LineDetail["demand"] }) {
  if (!demand.method) {
    return <p className="text-[12px] text-fg-3">This plan was built before the demand model existed; recalculate it to see the ML forecast.</p>;
  }
  const by = demand.methodChosenBy === "demand-agent" ? "chosen by the Demand Agent" : demand.methodChosenBy === "default" ? "chosen by the default rule" : "no model trained yet";
  const ml = demand.method === "ml";
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border bg-surface-1 px-3 py-2.5">
      <span className={`mt-0.5 shrink-0 rounded-full px-2 text-[11px] leading-5 font-semibold ${ml ? "bg-brand-glow text-brand" : "bg-neutral-bg text-neutral"}`}>
        {ml ? "ML" : "Average"}
      </span>
      <p className="text-[12.5px] leading-[18px] text-fg-2">
        <span className="text-fg-1">{demand.methodReason}</span>
        <span className="text-fg-3"> · {by} · model trained on synthetic demo data</span>
      </p>
    </div>
  );
}

function Chip({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <span className={`inline-flex h-6 items-center rounded-full border border-border-strong px-2.5 text-fg-2 ${className}`}>{children}</span>;
}

function DrawerSkeleton() {
  return (
    <div className="space-y-6 p-6" aria-label="Loading line details">
      <SheetTitle className="sr-only">Loading line</SheetTitle>
      <div className="space-y-2">
        <span className="shimmer block h-6 w-40 rounded" />
        <span className="shimmer block h-5 w-72 rounded" />
        <span className="shimmer block h-4 w-56 rounded" />
      </div>
      <span className="shimmer block h-40 w-full rounded-xl" />
      <span className="shimmer block h-44 w-full rounded-lg" />
      <span className="shimmer block h-32 w-full rounded-lg" />
      <span className="shimmer block h-48 w-full rounded-lg" />
    </div>
  );
}
