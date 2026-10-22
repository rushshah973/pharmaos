"use client";

// Table view of the heatmap (accessibility alternative to the grid): highlighted bins first.
import { cn } from "cn";
import type { BinHeat } from "@/lib/business-logic/heatmap";
import { describeBin } from "@/lib/warehouse/geometry";
import type { LayoutBin } from "@/lib/services/warehouse";
import { type ModeMeta, STORAGE_LABEL } from "./modes";

export function BinTable({
  bins,
  heat,
  mode,
  selectedBinId,
  matchBinIds,
  skusByBin,
  onSelect,
}: {
  bins: LayoutBin[];
  heat: Map<string, BinHeat>;
  mode: ModeMeta;
  selectedBinId: string | null;
  matchBinIds: Set<string>;
  /** Every SKU in each bin (the heat label lists only the SKUs behind the highlight). */
  skusByBin: Map<string, string[]>;
  onSelect: (binId: string) => void;
}) {
  const rows = [...bins].sort(
    (a, b) =>
      Number(matchBinIds.has(b.id)) - Number(matchBinIds.has(a.id)) ||
      (heat.get(b.id)?.severity ?? 0) - (heat.get(a.id)?.severity ?? 0) ||
      a.binCode.localeCompare(b.binCode),
  );
  return (
    <div className="max-h-[720px] overflow-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">Bins by {mode.label}, highlighted first</caption>
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            {["Bin", "Storage", "Fill", mode.label, "SKUs"].map((h, i) => (
              <th key={h} scope="col" className={cn("micro-label h-9 px-3 font-medium whitespace-nowrap", i === 2 ? "text-right" : "text-left")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const h = heat.get(b.id);
            const fill = Math.round((b.used / b.capacityUnits) * 100);
            const selected = b.id === selectedBinId;
            const skus = skusByBin.get(b.id) ?? [];
            return (
              <tr
                key={b.id}
                onClick={() => onSelect(b.id)}
                aria-selected={selected}
                className={cn(
                  "h-11 cursor-pointer border-t border-border transition-colors hover:bg-white/[0.04]",
                  selected && "bg-brand-glow shadow-[inset_2px_0_0_var(--brand)]",
                )}
              >
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <button type="button" className="rounded font-mono text-[12.5px] text-fg-1 focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" onClick={() => onSelect(b.id)}>
                    {b.binCode}
                  </button>
                  {matchBinIds.has(b.id) && <span className="ml-2 text-[11px] text-brand">match</span>}
                  <div className="text-[11.5px] text-fg-3">{describeBin(b.binCode)}</div>
                </td>
                <td className="px-3 whitespace-nowrap text-fg-2">{STORAGE_LABEL[b.storageClass] ?? b.storageClass}</td>
                <td className="num px-3 text-right text-fg-1">{fill}%</td>
                <td className="min-w-[200px] px-3 py-1.5">
                  <span className="inline-flex items-start gap-1.5 text-fg-1">
                    {h && h.severity > 0 && <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ backgroundColor: mode.tone }} aria-hidden />}
                    <span className={h && h.severity > 0 ? "text-fg-1" : "text-fg-3"}>{b.status !== "active" ? "Inactive" : h?.label}</span>
                  </span>
                </td>
                <td className="px-3 font-mono text-[12px] whitespace-nowrap text-fg-2">
                  {skus.length === 0 ? <span className="text-fg-3">Empty</span> : skus[0]}
                  {skus.length > 1 ? <span className="text-fg-3"> +{skus.length - 1}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
