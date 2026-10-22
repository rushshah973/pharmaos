"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Bot, Check, ClipboardList, FileCheck2, LineChart, Loader2, MousePointer2, PackageCheck, Pause, Play, Send, Sparkles } from "lucide-react";
import { cn } from "cn";
import { DemoFrame, EASE, Pill } from "./primitives";

// The hero's product "video": four scripted scenes of the real dashboard, played in a loop like a short screen
// recording. Every number is from the demo dataset (as of 21 Oct 2026, 500 SKUs). The chapters underneath work like
// a video scrubber: the bar fills while a scene plays and a click jumps to it.

const SCENES = [
  { id: "today", label: "See what runs out", icon: LineChart, ms: 5200 },
  { id: "plan", label: "Get a ranked plan", icon: ClipboardList, ms: 5200 },
  { id: "agents", label: "AI agents review it", icon: Bot, ms: 5600 },
  { id: "orders", label: "POs go out", icon: Send, ms: 5000 },
] as const;

export function HeroDemo() {
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!playing || reduce) return;
    const t = setTimeout(() => setScene((s) => (s + 1) % SCENES.length), SCENES[scene].ms);
    return () => clearTimeout(t);
  }, [scene, playing, reduce]);

  return (
    <div>
      <DemoFrame label="pharmaos-gold.vercel.app/dashboard">
        <div className="relative h-[430px] overflow-hidden max-md:h-[520px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={SCENES[scene].id}
              className="absolute inset-0 p-6 max-sm:p-4"
              initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              {scene === 0 && <SceneToday />}
              {scene === 1 && <ScenePlan />}
              {scene === 2 && <SceneAgents />}
              {scene === 3 && <SceneOrders />}
            </motion.div>
          </AnimatePresence>
        </div>
      </DemoFrame>

      {/* Chapters: a scrubber for the demo. */}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause the demo" : "Play the demo"}
          className="glass-pill flex size-9 shrink-0 items-center justify-center text-fg-1 hover:bg-white/[0.09]"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
        <ol className="grid flex-1 grid-cols-4 gap-2 max-sm:grid-cols-2">
          {SCENES.map((s, i) => (
            <li key={s.id}>
              <button type="button" onClick={() => setScene(i)} className="group w-full text-left" aria-current={i === scene ? "step" : undefined}>
                <span className="block h-1 overflow-hidden rounded-full bg-white/10">
                  {i === scene && (
                    <motion.span
                      key={`${s.id}-${playing}`}
                      className="block h-full rounded-full bg-brand"
                      initial={{ width: playing && !reduce ? "0%" : "100%" }}
                      animate={{ width: "100%" }}
                      transition={{ duration: playing && !reduce ? s.ms / 1000 : 0, ease: "linear" }}
                    />
                  )}
                  {i < scene && <span className="block h-full w-full rounded-full bg-brand/50" />}
                </span>
                <span className={cn("mt-2 flex items-center gap-1.5 text-[12px] transition-colors", i === scene ? "text-fg-1" : "text-fg-3 group-hover:text-fg-2")}>
                  <s.icon className="size-3.5" strokeWidth={1.7} />
                  {s.label}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const stagger = (i: number, base = 0.15) => ({ initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { delay: base + i * 0.09, duration: 0.45, ease: EASE } });

function SceneToday() {
  const chips = [
    { label: "Stockout risk", n: 15, dot: "bg-stockout" },
    { label: "Below reorder point", n: 17, dot: "bg-expiry" },
    { label: "Healthy", n: 374, dot: "bg-healthy" },
    { label: "Excess", n: 94, dot: "bg-excess" },
  ];
  const steps = ["Forecast", "Plan", "Approve & send", "Receive"];
  return (
    <div className="relative h-full">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11.5px] text-fg-3">As of 21 Oct 2026 · 500 active SKUs</p>
          <p className="mt-1 text-[28px] leading-8 font-light tracking-[-0.04em] text-fg-1">Command Center</p>
        </div>
        <motion.span
          className="relative inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[12.5px] font-medium text-black"
          animate={{ scale: [1, 1, 0.94, 1] }}
          transition={{ times: [0, 0.72, 0.8, 0.9], duration: 4.2 }}
        >
          <Sparkles className="size-3.5" /> Create plan
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full ring-4 ring-brand/50"
            initial={{ opacity: 0, scale: 1 }}
            animate={{ opacity: [0, 0, 1, 0], scale: [1, 1, 1.15, 1.35] }}
            transition={{ times: [0, 0.74, 0.8, 1], duration: 4.4 }}
          />
        </motion.span>
      </div>
      <div className="mt-5 grid grid-cols-4 gap-2.5 max-md:grid-cols-2">
        {chips.map((c, i) => (
          <motion.div key={c.label} {...stagger(i)} className="glass-pill flex h-12 items-center justify-between px-4">
            <span className="flex items-center gap-2 text-[12px] text-fg-2">
              <span className={cn("size-2 rounded-full", c.dot)} />
              {c.label}
            </span>
            <span className="text-[17px] font-light text-fg-1 tabular-nums">{c.n}</span>
          </motion.div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2.5 max-md:grid-cols-2">
        {steps.map((s, i) => (
          <motion.div
            key={s}
            {...stagger(i, 0.55)}
            className={cn("rounded-2xl border p-3.5", i === 1 ? "border-brand/40 bg-[linear-gradient(140deg,rgba(255,141,77,0.18),rgba(255,141,77,0.04))]" : "border-white/[0.07] bg-white/[0.03]")}
          >
            <span className={cn("flex size-6 items-center justify-center rounded-full text-[11px]", i === 0 ? "bg-healthy/15 text-healthy" : i === 1 ? "bg-brand text-black" : "bg-white/[0.07] text-fg-3")}>
              {i === 0 ? <Check className="size-3" /> : i + 1}
            </span>
            <p className="mt-2.5 text-[12.5px] text-fg-1">{s}</p>
            <p className="text-[11px] text-fg-3">{["6,197 packs/day", "32 SKUs to order", "₹10 L Owner limit", "batch · expiry · bin"][i]}</p>
          </motion.div>
        ))}
      </div>
      <motion.div {...stagger(0, 1.0)} className="mt-4 rounded-2xl border border-stockout/25 bg-stockout/[0.07] px-4 py-3 text-[12.5px] text-fg-1">
        15 medicines run out before a new delivery could arrive. Vexolin 500 · Revolin 100 · Saviquil 200…
      </motion.div>
      {/* The cursor glides to "Create plan" and clicks. */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute"
        initial={{ left: "40%", top: "85%" }}
        animate={{ left: ["40%", "40%", "88%"], top: ["85%", "85%", "6%"] }}
        transition={{ times: [0, 0.3, 0.72], duration: 4.2, ease: EASE }}
      >
        <MousePointer2 className="size-5 fill-white text-black drop-shadow" />
      </motion.div>
    </div>
  );
}

function ScenePlan() {
  const rows = [
    ["PHX-0115", "Vexolin 500", "0.0 d", "545", "SUP-01", "₹70,589"],
    ["PHX-0220", "Revolin 100", "0.0 d", "333", "SUP-06", "₹18,337"],
    ["PHX-0081", "Kelolin 50", "0.5 d", "480", "SUP-02", "₹22,866"],
    ["PHX-0133", "Bexozol 250", "0.5 d", "470", "SUP-01", "₹12,992"],
    ["PHX-0167", "Ivamel 20", "1.0 d", "480", "SUP-05", "₹14,590"],
  ];
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[22px] font-light tracking-[-0.03em] text-fg-1">Reorder plan</p>
        <p className="text-[11.5px] text-fg-3">Analysed 500 SKUs in about 2 seconds</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2.5">
        {[
          ["Total spend", "₹3,95,896"],
          ["Stockouts covered", "12 / 15"],
          ["Supplier POs", "6"],
        ].map(([k, v], i) => (
          <motion.div key={k} {...stagger(i)} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3.5 py-3">
            <p className="text-[10.5px] tracking-[0.08em] text-fg-3 uppercase max-sm:text-[9px]">{k}</p>
            <p className="mt-1 text-[22px] font-light tracking-[-0.03em] text-fg-1 max-sm:text-[15px]">{v}</p>
          </motion.div>
        ))}
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-white/[0.07]">
        {rows.map((r, i) => (
          <motion.div
            key={r[0]}
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.12, duration: 0.45, ease: EASE }}
            className="grid grid-cols-[28px_1.6fr_auto_0.6fr_0.7fr_0.9fr] items-center gap-3 border-b border-white/[0.05] px-3.5 py-2.5 text-[12px] last:border-b-0 max-sm:grid-cols-[22px_1.4fr_auto_0.8fr]"
          >
            <span className="text-fg-3 tabular-nums">{i + 1}</span>
            <span className="min-w-0">
              <span className="block truncate text-fg-1">{r[1]}</span>
              <span className="font-mono text-[10.5px] text-fg-3">{r[0]}</span>
            </span>
            <Pill tone="stockout">Stockout · {r[2]}</Pill>
            <span className="text-fg-2 tabular-nums">{r[3]} packs</span>
            <span className="font-mono text-fg-3 max-sm:hidden">{r[4]}</span>
            <span className="text-right text-fg-1 tabular-nums max-sm:hidden">{r[5]}</span>
          </motion.div>
        ))}
      </div>
      <motion.p {...stagger(0, 1.3)} className="mt-3 text-[12px] text-fg-3">
        Why SUP-02 for Kelolin 50? SUP-01 is 3% cheaper but takes 7 days, and stock runs out in 0.5 days.
      </motion.p>
    </div>
  );
}

function SceneAgents() {
  const agents = [
    { name: "Demand Agent", done: "Checked 15 medicines · switched 10 to the more accurate forecast", at: 0.4 },
    { name: "Supplier Agent", done: "Compared every offer · kept the best valid supplier for all 15", at: 1.6 },
    { name: "Order Agent", done: "Created 6 purchase orders · sent 6 automatically (simulated)", at: 2.8 },
  ];
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="glass-pill flex size-8 items-center justify-center text-brand">
          <Bot className="size-4" strokeWidth={1.6} />
        </span>
        <p className="text-[18px] font-light text-fg-1">Procurement agents</p>
        <span className="ml-auto text-[11.5px] text-fg-3">Gemini · 3 agents · ~40 s</span>
      </div>
      <p className="mt-2 text-[12px] text-fg-3">The engine calculates every number; the agents choose within guardrails.</p>
      <ol className="mt-4 space-y-2.5">
        {agents.map((a, i) => (
          <motion.li key={a.name} {...stagger(i)} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2.5 text-[13.5px] text-fg-1">
                <span className="flex size-6 items-center justify-center rounded-full border border-white/10 text-[11px] text-fg-2">{i + 1}</span>
                {a.name}
              </span>
              <AgentState at={a.at} />
            </div>
            <motion.p
              className="mt-2 pl-[34px] text-[12.5px] text-fg-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: a.at + 0.9, duration: 0.4 }}
            >
              {a.done}
            </motion.p>
          </motion.li>
        ))}
      </ol>
      <motion.div {...stagger(0, 4.0)} className="mt-3 flex flex-wrap gap-2">
        <Pill tone="neutral">Picks a method, never a number</Pill>
        <Pill tone="neutral">Excluded offers refused</Pill>
        <Pill tone="neutral">Large POs wait for the Owner</Pill>
      </motion.div>
    </div>
  );
}

/** Thinking (spinner) until `at` + 0.9 s, then done. */
function AgentState({ at }: { at: number }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), (at + 0.9) * 1000);
    return () => clearTimeout(t);
  }, [at]);
  return done ? (
    <Pill tone="healthy">
      <Check className="size-3" /> Done
    </Pill>
  ) : (
    <Pill tone="expiry">
      <Loader2 className="size-3 animate-spin" /> Thinking
    </Pill>
  );
}

