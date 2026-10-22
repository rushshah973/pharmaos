"use client";

// Bin panel (§11): location path, capacity and fill, and every balance in the bin with its batch, expiry,
// days left, quantity, reservation, quality status, engine status and data source. Mount with key={binId}.
import { useEffect, useState } from "react";
import { CircleAlert, MousePointerClick, PackageOpen, RotateCw, X } from "lucide-react";
import { cn } from "cn";
import { SkuStatusPill } from "@/components/layout/SkuStatusPill";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { daysBetween } from "@/lib/business-logic/dates";
import type { BinHeat } from "@/lib/business-logic/heatmap";
import { formatDisplayDate } from "@/lib/format/date";
import type { BinDetails, HeatmapView } from "@/lib/services/warehouse";
import { describeBin } from "@/lib/warehouse/geometry";
import { type ModeMeta, STORAGE_LABEL, severityStyle } from "./modes";

const QUALITY: Record<string, string> = { released: "Released", quarantine: "Quarantine", rejected: "Rejected", recalled: "Recalled" };
/** Short data-source labels for the narrow panel; the full name is the title. */
const SOURCE: Record<string, [string, string]> = {
  synthetic_demo: ["Synthetic", "Synthetic demo data"],
  public_reference: ["Public ref.", "Public reference data"],
  unverified_sample: ["Unverified", "Unverified sample"],
  verified_customer_data: ["Verified", "Verified customer data"],
};

export function BinPanelEmpty({ mode, highlighted }: { mode: ModeMeta; highlighted: number }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-brand-glow text-brand ring-1 ring-brand/20">
        <MousePointerClick className="size-[18px]" strokeWidth={1.75} aria-hidden />
      </span>
      <h2 className="mt-4 text-[15px] leading-[22px] font-semibold text-fg-1">Select a bin</h2>
      <p className="mt-1 max-w-[260px] text-fg-2">
        {highlighted > 0
          ? `${highlighted} bin${highlighted === 1 ? "" : "s"} highlighted for ${mode.label.toLowerCase()}. Click one to see its stock, batches and status.`
          : "Click any bin to see its stock, batches and status."}
      </p>
    </div>
  );
}

