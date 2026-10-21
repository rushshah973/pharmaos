"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/money";

const DURATION_MS = 600;

function format(n: number, kind: "inr" | "int") {
  return kind === "inr" ? formatINR(Math.round(n), { paise: false }) : Math.round(n).toLocaleString("en-IN");
}

/** Counts up once to `value` on first load (≤ 600 ms, ease-out); static when reduced motion is on (§10.1). */
export function CountUp({ value, kind = "int" }: { value: number; kind?: "inr" | "int" }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / DURATION_MS);
      setShown(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // Animation frames pause in background tabs; always land on the real value.
    const done = setTimeout(() => setShown(value), DURATION_MS + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
  }, [value]);
  return <span className="num">{format(shown, kind)}</span>;
}
