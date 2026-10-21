"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SalesPoint } from "@/lib/business-logic/types";
import { formatDisplayDate } from "@/lib/format/date";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

const REFS = [
  { key: "dbar", label: "d̄ (used)", stroke: "var(--text-1)", dash: "2 3" },
  { key: "d7", label: "d7", stroke: "var(--text-2)", dash: "5 4" },
  { key: "d28", label: "d28", stroke: "var(--text-3)", dash: "5 4" },
] as const;

/**
 * Last 28 days of packs sold (§10.1 Charts): one teal series with a fading area, faint horizontal grid,
 * dashed reference lines for d7, d28 and d̄, labelled directly; crosshair tooltip on hover.
 */
export function DemandChart({ series, d7, d28, dbar }: { series: SalesPoint[]; d7: number; d28: number; dbar: number }) {
  const max = Math.max(1, ...series.map((s) => s.units), d7, d28, dbar);
  return (
    <figure className="m-0">
      <div className="h-[168px] w-full" role="img" aria-label={`Daily packs sold over 28 days; d̄ ${fmt(dbar)}, d7 ${fmt(d7)}, d28 ${fmt(d28)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="demand-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={short}
              interval={6}
              tick={{ fill: "var(--text-3)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickMargin={6}
            />
            <YAxis
              domain={[0, Math.ceil(max * 1.15)]}
              allowDecimals={false}
              tick={{ fill: "var(--text-3)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            {REFS.map((r) => (
              <ReferenceLine key={r.key} y={{ d7, d28, dbar }[r.key]} stroke={r.stroke} strokeDasharray={r.dash} strokeWidth={r.key === "dbar" ? 1.5 : 1} />
            ))}
            <Tooltip
              cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 text-[12px] shadow-(--shadow-pop)">
                    <div className="text-fg-3">{formatDisplayDate(String(payload[0].payload.date))}</div>
                    <div className="num font-medium text-fg-1">{payload[0].value} packs sold</div>
                  </div>
                ) : null
              }
            />
            <Area type="linear" dataKey="units" stroke="var(--brand)" strokeWidth={2} fill="url(#demand-fill)" dot={false} activeDot={{ r: 4, stroke: "var(--surface-2)", strokeWidth: 2, fill: "var(--brand)" }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* Key for the reference lines (labels on the lines collide when the averages are close). */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 pb-1 text-[11.5px] text-fg-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-brand" aria-hidden /> Packs sold / day
        </span>
        {REFS.map((r) => (
          <span key={r.key} className="inline-flex items-center gap-1.5">
            <svg width="16" height="2" aria-hidden>
              <line x1="0" y1="1" x2="16" y2="1" stroke={r.stroke} strokeWidth={r.key === "dbar" ? 1.5 : 1} strokeDasharray={r.dash} />
            </svg>
            {r.label} <span className="num text-fg-1">{fmt({ d7, d28, dbar }[r.key])}</span>
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        Daily sales: {series.map((s) => `${s.date} ${s.units}`).join(", ")}
      </figcaption>
    </figure>
  );
}
