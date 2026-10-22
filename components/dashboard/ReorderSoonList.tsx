import Link from "next/link";
import { CalendarClock, MapPin } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { formatDisplayDate } from "@/lib/format/date";
import type { ReorderSoon } from "@/lib/services/dashboard";

const n1 = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const when = (days: number) => (days < 1 ? "Order today" : days < 2 ? "Order tomorrow" : `in ${Math.floor(days)} days`);

/**
 * The forward-looking list: SKUs that are fine today but reach their reorder point within 7 days at forecast
 * demand. Order-by date = as-of + days until stock falls to ROP (d̄ × fastest lead time + safety stock).
 */
export function ReorderSoonList({ items, total }: { items: ReorderSoon[]; total: number }) {
  if (items.length === 0) {
    return <EmptyState icon={CalendarClock} title="Nothing to reorder this week" description="No SKU reaches its reorder point in the next 7 days at forecast demand." />;
  }
  return (
    <section className="surface overflow-hidden" aria-label="Reorder in the next 7 days">
      <header className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 pb-4">
        <div>
          <h2 className="text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">Reorder in the next 7 days</h2>
          <p className="text-fg-2">
            Not urgent yet: these reach their reorder point soon at forecast demand · {total} SKU{total === 1 ? "" : "s"}, showing the soonest {items.length}
          </p>
        </div>
        <p className="text-[12px] text-fg-3">Order-by = when stock falls to the reorder point (demand × fastest lead time + safety)</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-collapse whitespace-nowrap">
          <thead>
            <tr className="border-y border-white/[0.06] bg-white/[0.025]">
              {["SKU", "Order by", "Stock", "Demand / day", "Lead", ""].map((h, i) => (
                <th key={h || i} className={`micro-label h-9 px-4 font-medium first:pl-5 last:pr-5 ${i >= 2 && i <= 4 ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.productId} className="group h-14 border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-white/[0.04]">
                <td className="py-2 pr-4 pl-5">
                  <div className="font-mono text-[12.5px] text-fg-1">{s.sku}</div>
                  <div className="max-w-[220px] truncate text-[12.5px] text-fg-2 xl:max-w-[300px]">
                    {s.brandName} · {s.strength} · {s.packSize}/pack
                  </div>
                </td>
                <td className="px-4">
                  <div className="font-medium text-fg-1">{formatDisplayDate(s.orderBy)}</div>
                  <div className={`text-[12px] ${s.reorderInDays < 1 ? "font-medium text-expiry" : "text-fg-3"}`}>{when(s.reorderInDays)}</div>
                </td>
                <td className="num px-4 text-right text-fg-1">{n1(s.stockPosition)}</td>
                <td className="num px-4 text-right text-fg-1">
                  {s.avgDailyDemand.toFixed(1)}
                  <span className={`ml-1.5 rounded px-1 text-[10.5px] font-semibold ${s.method === "ml" ? "bg-brand-glow text-brand" : "bg-neutral-bg text-neutral"}`}>
                    {s.method === "ml" ? "ML" : "avg"}
                  </span>
                </td>
                <td className="num px-4 text-right text-fg-2">{s.leadTimeDays} d</td>
                <td className="pr-5 pl-2 text-right">
                  <Link
                    href={`/warehouse?sku=${encodeURIComponent(s.sku)}`}
                    title="Locate in warehouse"
                    className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-fg-2 opacity-70 transition-opacity group-hover:opacity-100 hover:bg-surface-2 hover:text-fg-1"
                  >
                    <MapPin className="size-3.5" aria-hidden /> <span className="max-xl:sr-only">Locate</span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