function SceneOrders() {
  const pos = [
    ["PO-1003", "Shreeji Medical Agencies", "₹1,03,577"],
    ["PO-1001", "Shreeji Drug House", "₹69,658"],
    ["PO-1004", "Ambika Distributors", "₹30,546"],
    ["PO-1002", "Siddhivinayak Distributors", "₹29,387"],
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-[22px] font-light tracking-[-0.03em] text-fg-1">Purchase orders</p>
        <p className="text-[11.5px] text-fg-3">One per supplier · sending is simulated</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        {pos.map((p, i) => (
          <motion.div key={p[0]} {...stagger(i)} className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[12px] text-fg-1">{p[0]}</span>
              <SentStamp delay={1.1 + i * 0.35} />
            </div>
            <p className="mt-2 truncate text-[12.5px] text-fg-2">{p[1]}</p>
            <p className="mt-1 text-[20px] font-light tracking-[-0.03em] text-fg-1">{p[2]}</p>
          </motion.div>
        ))}
      </div>
      <motion.div {...stagger(0, 2.8)} className="mt-3 flex items-center gap-2 rounded-2xl border border-healthy/25 bg-healthy/[0.07] px-4 py-3 text-[12.5px] text-fg-1">
        <PackageCheck className="size-4 text-healthy" /> When stock arrives: receive it with batch, expiry and bin, and it is on the shelf.
      </motion.div>
    </div>
  );
}

function SentStamp({ delay }: { delay: number }) {
  const [sent, setSent] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSent(true), delay * 1000);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <AnimatePresence mode="wait">
      {sent ? (
        <motion.span key="sent" initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.35, ease: EASE }}>
          <Pill tone="healthy">
            <FileCheck2 className="size-3" /> Sent
          </Pill>
        </motion.span>
      ) : (
        <motion.span key="ready" exit={{ opacity: 0 }}>
          <Pill tone="neutral">Ready</Pill>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
