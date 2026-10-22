"use client";

import { useMemo, useRef, useState } from "react";
import { formatDisplayDate } from "@/lib/format/date";
import type { DemandPoint } from "@/lib/services/dashboard";

const W = 720;
const H = 220;
const PAD = { top: 12, right: 44, bottom: 26, left: 4 };

/**
 * Packs sold per day (thin white line) and the engine's demand for the next 14 days (dashed copper, with a soft
 * fill), on one axis. Hover anywhere for that day's value. A single measure, so no legend: the labels say it.
 */
export function DemandChart({ points }: { points: DemandPoint[] }) {
  if (points.length < 2) {
    return <p className="flex h-[180px] items-center justify-center text-[12.5px] text-fg-3">No sales history yet: the chart appears once there are daily sales.</p>;
  }
  return <Chart points={points} />;
}

function Chart({ points }: { points: DemandPoint[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const values = points.flatMap((p) => [p.actual, p.forecast]).filter((v): v is number => v !== null);
    const max = Math.max(1, ...values);
    const top = niceCeil(max * 1.04);
    const x = (i: number) => PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
    const y = (v: number) => PAD.top + (1 - v / top) * (H - PAD.top - PAD.bottom);
    const path = (key: "actual" | "forecast") =>
      points
        .map((p, i) => (p[key] === null ? null : `${x(i).toFixed(1)},${y(p[key]!).toFixed(1)}`))
        .reduce<string[]>((acc, pt) => {
          if (pt) acc.push(`${acc.length === 0 || acc[acc.length - 1] === "|" ? "M" : "L"}${pt}`);
          else if (acc.length && acc[acc.length - 1] !== "|") acc.push("|");
          return acc;
        }, [])
        .filter((s) => s !== "|")
        .join(" ");
    const todayIdx = points.findIndex((p) => p.actual !== null && p.forecast !== null);
    const lastIdx = points.length - 1;
    const forecastArea = todayIdx >= 0 ? `${path("forecast")} L${x(lastIdx)},${y(0)} L${x(todayIdx)},${y(0)} Z` : "";
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ v: Math.round(top * f), y: y(top * f) }));
    const xLabels = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.round(f * lastIdx));
    return { x, y, actual: path("actual"), forecast: path("forecast"), forecastArea, ticks, todayIdx, xLabels };
  }, [points]);

  function onMove(e: React.PointerEvent) {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const sx = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((sx - PAD.left) / (W - PAD.left - PAD.right)) * (points.length - 1));
    setHover(Math.min(points.length - 1, Math.max(0, i)));
  }

  const hp = hover === null ? null : points[hover];
  const hv = hp ? (hp.actual ?? hp.forecast) : null;

  return (
    <div ref={box} className="relative select-none" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label="Packs sold per day, then forecast demand for the next 14 days">
        <defs>
          <linearGradient id="dc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="dc-actual" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        {geo.ticks.map((t) => (
          <g key={t.v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.07)" strokeDasharray="3 5" />
            <text x={W - PAD.right + 8} y={t.y + 3.5} fill="var(--text-3)" fontSize="10.5">
              {t.v.toLocaleString("en-IN")}
            </text>
          </g>
        ))}
        {geo.todayIdx >= 0 && (
          <>
            <rect x={geo.x(geo.todayIdx)} y={PAD.top} width={geo.x(points.length - 1) - geo.x(geo.todayIdx)} height={H - PAD.top - PAD.bottom} fill="rgba(255,255,255,0.025)" />
            <line x1={geo.x(geo.todayIdx)} x2={geo.x(geo.todayIdx)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.25)" strokeDasharray="2 4" />
            <text x={geo.x(geo.todayIdx) + 6} y={PAD.top + 10} fill="var(--text-2)" fontSize="10.5">
              Today
            </text>
            <text x={geo.x(points.length - 1) - 4} y={PAD.top + 10} fill="var(--brand)" fontSize="10.5" textAnchor="end">
              Forecast
            </text>
          </>
        )}
        <path d={geo.forecastArea} fill="url(#dc-fill)" />
        <path d={geo.actual} fill="none" stroke="url(#dc-actual)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <path d={geo.forecast} fill="none" stroke="var(--brand)" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
        {geo.xLabels.map((i) => (
          <text key={i} x={geo.x(i)} y={H - 6} fill="var(--text-3)" fontSize="10.5" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>
            {shortDate(points[i].date)}
          </text>
        ))}
        {hover !== null && hv !== null && (
          <g>
            <line x1={geo.x(hover)} x2={geo.x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="rgba(255,255,255,0.35)" />
            <circle cx={geo.x(hover)} cy={geo.y(hv)} r="4.5" fill={hp?.actual !== null ? "#fff" : "var(--brand)"} stroke="var(--bg)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover !== null && hp && hv !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-white/10 bg-[rgba(20,20,24,0.85)] px-3 py-2 text-[12px] whitespace-nowrap shadow-(--shadow-pop) backdrop-blur-xl"
          style={{ left: `${(geo.x(hover) / W) * 100}%` }}
        >
          <div className="text-fg-3">{formatDisplayDate(hp.date)}</div>
          <div className="num text-[14px] text-fg-1">
            {hv.toLocaleString("en-IN")} <span className="text-fg-3">packs · {hp.actual !== null ? "sold" : "forecast"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function niceCeil(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => n <= s) ?? 10;
  return step * p;
}

function shortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "UTC" });
}
