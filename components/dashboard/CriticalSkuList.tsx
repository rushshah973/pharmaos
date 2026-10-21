import Link from "next/link";
import { CircleCheck, MapPin, ArrowUpRight } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { SkuStatusPill } from "@/components/layout/SkuStatusPill";
import { dec, formatINR } from "@/lib/money";
import type { CriticalSku } from "@/lib/services/dashboard";

const CRITICALITY: Record<CriticalSku["criticality"], string | null> = {
  life_saving: "Life-saving",
  chronic: "Chronic",
  acute: null,
  otc: null,
};

const cover = (c: number | null) => (c === null ? "—" : `${c.toFixed(1)} d`);

/** Top critical SKUs (§10.3): what will run out first, with links to its plan line and its bin. */
export function CriticalSkuList({ skus, latestPlanId, totalAtRisk }: { skus: CriticalSku[]; latestPlanId: string | null; totalAtRisk: number }) {
  if (skus.length === 0) {
    return <EmptyState icon={CircleCheck} title="No critical SKUs" description="Every SKU has enough stock to cover demand until its next delivery." />;
  }
  return (
    <section className="surface overflow-hidden">
      <header className="flex items-end justify-between gap-4 px-5 pt-5 pb-4">
        <div>
          <h2 className="text-[15px] leading-[22px] font-semibold text-fg-1">Critical SKUs</h2>
          <p className="text-fg-2">
            Lowest cover first · {totalAtRisk} at stockout risk, showing the top {skus.length}
          </p>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-y border-border bg-surface-2">
              {["SKU", "Status", "Cover", "Lead", "Expiry risk", ""].map((h, i) => (
                <th key={h || i} className={`micro-label h-9 px-4 first:pl-5 last:pr-5 font-medium ${i >= 2 && i <= 4 ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => {
              const tag = CRITICALITY[s.criticality];
              const atRisk = dec(s.atRiskValue).greaterThan(0);
              return (
                <tr key={s.productId} className="group h-14 border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-3">
                  <td className="py-2 pr-4 pl-5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] text-fg-1">{s.sku}</span>
                      {tag && <span className="rounded border border-border-strong px-1.5 text-[10.5px] leading-4 font-medium text-fg-2">{tag}</span>}
                    </div>
                    <div className="max-w-[196px] truncate text-[12.5px] text-fg-2 xl:max-w-[300px]">
                      {s.brandName} · {s.strength} · {s.packSize}/pack
                    </div>
                  </td>
                  <td className="px-4">
                    <SkuStatusPill status={s.status} expiryRisk={atRisk} />
                  </td>
                  <td className={`num px-4 text-right ${s.cover !== null && s.cover < s.leadTimeDays ? "text-stockout" : "text-fg-1"}`}>{cover(s.cover)}</td>
                  <td className="num px-4 text-right text-fg-1">{s.leadTimeDays} d</td>
                  <td className="num px-4 text-right text-fg-1">{atRisk ? formatINR(s.atRiskValue) : <span className="text-fg-3">—</span>}</td>
                  <td className="pr-3 pl-2 text-right">
                    <div className="flex items-center justify-end gap-0.5 opacity-60 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
                      {latestPlanId && s.planLineId ? (
                        <Link
                          href={`/procurement/${latestPlanId}?line=${s.planLineId}`}
                          title="Open in plan"
                          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-brand hover:bg-brand-glow"
                        >
                          <span className="max-xl:sr-only">Open in plan</span> <ArrowUpRight className="size-3.5" aria-hidden />
                        </Link>
                      ) : (
                        <span className="px-2 text-[12.5px] text-fg-3 max-xl:sr-only">Not in a plan</span>
                      )}
                      <Link
                        href={`/warehouse?sku=${encodeURIComponent(s.sku)}`}
                        title="Locate in warehouse"
                        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-fg-2 hover:bg-surface-2 hover:text-fg-1"
                      >
                        <MapPin className="size-3.5" aria-hidden /> <span className="max-xl:sr-only">Locate</span>
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CriticalSkuListSkeleton() {
  return (
    <section className="surface overflow-hidden" aria-hidden>
      <div className="space-y-2 px-5 pt-5 pb-4">
        <span className="shimmer block h-5 w-32 rounded" />
        <span className="shimmer block h-4 w-64 rounded" />
      </div>
      <div className="h-9 border-y border-border bg-surface-2" />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex h-14 items-center gap-6 border-b border-border px-5 last:border-b-0">
          <span className="shimmer h-8 w-56 rounded" />
          <span className="shimmer h-[22px] w-28 rounded-full" />
          <span className="ml-auto shimmer h-4 w-16 rounded" />
          <span className="shimmer h-4 w-12 rounded" />
          <span className="shimmer h-4 w-20 rounded" />
        </div>
      ))}
    </section>
  );
}
