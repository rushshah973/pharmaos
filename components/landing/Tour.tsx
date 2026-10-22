"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useRef, useState } from "react";
import { Check, ClipboardList, FileCheck2, LineChart, PackageCheck, ShieldCheck } from "lucide-react";
import { cn } from "cn";
import { DemoFrame, EASE, Pill, SectionHeading } from "./primitives";

// "How it works": the four steps of the product. On wide screens the section is tall and the demo frame sticks while
// the steps scroll past; the step in view drives the animation. On small screens each step is a card with its demo.

const STEPS = [
  {
    icon: LineChart,
    title: "Forecast demand",
    text: "Predicts packs per day for the next 14 days.",
    stat: "14.0% error vs 16.9% before",
  },
  {
    icon: ClipboardList,
    title: "Plan reorders",
    text: "What to buy today, most urgent first.",
    stat: "500 SKUs in about 2 seconds",
  },
  {
    icon: FileCheck2,
    title: "Approve & send",
    text: "One PO per supplier, sent automatically.",
    stat: "Above ₹10 L waits for the Owner",
  },
  {
    icon: PackageCheck,
    title: "Receive stock",
    text: "Batch, expiry and bin, straight onto the shelf.",
    stat: "Short-dated stock refused",
  },
];

export function Tour() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length)))));

  return (
    <section id="how-it-works" className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="How it works" title="Four steps, every morning" />

      {/* Wide screens: sticky demo, steps scroll past. */}
      <div ref={ref} className="relative mt-14 hidden h-[340vh] lg:block">
        <div className="sticky top-24 grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center gap-12">
          <ol className="space-y-3">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <motion.div
                  animate={{ opacity: i === active ? 1 : 0.38 }}
                  transition={{ duration: 0.4 }}
                  className={cn("rounded-3xl border p-5 transition-colors", i === active ? "border-brand/30 bg-white/[0.04]" : "border-transparent")}
                >
                  <div className="flex items-center gap-3">
                    <span className={cn("flex size-9 items-center justify-center rounded-full text-[13px]", i < active ? "bg-healthy/15 text-healthy" : i === active ? "bg-brand text-black" : "bg-white/[0.06] text-fg-3")}>
                      {i < active ? <Check className="size-4" /> : i + 1}
                    </span>
                    <h3 className="text-[19px] tracking-[-0.02em] text-fg-1">{s.title}</h3>
                  </div>
                  <AnimatePresence initial={false}>
                    {i === active && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} className="overflow-hidden">
                        <p className="mt-3 pl-12 text-[14.5px] leading-6 text-fg-2">{s.text}</p>
                        <p className="mt-2 pl-12 text-[12.5px] text-brand">{s.stat}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              </li>
            ))}
          </ol>
          <DemoFrame label={`PharmaOS · ${STEPS[active].title}`}>
            <div className="relative h-[420px]">
              <AnimatePresence mode="wait">
                <motion.div key={active} className="absolute inset-0 p-6" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.4, ease: EASE }}>
                  <StepDemo i={active} />
                </motion.div>
              </AnimatePresence>
            </div>
          </DemoFrame>
        </div>
      </div>

      {/* Small screens: stacked cards. */}
      <div className="mt-10 space-y-8 lg:hidden">
        {STEPS.map((s, i) => (
          <div key={s.title}>
            <div className="flex items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand text-[12px] text-black">{i + 1}</span>
              <h3 className="text-[19px] text-fg-1">{s.title}</h3>
            </div>
            <p className="mt-2 text-[14.5px] leading-6 text-fg-2">{s.text}</p>
            <DemoFrame label={`PharmaOS · ${s.title}`} className="mt-4">
              <div className="h-[340px] p-4">
                <StepDemo i={i} />
              </div>
            </DemoFrame>
          </div>
        ))}
      </div>
    </section>
  );
}

function StepDemo({ i }: { i: number }) {
  if (i === 0) return <ForecastDemo />;
  if (i === 1) return <PlanDemo />;
  if (i === 2) return <SendDemo />;
  return <ReceiveDemo />;
}

/** Sales for 6 weeks, then the 14-day forecast: the line draws itself, the forecast follows dashed. */
function ForecastDemo() {
  const past = [52, 48, 55, 61, 50, 47, 58, 63, 54, 49, 60, 66, 57, 52, 61, 68, 58, 55, 64, 70, 60, 56, 66, 72, 62, 58, 68, 73];
  const future = [70, 66, 64, 71, 74, 68, 65, 72, 75, 69, 67, 73, 76, 70];
  const all = [...past, ...future];
  const W = 560, H = 220, max = 90;
  const x = (k: number) => 20 + (k / (all.length - 1)) * (W - 40);
  const y = (v: number) => H - 20 - (v / max) * (H - 50);
  const pathOf = (from: number, vals: number[]) => vals.map((v, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const today = x(past.length - 1);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] text-fg-2">Kelolin 50 · packs per day</p>
        <Pill tone="brand">ML blend 14.0% error vs 16.9%</Pill>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full flex-1">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="20" x2={W - 20} y1={20 + f * (H - 50)} y2={20 + f * (H - 50)} stroke="rgba(255,255,255,0.06)" />
        ))}
        <rect x={today} y="10" width={W - 20 - today} height={H - 30} fill="rgba(255,141,77,0.06)" />
        <motion.path d={pathOf(0, past)} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.6, ease: "easeInOut" }} />
        <motion.path d={pathOf(past.length - 1, [past.at(-1)!, ...future])} fill="none" stroke="#ff8d4d" strokeWidth="2" strokeDasharray="5 5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1.5, duration: 1.1, ease: "easeInOut" }} />
        <line x1={today} x2={today} y1="10" y2={H - 20} stroke="rgba(255,255,255,0.25)" strokeDasharray="3 4" />
        <text x={today + 6} y="24" fill="rgba(255,255,255,0.5)" fontSize="11">Today</text>
        <text x={W - 70} y="24" fill="#ff8d4d" fontSize="11">Forecast</text>
      </svg>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.6 }} className="text-[12px] text-fg-3">
        Tested on 14 days it never saw.
      </motion.p>
    </div>
  );
}

