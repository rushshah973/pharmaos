"use client";

// 2D rack elevation (§11): aisle → side → rack → shelf, one cell per bin, tinted by the mode's severity.
// Shelf 4 is drawn on top, as on the real rack. Hover shows the bin code and the heat label; click selects.
import { cn } from "cn";
import type { BinHeat } from "@/lib/business-logic/heatmap";
import type { LayoutBin } from "@/lib/services/warehouse";
import { type ModeMeta, STORAGE_LABEL, severityStyle } from "./modes";

const RACKS = [1, 2, 3, 4, 5, 6];
const SHELVES = [4, 3, 2, 1];

export function Grid2D({
  bins,
  heat,
  mode,
  selectedBinId,
  matchBinIds,
  onSelect,
}: {
  bins: LayoutBin[];
  heat: Map<string, BinHeat>;
  mode: ModeMeta;
  selectedBinId: string | null;
  matchBinIds: Set<string>;
  onSelect: (binId: string) => void;
}) {
  const at = new Map(bins.map((b) => [`${b.aisle}-${b.side}-${b.rackNumber}-${b.shelf}`, b]));
  const aisles = [...new Set(bins.map((b) => b.aisle))].sort();

  return (
    <div className="space-y-5" role="grid" aria-label={`Warehouse bins coloured by ${mode.label}`}>
      {aisles.map((aisle) => {
        const inAisle = bins.filter((b) => b.aisle === aisle);
        const classes = [...new Set(inAisle.map((b) => b.storageClass))];
        const hot = inAisle.filter((b) => (heat.get(b.id)?.severity ?? 0) > 0).length;
        return (
          <section key={aisle} aria-label={`Aisle ${aisle}`}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div className="flex items-baseline gap-2.5">
                <h3 className="text-[13.5px] font-semibold text-fg-1">Aisle {aisle}</h3>
                <span className="text-[12px] text-fg-3">{classes.map((c) => STORAGE_LABEL[c] ?? c).join(" · ")}</span>
              </div>
              <span className="num text-[12px] text-fg-3">{hot > 0 ? `${hot} of ${inAisle.length} highlighted` : `${inAisle.length} bins`}</span>
            </div>
            <div className="flex gap-3">
              <ShelfAxis />
              {(["L", "R"] as const).map((side, i) => (
                <div key={side} className={cn("min-w-0 flex-1", i === 1 && "border-l border-dashed border-border pl-3")}>
                  <div className="grid grid-cols-6 gap-1" role="row">
                    {SHELVES.flatMap((shelf) =>
                      RACKS.map((rack) => {
                        const bin = at.get(`${aisle}-${side}-${rack}-${shelf}`);
                        if (!bin) return <div key={`${rack}-${shelf}`} className="h-7" aria-hidden />;
                        return (
                          <Cell
                            key={bin.id}
                            bin={bin}
                            heat={heat.get(bin.id)}
                            mode={mode}
                            selected={bin.id === selectedBinId}
                            match={matchBinIds.has(bin.id)}
                            onSelect={onSelect}
                          />
                        );
                      }),
                    )}
                  </div>
                  <div className="mt-1 grid grid-cols-6 gap-1 text-center text-[10.5px] text-fg-3" aria-hidden>
                    {RACKS.map((r) => (
                      <span key={r}>
                        {side}
                        {String(r).padStart(2, "0")}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ShelfAxis() {
  return (
    <div className="grid w-4 shrink-0 grid-rows-4 gap-1 pb-5 text-right text-[10.5px] leading-7 text-fg-3" aria-hidden>
      {SHELVES.map((s) => (
        <span key={s}>{s}</span>
      ))}
    </div>
  );
}

function Cell({
  bin,
  heat,
  mode,
  selected,
  match,
  onSelect,
}: {
  bin: LayoutBin;
  heat: BinHeat | undefined;
  mode: ModeMeta;
  selected: boolean;
  match: boolean;
  onSelect: (binId: string) => void;
}) {
  const severity = heat?.severity ?? 0;
  const inactive = bin.status !== "active";
  const label = heat?.label ?? "";
  return (
    <button
      type="button"
      role="gridcell"
      aria-selected={selected}
      aria-label={`${bin.binCode}: ${label}${match ? " · search match" : ""}`}
      onClick={() => onSelect(bin.id)}
      style={inactive ? undefined : severityStyle(mode.tone, severity)}
      className={cn(
        "group relative h-7 min-w-0 rounded-[5px] border border-border bg-surface-2 transition-[box-shadow,transform] duration-150 ease-out outline-none",
        "hover:z-10 hover:shadow-[0_0_0_1px_var(--border-strong)] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-brand",
        mode.id === "proposed" && severity > 0 && "border-dashed",
        inactive && "bg-[repeating-linear-gradient(135deg,transparent_0_4px,var(--surface-3)_4px_5px)] opacity-70",
        match && "shadow-[0_0_0_2px_var(--brand)] hover:shadow-[0_0_0_2px_var(--brand)]",
        selected && "z-10 shadow-[0_0_0_2px_var(--text-1)] hover:shadow-[0_0_0_2px_var(--text-1)]",
      )}
    >
      {severity > 0 && heat?.value != null && (
        <span className={cn("num block truncate px-1 text-[10.5px] leading-none font-medium", severity === 3 ? "text-[#0b1220]" : "text-fg-1")}>
          {mode.short(heat.value)}
        </span>
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-20 hidden w-max max-w-[240px] -translate-x-1/2 rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 text-left shadow-[var(--shadow-pop)] group-hover:block group-focus-visible:block"
      >
        <span className="block font-mono text-[12px] text-fg-1">{bin.binCode}</span>
        <span className="block text-[11.5px] leading-4 text-fg-2">{inactive ? "Inactive bin" : label}</span>
        {heat && heat.skus.length > 0 && <span className="block font-mono text-[11px] leading-4 text-fg-3">{heat.skus.slice(0, 3).join(" · ")}{heat.skus.length > 3 ? ` +${heat.skus.length - 3}` : ""}</span>}
      </span>
    </button>
  );
}
