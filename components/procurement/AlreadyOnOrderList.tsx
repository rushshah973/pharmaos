import Link from "next/link";
import { PoStatusPill } from "@/components/purchase-orders/PoStatusPill";
import { formatDisplayDate } from "@/lib/format/date";
import type { LineView, OnOrderItem } from "@/lib/services/plans";

/**
 * SKUs already on a PharmaOS PO from another plan (ready, awaiting the Owner, approved or sent). The engine counts
 * that stock as incoming, so this plan does not order it again; a SKU still in the plan is only a top-up.
 */
export function AlreadyOnOrderList({ items, lines }: { items: OnOrderItem[]; lines: LineView[] }) {
  if (items.length === 0) return null;
  const inPlan = new Map(lines.filter((l) => l.counted).map((l) => [l.productId, l]));
  const bySku = new Map<string, OnOrderItem[]>();
  for (const i of items) bySku.set(i.productId, [...(bySku.get(i.productId) ?? []), i]);
  const groups = [...bySku.values()];
  const topUps = groups.filter((g) => inPlan.has(g[0].productId)).length;

  return (
    <section className="surface overflow-hidden" aria-label="Already on order">
      <header className="px-5 pt-5 pb-4">
        <h2 className="text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">Already on order</h2>
        <p className="text-fg-2">
          {groups.length} SKU{groups.length === 1 ? " is" : "s are"} on purchase orders from earlier plans. That stock counts as incoming, so this plan
          does not order it again{topUps ? `; ${topUps} still need${topUps === 1 ? "s" : ""} a top-up and ${topUps === 1 ? "is" : "are"} in the plan above` : ""}.
        </p>
      </header>
      <ul className="border-t border-border">
        {groups.map((g) => {
          const first = g[0];
          const line = inPlan.get(first.productId);
          const total = g.reduce((n, i) => n + i.qty, 0);
          return (
            <li key={first.productId} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-2.5 last:border-b-0">
              <div className="w-[180px] shrink-0 xl:w-[230px]">
                <div className="font-mono text-[12.5px] text-fg-1">{first.sku}</div>
                <div className="truncate text-[12.5px] text-fg-2">
                  {first.brandName} · {first.strength}
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                {g.map((i) => (
                  <div key={i.poId} className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
                    <Link href={`/purchase-orders/${i.poId}`} className="font-mono text-fg-1 hover:text-brand hover:underline">
                      {i.poNumber}
                    </Link>
                    <PoStatusPill status={i.poStatus} />
                    <span className="truncate">
                      {i.qty.toLocaleString("en-IN")} packs · {i.supplierName}
                      {i.expectedDeliveryDate ? ` · expected ${formatDisplayDate(i.expectedDeliveryDate)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <div className="w-[160px] shrink-0 text-right text-[12.5px] xl:w-[190px]">
                <div className="num text-fg-1">{total.toLocaleString("en-IN")} packs on order</div>
                <div className="text-fg-3">{line ? `Top-up of ${line.qty.toLocaleString("en-IN")} in this plan` : "Not ordered again"}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