/** SKUs reorder themselves by urgency, each with an order-by date. */
function PlanDemo() {
  const rows = [
    ["Vexolin 500", "Stockout", "Order today", "stockout"],
    ["Kelolin 50", "Stockout", "Order today", "stockout"],
    ["Bexocort 0.05", "Below ROP", "Order today", "expiry"],
    ["Arazol 250", "Below ROP", "Order tomorrow", "expiry"],
    ["Novoquil 20", "Healthy", "in 5 days", "healthy"],
  ] as const;
  return (
    <div>
      <p className="text-[13px] text-fg-2">What to buy today, most urgent first</p>
      <div className="mt-4 space-y-2">
        {rows.map((r, i) => (
          <motion.div
            key={r[0]}
            initial={{ opacity: 0, y: 30 * (rows.length - i) }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.12, duration: 0.6, ease: EASE }}
            className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"
          >
            <span className="w-5 text-[12px] text-fg-3 tabular-nums">{i + 1}</span>
            <span className="flex-1 text-[13.5px] text-fg-1">{r[0]}</span>
            <Pill tone={r[3]}>{r[1]}</Pill>
            <span className="w-[110px] text-right text-[12px] text-fg-2">{r[2]}</span>
          </motion.div>
        ))}
      </div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="mt-4 text-[12px] text-fg-3">
        Ordered before the shelf is empty.
      </motion.p>
    </div>
  );
}

/** Small POs go out; the large one waits for the Owner, gets approved, then goes out too. */
function SendDemo() {
  return (
    <div>
      <p className="text-[13px] text-fg-2">One purchase order per supplier</p>
      <div className="mt-4 space-y-2.5">
        <PoRow no="PO-1003" sup="Shreeji Medical Agencies" amt="₹1,03,577" sendAt={0.6} />
        <PoRow no="PO-1001" sup="Shreeji Drug House" amt="₹69,658" sendAt={0.9} />
        <PoRow no="PO-1016" sup="Padmavati Pharma Agencies" amt="₹11,00,151" owner sendAt={2.6} />
      </div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.2 }} className="mt-4 text-[12px] text-fg-3">
        Simulated: nothing is emailed.
      </motion.p>
    </div>
  );
}

function PoRow({ no, sup, amt, owner = false, sendAt }: { no: string; sup: string; amt: string; owner?: boolean; sendAt: number }) {
  return (
    <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: EASE }} className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3">
      <span className="font-mono text-[12px] text-fg-1">{no}</span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">{sup}</span>
      <span className="text-[13px] text-fg-1 tabular-nums">{amt}</span>
      <span className="relative w-[132px] text-right">
        {owner && (
          <motion.span className="absolute right-0" initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ delay: sendAt - 0.4, duration: 0.2 }}>
            <Pill tone="expiry">
              <ShieldCheck className="size-3" /> Owner approval
            </Pill>
          </motion.span>
        )}
        <motion.span className="inline-block" initial={{ opacity: 0, scale: 1.3 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: sendAt, duration: 0.35, ease: EASE }}>
          <Pill tone="healthy">
            <Check className="size-3" /> Sent
          </Pill>
        </motion.span>
      </span>
    </motion.div>
  );
}

/** A delivery lands in its bins: the bins fill one by one. */
function ReceiveDemo() {
  const bins = Array.from({ length: 24 }, (_, k) => k);
  const target = new Set([3, 4, 9, 10, 15, 21]);
  return (
    <div>
      <p className="text-[13px] text-fg-2">PO-1003 arrived · booking 3 lines into their bins</p>
      <div className="mt-4 grid grid-cols-8 gap-2">
        {bins.map((b) => (
          <motion.div
            key={b}
            className="aspect-square rounded-lg border border-white/[0.08]"
            initial={{ backgroundColor: "rgba(255,255,255,0.04)" }}
            animate={target.has(b) ? { backgroundColor: ["rgba(255,255,255,0.04)", "rgba(255,141,77,0.5)", "rgba(74,222,128,0.35)"] } : {}}
            transition={{ delay: 0.4 + [...target].indexOf(b) * 0.25, duration: 1.2, times: [0, 0.5, 1] }}
          />
        ))}
      </div>
      <div className="mt-4 space-y-1.5 text-[12.5px]">
        {[
          ["Vexolin 500", "545 packs", "batch R1426 · exp Jun 2027 · A-L-05-1"],
          ["Arazol 250", "435 packs", "batch R1427 · exp Mar 2027 · B-R-02-3"],
        ].map((l, i) => (
          <motion.div key={l[0]} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 + i * 0.3 }} className="flex justify-between gap-3 text-fg-2">
            <span className="text-fg-1">{l[0]}</span>
            <span>{l[1]}</span>
            <span className="truncate text-fg-3">{l[2]}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
