"use client";

import Link from "next/link";
import { MotionConfig, motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { ArrowRight, Bot, Boxes, CircleAlert, ClipboardCheck, Clock3, Eye, FileWarning, Lock, MessageSquareWarning, PhoneCall, ShieldCheck, Sparkles, TimerOff } from "lucide-react";
import { cn } from "cn";
import { Logo } from "@/components/layout/Logo";
import { HeroDemo } from "./HeroDemo";
import { EASE, InViewCount, Reveal, SectionHeading, WordsRise } from "./primitives";
import { Tour } from "./Tour";

// The public landing page at "/": what PharmaOS is, a playing demo of the product, how it works, the agents, the
// impact and the guardrails, with a way into the live dashboard (/dashboard) at every step. Static: no database.

const DASHBOARD = "/dashboard";

export function Landing() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="relative overflow-x-clip">
        <Nav />
        <main>
          <Hero />
          <ProofStrip />
          <Problem />
          <Tour />
          <Agents />
          <Warehouse />
          <Impact />
          <Trust />
          <FinalCta />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}

function Nav() {
  const links = [
    ["#how-it-works", "How it works"],
    ["#agents", "AI agents"],
    ["#impact", "Impact"],
    ["#trust", "Safety"],
  ];
  return (
    <motion.header initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.6, ease: EASE }} className="sticky top-4 z-50 px-4">
      <nav aria-label="Main" className="glass-pill mx-auto flex h-14 max-w-[1100px] items-center gap-6 pr-2 pl-5">
        <Link href="/" aria-label="PharmaOS home">
          <Logo />
        </Link>
        <ul className="ml-auto flex items-center gap-1 max-md:hidden">
          {links.map(([href, label]) => (
            <li key={href}>
              <a href={href} className="rounded-full px-3 py-2 text-[13.5px] text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg-1">
                {label}
              </a>
            </li>
          ))}
        </ul>
        <Link href={DASHBOARD} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[13.5px] font-medium text-black transition-colors hover:bg-white/90 max-md:ml-auto">
          Open dashboard <ArrowRight className="size-4" />
        </Link>
      </nav>
    </motion.header>
  );
}

function Hero() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const glowY = useTransform(scrollYProgress, [0, 1], [0, 160]);
  const demoScale = useTransform(scrollYProgress, [0, 0.6], [1, 0.96]);
  return (
    <section ref={ref} className="relative mx-auto max-w-[1240px] px-6 pt-20 pb-10 max-md:pt-14">
      <motion.div aria-hidden style={{ y: glowY }} className="pointer-events-none absolute top-10 left-1/2 -z-10 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,141,77,0.22),transparent)] blur-2xl" />
      <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="glass-pill inline-flex items-center gap-2 px-3.5 py-1.5 text-[12.5px] text-fg-2">
        <Sparkles className="size-3.5 text-brand" /> AI procurement co-pilot for Indian pharma stockists
      </motion.p>
      <h1 className="mt-6 max-w-[980px] text-[76px] leading-[0.98] font-light tracking-[-0.055em] text-fg-1 max-lg:text-[58px] max-md:text-[42px]">
        <WordsRise text="Order every medicine" />
        <br />
        <WordsRise text="before it runs out." delay={0.25} className="text-brand" />
      </h1>
      <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6, duration: 0.7, ease: EASE }} className="mt-6 max-w-[620px] text-[18px] leading-7 text-fg-2 max-md:text-[16px]">
        PharmaOS forecasts demand for every SKU, builds a ranked purchase plan in seconds, lets three AI agents review it, and sends one purchase order per supplier, with the Owner in control of large orders.
      </motion.p>
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.75, duration: 0.7, ease: EASE }} className="mt-8 flex flex-wrap items-center gap-3">
        <Link href={DASHBOARD} className="group inline-flex h-12 items-center gap-2 rounded-full bg-brand px-6 text-[15px] font-medium text-black shadow-[0_10px_40px_-10px_rgba(255,141,77,0.8)] transition-colors hover:bg-brand-strong">
          Open the live dashboard <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <a href="#how-it-works" className="glass-pill inline-flex h-12 items-center gap-2 px-6 text-[15px] text-fg-1 hover:bg-white/[0.08]">
          See how it works
        </a>
      </motion.div>
      <motion.div style={{ scale: demoScale }} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.9, ease: EASE }} className="mt-16">
        <HeroDemo />
      </motion.div>
    </section>
  );
}

