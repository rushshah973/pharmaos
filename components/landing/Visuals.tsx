"use client";

import { motion } from "motion/react";
import { ArrowRight, Bot, Check, ClipboardList, FileSpreadsheet, MessageCircle, PhoneCall, Send, StickyNote, TimerOff } from "lucide-react";
import { cn } from "cn";
import { EASE, Pill } from "./primitives";

// Animated visuals that replace text on the landing page: the before/after shift, the agent pipeline and a tilted
// warehouse grid. Each one explains itself in a few words; the motion carries the rest.

/** Today (calls, chats, guesswork drifting around) vs with PharmaOS (one ranked plan that builds itself). */
export function BeforeAfter() {
  const chaos = [
    { icon: MessageCircle, text: "“10+1 till Saturday?”", tone: "text-healthy", x: "8%", y: "10%", r: -6, d: 0 },
    { icon: PhoneCall, text: "Supplier B calling…", tone: "text-fg-1", x: "46%", y: "22%", r: 5, d: 0.6 },
    { icon: StickyNote, text: "check Vexolin??", tone: "text-expiry", x: "14%", y: "48%", r: 4, d: 1.1 },
    { icon: TimerOff, text: "Expired · ₹28,659", tone: "text-stockout", x: "50%", y: "62%", r: -4, d: 0.3 },
    { icon: FileSpreadsheet, text: "rates_final_v3.xlsx", tone: "text-fg-2", x: "6%", y: "76%", r: 3, d: 0.9 },
  ];
  const plan = [
    ["Vexolin 500", "Order today", "stockout"],
    ["Kelolin 50", "Order today", "stockout"],
    ["Bexocort 0.05", "Order today", "expiry"],
    ["Arazol 250", "Tomorrow", "expiry"],
  ] as const;
  return (
    <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr]">
      <Panel title="Today" caption="Calls, chats and guesswork">
        <div className="relative h-[300px]">
          {chaos.map((c) => (
            <motion.div
              key={c.text}
              className="glass-pill absolute flex items-center gap-2 px-3.5 py-2 text-[13px] whitespace-nowrap"
              style={{ left: c.x, top: c.y }}
              initial={{ opacity: 0, scale: 0.8, rotate: 0 }}
              whileInView={{ opacity: 1, scale: 1, rotate: c.r }}
              viewport={{ once: true }}
              transition={{ delay: c.d * 0.4, duration: 0.5, ease: EASE }}
            >
              <motion.span
                className="flex items-center gap-2"
                animate={{ y: [0, -6, 0, 5, 0], x: [0, 4, 0, -3, 0] }}
                transition={{ duration: 6 + c.d * 2, repeat: Infinity, ease: "easeInOut" }}
              >
                <c.icon className={cn("size-4", c.tone)} strokeWidth={1.7} />
                <span className="text-fg-2">{c.text}</span>
              </motion.span>
            </motion.div>
          ))}
        </div>
      </Panel>

      <div className="flex items-center justify-center max-lg:rotate-90">
        <motion.span
          className="flex size-12 items-center justify-center rounded-full bg-brand text-black shadow-[0_0_40px_rgba(255,141,77,0.6)]"
          animate={{ x: [0, 6, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <ArrowRight className="size-5" />
        </motion.span>
      </div>

      <Panel title="With PharmaOS" caption="One ranked plan, in about 2 seconds" warm>
        <div className="flex h-[300px] flex-col justify-center gap-2.5">
          {plan.map((p, i) => (
            <motion.div
              key={p[0]}
              initial={{ opacity: 0, x: 24 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.5 + i * 0.15, duration: 0.55, ease: EASE }}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3"
            >
              <span className="w-4 text-[12px] text-white/50 tabular-nums">{i + 1}</span>
              <span className="flex-1 text-[14px] text-white">{p[0]}</span>
              <Pill tone={p[2]}>{p[1]}</Pill>
            </motion.div>
          ))}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 1.3, duration: 0.5 }}
            className="mt-1 flex items-center justify-between px-1 text-[13px] text-white/70"
          >
            <span>27 lines · 6 suppliers</span>
            <span className="text-white">₹3,95,896</span>
          </motion.div>
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, caption, warm = false, children }: { title: string; caption: string; warm?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-hidden p-6", warm ? "surface-warm" : "surface")}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className={cn("text-[20px] tracking-[-0.02em]", warm ? "text-white" : "text-fg-1")}>{title}</h3>
        <p className={cn("text-[12.5px]", warm ? "text-white/60" : "text-fg-3")}>{caption}</p>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** Demand → Supplier → Order → Sent, with a signal travelling along the line and each stage's result popping up. */
export function AgentFlow() {
  const nodes = [
    { icon: Bot, name: "Demand Agent", role: "picks the forecast", result: "10 forecasts switched" },
    { icon: Bot, name: "Supplier Agent", role: "picks the supplier", result: "15 suppliers checked" },
    { icon: ClipboardList, name: "Order Agent", role: "creates the POs", result: "6 purchase orders" },
    { icon: Send, name: "Sent", role: "within ₹10 L, simulated", result: "Large ones wait for the Owner" },
  ];
  return (
    <div className="surface relative overflow-hidden px-6 py-10">
      {/* The line and the travelling signal (wide screens). */}
      <div aria-hidden className="absolute top-[76px] right-[12%] left-[12%] hidden h-px bg-white/10 lg:block">
        <motion.span
          className="absolute -top-[3px] size-[7px] rounded-full bg-brand shadow-[0_0_16px_4px_rgba(255,141,77,0.7)]"
          animate={{ left: ["0%", "100%"] }}
          transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
        />
      </div>
      <ol className="relative grid gap-8 lg:grid-cols-4">
        {nodes.map((n, i) => (
          <motion.li
            key={n.name}
            className="flex flex-col items-center text-center"
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.18, duration: 0.6, ease: EASE }}
          >
            <motion.span
              className={cn(
                "flex size-[72px] items-center justify-center rounded-3xl ring-1",
                i === 3 ? "bg-healthy/15 text-healthy ring-healthy/30" : "glass-pill text-brand ring-transparent",
              )}
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 3.8, repeat: Infinity, delay: i * 0.8, ease: "easeInOut" }}
            >
              {i === 3 ? <Check className="size-7" /> : <n.icon className="size-7" strokeWidth={1.5} />}
            </motion.span>
            <p className="mt-4 text-[16px] text-fg-1">{n.name}</p>
            <p className="text-[12.5px] text-fg-3">{n.role}</p>
            <motion.span
              className="mt-3"
              initial={{ opacity: 0, scale: 0.7 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.9 + i * 0.35, duration: 0.4, ease: EASE }}
            >
              <Pill tone={i === 3 ? "healthy" : "brand"}>{n.result}</Pill>
            </motion.span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

/** A tilted, slowly swaying bin grid coloured like the 3D warehouse (a fixed pattern, not live data). */
export function TiltedWarehouse() {
  const cells = Array.from({ length: 96 }, (_, k) => {
    const v = (k * 37 + (k % 7) * 11) % 100;
    return v < 8 ? "stockout" : v < 16 ? "expiry" : v < 28 ? "excess" : "normal";
  });
  const color = {
    stockout: "bg-stockout shadow-[0_0_18px_rgba(255,92,92,0.6)]",
    expiry: "bg-expiry/80",
    excess: "bg-excess/70",
    normal: "bg-white/[0.08]",
  } as const;
  return (
    <div className="relative flex h-[420px] items-center justify-center overflow-hidden [perspective:1100px] max-md:h-[320px]">
      <div aria-hidden className="absolute inset-x-10 bottom-0 h-40 rounded-full bg-[radial-gradient(closest-side,rgba(255,141,77,0.18),transparent)] blur-2xl" />
      <motion.div
        className="grid gap-2 [transform-style:preserve-3d]"
        style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))", width: "min(560px, 90%)" }}
        initial={{ rotateX: 58, rotateZ: -32, opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        animate={{ rotateZ: [-32, -26, -32] }}
        transition={{ rotateZ: { duration: 12, repeat: Infinity, ease: "easeInOut" }, opacity: { duration: 0.8 }, y: { duration: 0.8, ease: EASE } }}
      >
        {cells.map((c, k) => (
          <motion.span
            key={k}
            className={cn("aspect-square rounded-[6px]", color[c])}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3 + (k % 12) * 0.03 + Math.floor(k / 12) * 0.04, duration: 0.3 }}
          >
            {c === "stockout" && <span className="block size-full animate-pulse rounded-[6px] bg-white/30" />}
          </motion.span>
        ))}
      </motion.div>
    </div>
  );
}
