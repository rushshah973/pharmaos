"use client";

import { cn } from "cn";
import type { HeatmapMode, Severity } from "@/lib/business-logic/heatmap";
import { MODES, type ModeMeta, severityStyle } from "./modes";

/** Colour + text for every severity step of the current mode, plus the selection and search markers. */
export function Legend({ mode, counts }: { mode: ModeMeta; counts: number[] }) {
  return (
    <div className="space-y-2" aria-label={`${mode.label} legend`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-fg-2">
        {([0, 1, 2, 3] as Severity[]).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              className="size-3 rounded-[3px] border border-border bg-surface-2"
              style={severityStyle(mode.tone, s)}
              aria-hidden
            />
            {mode.steps[s]}
            <span className="num text-fg-3">{counts[s] ?? 0}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11.5px] text-fg-3">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-3 rounded-[3px] border border-border bg-[repeating-linear-gradient(135deg,transparent_0_2px,var(--surface-3)_2px_3px)]"
            aria-hidden
          />
          Inactive
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-3 rounded-[3px] shadow-[0_0_0_2px_var(--brand)]"
            aria-hidden
          />
          Search match
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="size-3 rounded-[3px] shadow-[0_0_0_2px_var(--text-1)]"
            aria-hidden
          />
          Selected
        </span>
        <span>Hover a bin for its code</span>
      </div>
    </div>
  );
}

/** Segmented mode picker. Proposed Replenishment needs an open plan. */
export function ModeSelect({
  value,
  onChange,
  proposedAvailable,
}: {
  value: HeatmapMode;
  onChange: (mode: HeatmapMode) => void;
  proposedAvailable: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Heatmap mode"
      className="flex flex-wrap gap-1.5"
    >
      {MODES.map((m) => {
        const disabled = m.id === "proposed" && !proposedAvailable;
        const active = m.id === value;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            title={
              disabled
                ? "Create a purchase plan first: proposed stock comes from its lines"
                : undefined
            }
            onClick={() => onChange(m.id)}
            className={cn(
              "inline-flex h-8 items-center gap-2 rounded-full border px-3 text-[12.5px] font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-brand",
              active
                ? "border-brand/40 bg-brand-glow text-fg-1"
                : "border-border bg-surface-1 text-fg-2 hover:bg-white/[0.04] hover:text-fg-1",
              disabled &&
                "cursor-not-allowed opacity-45 hover:bg-surface-1 hover:text-fg-2",
            )}
          >
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: m.tone }}
              aria-hidden
            />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