function ProofStrip() {
  const facts = [
    "500 SKUs planned in about 2 seconds",
    "Three AI agents, every step on the record",
    "14.0% vs 16.9% forecast error on held-out days",
    "One PO per supplier, GST and freight included",
    "Owner approval above ₹10,00,000",
    "Batch, expiry and bin on every receipt",
    "Built on Next.js, Supabase and Gemini",
  ];
  return (
    <section aria-label="Highlights" className="relative mt-16 overflow-hidden border-y border-white/[0.06] py-5 [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
      <motion.ul className="flex w-max gap-12" animate={{ x: ["0%", "-50%"] }} transition={{ duration: 38, ease: "linear", repeat: Infinity }}>
        {[...facts, ...facts].map((f, i) => (
          <li key={i} className="flex items-center gap-3 text-[14px] whitespace-nowrap text-fg-2">
            <span className="size-1.5 rounded-full bg-brand" /> {f}
          </li>
        ))}
      </motion.ul>
    </section>
  );
}

function Problem() {
  const pains = [
    { icon: Eye, title: "Stock on screen isn't stock on the shelf", text: "Owners say their ERP apps show stale or zero stock, so orders are placed by walking the shelves and by gut feel." },
    { icon: TimerOff, title: "Expiry is found too late", text: "Batch and expiry go missing at ordering time, so slow movers expire unsold and margin is written off." },
    { icon: PhoneCall, title: "Quotes live in calls and WhatsApp", text: "Rates and schemes like “10+1” arrive by phone, and comparing suppliers means sums in your head or in Excel." },
  ];
  return (
    <section className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="The problem" title="Every morning, a stockist decides what to buy for thousands of SKUs, mostly by eye." lead="India has over 20,000 pharma distributors. Their tools record sales and stock, but none of them says what to order today, from whom, and why." />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {pains.map((p, i) => (
          <Reveal key={p.title} delay={i * 0.08}>
            <motion.article whileHover={{ y: -4 }} transition={{ duration: 0.25 }} className="surface h-full p-6">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-stockout/12 text-stockout ring-1 ring-stockout/25">
                <p.icon className="size-5" strokeWidth={1.6} />
              </span>
              <h3 className="mt-5 text-[18px] leading-6 tracking-[-0.02em] text-fg-1">{p.title}</h3>
              <p className="mt-2 text-[14px] leading-6 text-fg-2">{p.text}</p>
            </motion.article>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <p className="mt-5 text-[12px] text-fg-3">From our research: 480 Google Play reviews of Marg and Busy apps, and pharmacy buyers on Reddit (Oct 2026).</p>
      </Reveal>
    </section>
  );
}

function Agents() {
  const agents = [
    {
      name: "Demand Agent",
      role: "Picks the forecast to trust",
      log: ["read forecasts for 15 medicines", "Bexocort 0.05: average 21% error vs ML 23%", "→ use the average · 390 → 380 packs"],
    },
    {
      name: "Supplier Agent",
      role: "Picks the supplier",
      log: ["compared every offer for 15 medicines", "Kelolin 50: SUP-01 cheaper but 7 days away", "→ keep SUP-02 · delivers tomorrow"],
    },
    {
      name: "Order Agent",
      role: "Creates and sends the POs",
      log: ["validated 15 lines, no hard stops", "created 6 purchase orders", "→ sent 6 (simulated) · none above ₹10 L"],
    },
  ];
  return (
    <section id="agents" className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="AI agents" title="Three agents review the plan the way a sharp buyer would" lead="They run on Gemini in about 40 seconds. The engine computes every number; the agents choose between the options it gives them, and every decision is logged with its reason." />
      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {agents.map((a, i) => (
          <Reveal key={a.name} delay={i * 0.1}>
            <article className="surface h-full p-6">
              <div className="flex items-center gap-3">
                <span className="glass-pill flex size-10 items-center justify-center text-brand">
                  <Bot className="size-5" strokeWidth={1.6} />
                </span>
                <div>
                  <h3 className="text-[17px] text-fg-1">{a.name}</h3>
                  <p className="text-[12.5px] text-fg-3">{a.role}</p>
                </div>
              </div>
              <ol className="mt-5 space-y-2 rounded-2xl border border-white/[0.06] bg-black/30 p-4 font-mono text-[12px] leading-5">
                {a.log.map((l, k) => (
                  <motion.li
                    key={l}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.3 + i * 0.25 + k * 0.35, duration: 0.4 }}
                    className={cn(k === a.log.length - 1 ? "text-brand" : "text-fg-2")}
                  >
                    {l}
                  </motion.li>
                ))}
              </ol>
            </article>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <div className="mt-5 flex flex-wrap gap-2 text-[12.5px]">
          {["Chooses a method, never a number", "Excluded or short offers are refused", "Can't cut an order by more than half", "Can't approve for the Owner", "Falls back safely if the AI is down"].map((g) => (
            <span key={g} className="glass-pill inline-flex items-center gap-1.5 px-3 py-1.5 text-fg-2">
              <ShieldCheck className="size-3.5 text-healthy" /> {g}
            </span>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function Warehouse() {
  // A fixed, plausible heat pattern for the teaser (not live data).
  const cells = Array.from({ length: 84 }, (_, k) => {
    const v = (k * 37 + (k % 7) * 11) % 100;
    return v < 8 ? "stockout" : v < 16 ? "expiry" : v < 30 ? "excess" : "normal";
  });
  const color = { stockout: "bg-stockout/70", expiry: "bg-expiry/60", excess: "bg-excess/50", normal: "bg-white/[0.06]" } as const;
  return (
    <section className="mx-auto max-w-[1240px] px-6 pt-32">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading eyebrow="3D warehouse" title="See the risk where the stock actually sits" lead="Every bin is coloured by the same engine that writes the plan: what runs out, what will expire, what is overstocked, and where the next delivery goes." />
          <Reveal delay={0.15}>
            <Link href="/warehouse" className="mt-6 inline-flex items-center gap-2 text-[14px] text-brand hover:underline">
              Open the warehouse <ArrowRight className="size-4" />
            </Link>
          </Reveal>
        </div>
        <Reveal delay={0.1}>
          <div className="surface p-6">
            <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}>
              {cells.map((c, k) => (
                <motion.span
                  key={k}
                  className={cn("aspect-square rounded-[5px]", color[c])}
                  initial={{ opacity: 0, scale: 0.6 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: (k % 14) * 0.03 + Math.floor(k / 14) * 0.05, duration: 0.35 }}
                >
                  {c === "stockout" && <span className="block size-full animate-pulse rounded-[5px] bg-stockout/50" />}
                </motion.span>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-4 text-[12px] text-fg-2">
              {[
                ["bg-stockout/70", "Runs out"],
                ["bg-expiry/60", "Expiry risk"],
                ["bg-excess/50", "Excess"],
                ["bg-white/[0.12]", "Normal"],
              ].map(([c, l]) => (
                <span key={l} className="flex items-center gap-2">
                  <span className={cn("size-2.5 rounded-sm", c)} /> {l}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Impact() {
  const stats = [
    { n: 7.2, d: 1, suffix: " h", label: "Owner time saved per week", note: "Estimate: 1.2 h a day over 6 buying days" },
    { n: 14.0, d: 1, suffix: "%", label: "14-day forecast error", note: "vs 16.9% for the old moving average, on days the model never saw" },
    { n: 2, d: 0, suffix: " s", label: "To plan 500 SKUs", note: "Demand, stock, expiry and every supplier offer" },
    { n: 0, d: 0, suffix: "", label: "Large POs sent without the Owner", note: "Anything above ₹10,00,000 waits for approval" },
  ];
  return (
    <section id="impact" className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="Impact" title="Less time buying, fewer empty shelves, less stock thrown away" />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <Reveal key={s.label} delay={i * 0.08}>
            <div className={cn("h-full p-6", i === 0 ? "surface-warm" : "surface")}>
              <p className="text-[52px] leading-none font-light tracking-[-0.05em] text-fg-1">
                <InViewCount to={s.n} decimals={s.d} suffix={s.suffix} />
              </p>
              <p className="mt-4 text-[15px] text-fg-1">{s.label}</p>
              <p className="mt-1 text-[12.5px] leading-5 text-fg-3">{s.note}</p>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={0.1}>
        <p className="mt-5 text-[12px] text-fg-3">Measured on PharmaOS’s synthetic demo data (500 SKUs, 45,000 sales rows). Time saved is a planning estimate, not a pilot result.</p>
      </Reveal>
    </section>
  );
}

function Trust() {
  const items = [
    { icon: Lock, title: "Every number is calculated", text: "Quantities, prices and totals come from tested business logic with exact rupee maths, never from the AI." },
    { icon: ClipboardCheck, title: "Every action is on the record", text: "Plans, edits, approvals, sends, receipts and every agent decision are written to the activity log." },
    { icon: ShieldCheck, title: "The Owner controls spend", text: "A purchase order above ₹10,00,000 cannot go out until the Owner approves it. No AI can approve on the Owner's behalf." },
    { icon: FileWarning, title: "Nothing leaves the app", text: "Sending to suppliers is simulated in this version: no email, no API call, clearly labelled everywhere." },
    { icon: CircleAlert, title: "Honest about its data", text: "Demo data is synthetic and labelled on every screen; the forecast shows both errors, including where the average wins." },
    { icon: MessageSquareWarning, title: "Works when the AI doesn't", text: "If the AI is slow or down, explanations fall back to the calculated reasons and nothing changes without a person." },
  ];
  return (
    <section id="trust" className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="Safety" title="Built so you can trust what it orders" />
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((t, i) => (
          <Reveal key={t.title} delay={(i % 3) * 0.08}>
            <div className="surface flex h-full gap-4 p-6">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-healthy/10 text-healthy ring-1 ring-healthy/25">
                <t.icon className="size-5" strokeWidth={1.6} />
              </span>
              <div>
                <h3 className="text-[16px] text-fg-1">{t.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-6 text-fg-2">{t.text}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="mx-auto max-w-[1240px] px-6 pt-32 pb-24">
      <Reveal>
        <div className="surface-warm relative overflow-hidden px-10 py-16 text-center max-md:px-6">
          <motion.div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[640px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,180,130,0.35),transparent)] blur-2xl" animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 6, repeat: Infinity }} />
          <h2 className="relative mx-auto max-w-[760px] text-[48px] leading-[1.05] font-light tracking-[-0.045em] text-white max-md:text-[34px]">See tomorrow’s orders before you need them.</h2>
          <p className="relative mx-auto mt-4 max-w-[560px] text-[16px] leading-7 text-white/70">Open the live dashboard with 500 demo SKUs: create a plan, run the agents, approve and receive stock.</p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <Link href={DASHBOARD} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-6 text-[15px] font-medium text-black hover:bg-white/90">
              Open the dashboard <ArrowRight className="size-4" />
            </Link>
            <Link href="/procurement" className="inline-flex h-12 items-center gap-2 rounded-full border border-white/25 px-6 text-[15px] text-white hover:bg-white/10">
              <Clock3 className="size-4" /> Go straight to plans
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6 px-6 py-10">
        <div>
          <Logo />
          <p className="mt-2 text-[12.5px] text-fg-3">AI procurement co-pilot for pharma stockists · synthetic demo data</p>
        </div>
        <nav aria-label="Product" className="flex flex-wrap gap-5 text-[13px] text-fg-2">
          {[
            [DASHBOARD, "Command Center"],
            ["/procurement", "Plans"],
            ["/purchase-orders", "Orders"],
            ["/warehouse", "Warehouse"],
            ["/data", "Data & scenarios"],
          ].map(([href, label]) => (
            <Link key={href} href={href} className="hover:text-fg-1">
              {label}
            </Link>
          ))}
        </nav>
        <p className="flex items-center gap-1.5 text-[12px] text-fg-3">
          <Boxes className="size-3.5" /> © 2026 PharmaOS
        </p>
      </div>
    </footer>
  );
}
