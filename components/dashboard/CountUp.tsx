"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { formatINR } from "@/lib/money";

const DURATION_MS = 600;

function format(n: number, kind: "inr" | "int" | "inr-paise") {
  if (kind === "inr") return formatINR(Math.round(n), { paise: false });
  if (kind === "inr-paise") return formatINR(n.toFixed(2));
  return Math.round(n).toLocaleString("en-IN");
}

/**
 * Counts up once on first load (≤ 600 ms, ease-out). When the value changes later (an edit, a recalculation)
 * it moves from the old value to the new one and flashes once, so the eye sees what changed (§10.1 Motion).
 * Static when reduced motion is on.
 */
export function CountUp({ value, kind = "int", dimDecimals = false }: { value: number; kind?: "inr" | "int" | "inr-paise"; dimDecimals?: boolean }) {
  // `frame` is the in-between value while animating; null shows `value` itself.
  const [frame, setFrame] = useState<number | null>(null);
  const [flash, setFlash] = useState(0);
  const from = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    const changed = !first.current;
    first.current = false;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / DURATION_MS);
      setFrame(p < 1 ? start + (value - start) * (1 - Math.pow(1 - p, 3)) : null);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame((t) => {
      if (changed) setFlash((n) => n + 1);
      tick(t);
    });
    // Animation frames pause in background tabs; always land on the real value.
    const done = setTimeout(() => setFrame(null), DURATION_MS + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [value]);

  const text = format(frame ?? value, kind);
  const dot = dimDecimals ? text.lastIndexOf(".") : -1;
  return (
    <span key={flash} className={cn("num rounded-sm", flash > 0 && "flash-change")}>
      {dot < 0 ? (
        text
      ) : (
        <>
          {text.slice(0, dot)}
          <span className="dim">{text.slice(dot)}</span>
        </>
      )}
    </span>
  );
}