export function BinPanel({
  binId,
  heat,
  mode,
  asOf,
  placements,
  highlightSku,
  onClose,
}: {
  binId: string;
  heat: BinHeat | undefined;
  mode: ModeMeta;
  asOf: string;
  placements: HeatmapView["placements"];
  /** The SKU being located: listed first and outlined. */
  highlightSku?: string | null;
  onClose: () => void;
}) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; message: string } | { status: "ready"; bin: BinDetails }>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/warehouse/bins/${binId}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (HTTP ${res.status}).`);
        setState({ status: "ready", bin: json as BinDetails });
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", message: err instanceof Error ? err.message : "The bin could not load." });
      });
    return () => ctrl.abort();
  }, [binId, attempt]);

  const here = placements.filter((p) => p.binId === binId);

  return (
    <div className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <div className="micro-label">Bin</div>
          <div className="mt-0.5 font-mono text-[18px] leading-6 font-medium text-fg-1">{state.status === "ready" ? state.bin.binCode : heat?.binCode}</div>
          <div className="mt-0.5 text-[12px] text-fg-3">
            {describeBin(state.status === "ready" ? state.bin.binCode : (heat?.binCode ?? ""))}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="size-8 shrink-0 text-fg-3 hover:text-fg-1" onClick={onClose} aria-label="Close bin">
          <X className="size-4" />
        </Button>
      </div>

      {heat && (
        <div className="flex items-center gap-2.5 border-b border-border px-5 py-3">
          <span className="size-3 shrink-0 rounded-[3px] border border-border bg-surface-2" style={severityStyle(mode.tone, heat.severity)} aria-hidden />
          <div className="min-w-0">
            <div className="text-[11px] text-fg-3">{mode.label}</div>
            <div className="text-[13px] leading-5 text-fg-1">{heat.label}</div>
          </div>
        </div>
      )}

      {state.status === "loading" && (
        <div className="space-y-4 px-5 py-4" aria-busy>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {state.status === "error" && (
        <div role="alert" className="px-5 py-6 text-center">
          <p className="text-fg-1">This bin could not load.</p>
          <p className="mt-1 text-[12.5px] text-fg-3">{state.message}</p>
          <Button
            variant="outline"
            className="mt-4 h-8"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            <RotateCw className="size-3.5" aria-hidden /> Retry
          </Button>
        </div>
      )}

      {state.status === "ready" && <BinBody bin={state.bin} asOf={asOf} here={here} highlightSku={highlightSku ?? null} />}
    </div>
  );
}

function BinBody({ bin, asOf, here, highlightSku }: { bin: BinDetails; asOf: string; here: HeatmapView["placements"]; highlightSku: string | null }) {
  const products = [...bin.products].sort((a, b) => Number(b.sku === highlightSku) - Number(a.sku === highlightSku));
  const fill = Math.min(100, Math.round((bin.used / bin.capacityUnits) * 100));
  const proposed = here.reduce((n, p) => n + p.packs, 0);
  const after = Math.min(100, Math.round(((bin.used + proposed) / bin.capacityUnits) * 100));
  return (
    <div className="space-y-5 px-5 py-4">
      <section className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 className="micro-label">Capacity</h3>
          <span className="text-[12px] text-fg-3">{STORAGE_LABEL[bin.storageClass] ?? bin.storageClass}{bin.status !== "active" ? ` · ${bin.status}` : ""}</span>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="num text-[15px] font-semibold text-fg-1">
            {bin.used.toLocaleString("en-IN")} <span className="text-[12.5px] font-normal text-fg-3">of {bin.capacityUnits.toLocaleString("en-IN")} packs</span>
          </span>
          <span className="num text-[12.5px] text-fg-2">{fill}% full · {bin.free.toLocaleString("en-IN")} free</span>
        </div>
        <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
          {proposed > 0 && <div className="absolute inset-y-0 left-0 rounded-full bg-[#22d3ee]/45" style={{ width: `${after}%` }} />}
          <div className={cn("absolute inset-y-0 left-0 rounded-full", fill >= 90 ? "bg-expiry" : "bg-brand")} style={{ width: `${Math.max(fill, bin.used > 0 ? 2 : 0)}%` }} />
        </div>
      </section>

      {here.length > 0 && (
        <section className="space-y-2">
          <h3 className="micro-label">Proposed here · not received</h3>
          <ul className="space-y-1.5">
            {here.map((p) => (
              <li key={p.lineId} className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-[#22d3ee]/40 bg-[#22d3ee]/5 px-3 py-2 text-[12.5px]">
                <span className="font-mono text-fg-1">{p.sku}</span>
                <span className="num text-fg-2">+{p.packs.toLocaleString("en-IN")} packs → {after}% full</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="micro-label">Stock in this bin</h3>
        {bin.products.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface-1 px-3 py-3 text-fg-2">
            <PackageOpen className="size-4 text-fg-3" strokeWidth={1.75} aria-hidden />
            This bin is empty.
          </div>
        ) : (
          <ul className="space-y-3">
            {products.map((p) => (
              <li key={p.productId} className={cn("rounded-lg border bg-surface-1", p.sku === highlightSku ? "border-brand/60 shadow-[0_0_0_1px_var(--brand)]" : "border-border")}>
                {p.sku === highlightSku && (
                  <div className="rounded-t-lg bg-brand-glow px-3 py-1 text-[11px] font-semibold text-brand">
                    Searched SKU · {p.packs} of {bin.used} packs in this bin
                  </div>
                )}
                <div className="flex items-start justify-between gap-3 px-3 pt-2.5">
                  <div className="min-w-0">
                    <div className="font-mono text-[12.5px] text-fg-1">{p.sku}</div>
                    <div className="truncate text-[12px] text-fg-2">
                      {p.brandName} {p.strength} · {p.dosageForm} · {p.packSize}/pack
                    </div>
                  </div>
                  {p.status ? (
                    <SkuStatusPill status={p.status} compact expiryRisk={p.batches.some((b) => b.atRiskQty > 0)} />
                  ) : (
                    <span className="text-[11.5px] text-fg-3">Inactive SKU</span>
                  )}
                </div>
                <div className="num px-3 pt-1 text-[12px] text-fg-3">
                  {p.packs.toLocaleString("en-IN")} packs here{p.reserved > 0 ? ` · ${p.reserved} reserved` : ""}
                  {p.cover !== null ? ` · ${p.cover.toFixed(1)} d cover (all bins)` : ""}
                </div>
                <table className="mt-2 w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-t border-border">
                      {["Batch", "Expiry", "Qty", "Rsvd"].map((h, i) => (
                        <th key={h} scope="col" className={cn("micro-label h-7 px-2.5 font-medium first:pl-3 last:pr-3", i === 0 ? "text-left" : "text-right")}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.batches.map((b) => {
                      const left = daysBetween(asOf, b.expiryDate);
                      const bad = b.qualityStatus !== "released" || left <= 0;
                      return (
                        <tr key={b.batchId} className="border-t border-border align-top">
                          <td className="py-1.5 pr-2.5 pl-3">
                            <div className="font-mono text-fg-1">{b.batchNumber}</div>
                            <div className="mt-0.5 text-[11px] whitespace-nowrap text-fg-3">
                              <span className={bad ? "text-stockout" : undefined}>{left <= 0 ? "Expired" : QUALITY[b.qualityStatus] ?? b.qualityStatus}</span>
                              {b.atRiskQty > 0 && <span className="text-expiry"> · {b.atRiskQty} at risk</span>}
                              <span title={SOURCE[b.dataSource]?.[1] ?? b.dataSource}> · {SOURCE[b.dataSource]?.[0] ?? b.dataSource}</span>
                            </div>
                          </td>
                          <td className="num px-2.5 py-1.5 text-right whitespace-nowrap">
                            <div className="text-fg-2">{formatDisplayDate(b.expiryDate)}</div>
                            <div className={cn("text-[11px]", left <= 90 ? "text-expiry" : "text-fg-3")}>{left <= 0 ? "expired" : `${left} d left`}</div>
                          </td>
                          <td className="num px-2.5 py-1.5 text-right text-fg-1">{b.onHand}</td>
                          <td className="num py-1.5 pr-3 pl-2.5 text-right text-fg-3">{b.reserved || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <RecommendedAction product={p} asOf={asOf} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type BinProduct = BinDetails["products"][number];

/**
 * What to do with this SKU in this bin, from the engine status and the batches shown above. Fixed rules, no AI:
 * quality holds first, then stock that will expire unsold, then the SKU's status.
 */
function recommendation(p: BinProduct, asOf: string): { tone: "stockout" | "expiry" | "excess" | "neutral"; title: string; text: string } | null {
  const held = p.batches.find((b) => b.qualityStatus !== "released");
  if (held) return { tone: "stockout", title: "Do not dispatch", text: `Batch ${held.batchNumber} is ${held.qualityStatus}. Keep it segregated and send it to QA; it does not count as stock.` };
  const expired = p.batches.find((b) => daysBetween(asOf, b.expiryDate) <= 0);
  if (expired) return { tone: "stockout", title: "Remove expired stock", text: `Batch ${expired.batchNumber} has expired. Move it to the returns / destruction area.` };
  const atRisk = p.batches.filter((b) => b.atRiskQty > 0).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0];
  if (atRisk) {
    const days = daysBetween(asOf, atRisk.expiryDate);
    return {
      tone: "expiry",
      title: "Dispatch first (FEFO)",
      text: `${atRisk.atRiskQty} packs of ${atRisk.batchNumber} will not sell before expiry in ${days} d at current demand. Pick this batch first, offer it to high-demand customers, or raise a return with the supplier while it is still in date.`,
    };
  }
  if (p.status === "STOCKOUT_RISK")
    return {
      tone: "stockout",
      title: "Reorder now",
      text: `About ${p.cover?.toFixed(1) ?? "0"} d of cover across all bins, shorter than the fastest delivery. Approve this SKU's line in the purchase plan today.`,
    };
  if (p.status === "BELOW_ROP") return { tone: "neutral", title: "Reorder soon", text: "Stock is below the reorder point. Check it is in the latest purchase plan and approve it with the next PO." };
  if (p.status === "EXCESS") return { tone: "excess", title: "Hold new orders", text: "Stock is well above target. Skip reorders until it sells down, and keep picking oldest expiry first." };
  return null;
}

const ACTION_STYLE = {
  stockout: "border-stockout/30 bg-stockout-bg text-stockout",
  expiry: "border-expiry/30 bg-expiry-bg text-expiry",
  excess: "border-excess/30 bg-excess-bg text-excess",
  neutral: "border-border bg-surface-2 text-fg-2",
} as const;

function RecommendedAction({ product, asOf }: { product: BinProduct; asOf: string }) {
  const r = recommendation(product, asOf);
  if (!r) return null;
  return (
    <div className={cn("mx-3 mb-3 rounded-lg border px-3 py-2.5", ACTION_STYLE[r.tone])}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold">
        <CircleAlert className="size-3.5" strokeWidth={2} aria-hidden />
        Recommended action · {r.title}
      </div>
      <p className="mt-1 text-[12px] leading-[17px] text-fg-2">{r.text}</p>
    </div>
  );
}
