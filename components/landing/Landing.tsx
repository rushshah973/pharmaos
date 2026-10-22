"use client";

import Link from "next/link";
import { MotionConfig, motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { ArrowRight, Boxes, CircleAlert, ClipboardCheck, Clock3, FileWarning, Lock, MessageSquareWarning, ShieldCheck, Sparkles } from "lucide-react";
import { cn } from "cn";
import { Logo } from "@/components/layout/Logo";
import { HeroDemo } from "./HeroDemo";
import { EASE, InViewCount, Reveal, SectionHeading, WordsRise } from "./primitives";
import { Tour } from "./Tour";
import { AgentFlow, BeforeAfter, TiltedWarehouse } from "./Visuals";

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
        Forecast, plan, approve and receive in one place, with three AI agents and the Owner in control.
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
  return (
    <section className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="The shift" title="From gut feel to a ranked plan" />
      <Reveal delay={0.1} className="mt-12">
        <BeforeAfter />
      </Reveal>
    </section>
  );
}

function Agents() {
  return (
    <section id="agents" className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="AI agents" title="Three agents, about 40 seconds, every step on record" />
      <Reveal delay={0.1} className="mt-12">
        <AgentFlow />
      </Reveal>
      <Reveal delay={0.15}>
        <div className="mt-5 flex flex-wrap justify-center gap-2 text-[12.5px]">
          {["Methods, never numbers", "Excluded offers refused", "Can't halve an order", "Can't approve for the Owner"].map((g) => (
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
  return (
    <section className="mx-auto max-w-[1240px] px-6 pt-32">
      <div className="grid items-center gap-8 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <SectionHeading eyebrow="3D warehouse" title="See risk where the stock sits" />
          <Reveal delay={0.1}>
            <div className="mt-6 flex flex-wrap gap-4 text-[13px] text-fg-2">
              {[
                ["bg-stockout", "Runs out"],
                ["bg-expiry", "Expiry risk"],
                ["bg-excess", "Excess"],
              ].map(([c, l]) => (
                <span key={l} className="flex items-center gap-2">
                  <span className={cn("size-2.5 rounded-sm", c)} /> {l}
                </span>
              ))}
            </div>
            <Link href="/warehouse" className="mt-6 inline-flex items-center gap-2 text-[14px] text-brand hover:underline">
              Open the warehouse <ArrowRight className="size-4" />
            </Link>
          </Reveal>
        </div>
        <TiltedWarehouse />
      </div>
    </section>
  );
}

function Impact() {
  const stats = [
    { n: 7.2, d: 1, suffix: " h", label: "saved per owner, per week", note: "estimate" },
    { n: 14.0, d: 1, suffix: "%", label: "forecast error", note: "vs 16.9% before" },
    { n: 2, d: 0, suffix: " s", label: "to plan 500 SKUs", note: "measured" },
    { n: 0, d: 0, suffix: "", label: "big POs without the Owner", note: "above ₹10 L" },
  ];
  return (
    <section id="impact" className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="Impact" title="Less time buying. Fewer empty shelves." />
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
        <p className="mt-4 text-[11.5px] text-fg-3">On synthetic demo data: 500 SKUs, 45,000 sales rows.</p>
      </Reveal>
    </section>
  );
}

function Trust() {
  const items = [
    { icon: Lock, label: "Calculated, never guessed" },
    { icon: ClipboardCheck, label: "Every action logged" },
    { icon: ShieldCheck, label: "Owner approves big orders" },
    { icon: FileWarning, label: "Nothing is emailed" },
    { icon: CircleAlert, label: "Demo data clearly labelled" },
    { icon: MessageSquareWarning, label: "Works if the AI is down" },
  ];
  return (
    <section id="trust" className="mx-auto max-w-[1240px] px-6 pt-32">
      <SectionHeading eyebrow="Safety" title="Built to be trusted" center />
      <div className="mx-auto mt-10 grid max-w-[900px] grid-cols-3 gap-3 max-md:grid-cols-2">
        {items.map((t, i) => (
          <Reveal key={t.label} delay={(i % 3) * 0.08}>
            <motion.div whileHover={{ y: -4 }} className="surface flex h-full flex-col items-center gap-3 px-4 py-6 text-center">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-healthy/10 text-healthy ring-1 ring-healthy/25">
                <t.icon className="size-5" strokeWidth={1.6} />
              </span>
              <span className="text-[14px] text-fg-1">{t.label}</span>
            </motion.div>
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
