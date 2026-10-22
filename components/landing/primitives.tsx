"use client";

import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";

// Small building blocks for the landing page: scroll reveals, a count-up that starts in view, and section headings.

export const EASE = [0.22, 1, 0.36, 1] as const;

/** Fades and lifts its children into place the first time they scroll into view. */
export function Reveal({ children, delay = 0, y = 24, className }: { children: React.ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** A headline whose words rise into place one after another. */
export function WordsRise({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  const words = text.split(" ");
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={`${w}-${i}`}>
          <span className="inline-block overflow-hidden pb-[0.08em] align-bottom">
            <motion.span className="inline-block" initial={{ y: "110%" }} animate={{ y: 0 }} transition={{ duration: 0.8, delay: delay + i * 0.06, ease: EASE }}>
              {w}
            </motion.span>
          </span>
          {/* The space sits between the clipped words: inside an inline-block a trailing space is dropped. */}
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  );
}

/** Counts from 0 to `to` once it is in view (or shows the value at once with reduced motion). */
export function InViewCount({ to, decimals = 0, prefix = "", suffix = "", className }: { to: number; decimals?: number; prefix?: string; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduce = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return;
    const c = animate(0, to, { duration: 1.4, ease: EASE, onUpdate: setN });
    return () => c.stop();
  }, [inView, reduce, to]);
  const text = (reduce ? to : n).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {text}
      {suffix}
    </span>
  );
}

export function SectionHeading({ eyebrow, title, lead, center = false }: { eyebrow: string; title: string; lead?: string; center?: boolean }) {
  return (
    <div className={cn("max-w-[760px]", center && "mx-auto text-center")}>
      <Reveal>
        <p className="text-[12.5px] font-medium tracking-[0.14em] text-brand uppercase">{eyebrow}</p>
      </Reveal>
      <Reveal delay={0.05}>
        <h2 className="mt-3 text-[44px] leading-[1.05] font-light tracking-[-0.04em] text-fg-1 max-md:text-[32px]">{title}</h2>
      </Reveal>
      {lead && (
        <Reveal delay={0.1}>
          <p className="mt-4 text-[16px] leading-7 text-fg-2">{lead}</p>
        </Reveal>
      )}
    </div>
  );
}

/** A browser-style frame with a soft copper glow, used around every product demo. */
export function DemoFrame({ children, label, className }: { children: React.ReactNode; label: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div aria-hidden className="absolute -inset-6 rounded-[40px] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(255,141,77,0.22),transparent_70%)] blur-2xl" />
      <div className="surface relative overflow-hidden rounded-[22px] p-0">
        <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="ml-3 truncate rounded-full bg-white/[0.05] px-3 py-0.5 text-[11.5px] text-fg-3">{label}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

/** A status pill in the dashboard's style. */
export function Pill({ tone, children }: { tone: "stockout" | "expiry" | "healthy" | "brand" | "neutral"; children: React.ReactNode }) {
  const t = {
    stockout: "bg-stockout/15 text-stockout ring-stockout/30",
    expiry: "bg-expiry/15 text-expiry ring-expiry/30",
    healthy: "bg-healthy/15 text-healthy ring-healthy/30",
    brand: "bg-brand/15 text-brand ring-brand/30",
    neutral: "bg-white/[0.06] text-fg-2 ring-white/10",
  }[tone];
  return <span className={cn("inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] whitespace-nowrap ring-1", t)}>{children}</span>;
}
