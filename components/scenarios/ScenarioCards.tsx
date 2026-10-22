"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CloudRain, FlaskConical, Loader2, PackageMinus, RefreshCw, RotateCcw, TimerOff, TrendingUp, Truck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { apiCall, errorMessage } from "@/lib/api/client";
import type { ScenarioView } from "@/lib/services/scenarios";

const ICON = { baseline: FlaskConical, demand_spike: TrendingUp, supplier_delay: Truck, seasonal_surge: CloudRain, expiry_risk: TimerOff } as const;

/** What the scenario changes (in memory) and what to look for after a recalculation (§12). */
function effect(s: ScenarioView): { change: string; result: string } {
  const p = s.params as Record<string, unknown>;
  switch (s.id) {
    case "demand_spike":
      return { change: `Last ${p.days ?? 5} days of sales × ${p.multiplier ?? 3} for the 3 demo spike SKUs.`, result: "Higher demand, lower cover, larger quantities, higher rank; the demand-spike flag." };
    case "supplier_delay":
      return {
        change: `The preferred supplier${p.supplier_code ? ` (${p.supplier_code})` : ""}: lead time +${p.lead_time_add_days ?? 5} days, prices +${p.price_change_pct ?? 8}%.`,
        result: "Suppliers re-rank; urgent lines move to a faster supplier.",
      };
    case "seasonal_surge":
      return {
        change: `Monsoon fever season: last ${p.days ?? 10} days of sales × ${p.multiplier ?? 4} for ${Array.isArray(p.categories) ? (p.categories as string[]).join(", ") : "analgesic, antibiotic, respiratory"}.`,
        result: "The live ML forecast rises; larger quantities; a supplier PO crosses the Owner limit.",
      };
    case "expiry_risk":
      return {
        change: `The largest batch of ${typeof p.sku === "string" ? p.sku : "a demo expiry SKU"} now expires ${p.days_to_expiry ?? 92} days after the as-of date.`,
        result: "A little of it still sells before the 90-day sell-by window; the rest is at expiry risk, the reorder is capped and its bin turns amber.",
      };
    default:
      return { change: "No changes: the seeded data as it is.", result: "The reference numbers every scenario is compared with." };
  }
}

/**
 * The five scenarios (§12, §10.3). Run makes one active (applied in memory on the next load, audited); Reset
 * returns to the baseline. After a Run, "Recalculate current plan" reruns the engine on the changed data.
 */
export function ScenarioCards({ scenarios, active, latestPlanId }: { scenarios: ScenarioView[]; active: string; latestPlanId: string | null }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [justRan, setJustRan] = useState<string | null>(null);
  // Right after a click the server props are still the old ones; the banner speaks about the scenario clicked.
  const shownId = justRan ?? active;
  const activeName = scenarios.find((s) => s.id === shownId)?.name ?? shownId;

  async function run(id: string) {
    setBusy(id);
    try {
      await apiCall(id === "baseline" ? "/api/scenarios/reset" : `/api/scenarios/${id}/run`, "POST", {});
      setJustRan(id);
      toast.success(id === "baseline" ? "Back to the baseline" : `Scenario running: ${scenarios.find((s) => s.id === id)?.name}`, {
        description: "Applied in memory; the seed data is unchanged. Recalculate the plan to see the new numbers.",
      });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Could not change the scenario", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function recalculate() {
    if (!latestPlanId) return;
    setBusy("recalc");
    try {
      await apiCall(`/api/purchase-plans/${latestPlanId}/recalculate`, "POST", {});
      toast.success("Plan recalculated", { description: `Fresh numbers under ${activeName}.`, action: { label: "Open plan", onClick: () => router.push(`/procurement/${latestPlanId}`) } });
      setJustRan(null);
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Could not recalculate the plan", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Scenarios" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h2 className="text-[24px] leading-8 font-light tracking-[-0.03em] text-fg-1">Scenarios</h2>
          <p className="text-[12.5px] text-fg-3">What-if changes applied in memory on top of the seeded data. Reset is instant and the seed is never changed.</p>
        </div>
        {active !== "baseline" && (
          <button type="button" onClick={() => run("baseline")} disabled={busy !== null} className="glass-pill inline-flex h-9 items-center gap-2 px-4 text-[13px] text-fg-1 hover:bg-white/[0.09] disabled:opacity-50">
            {busy === "baseline" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
            Reset to baseline
          </button>
        )}
      </div>

      {justRan !== null && (
        <div className="surface-warm flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <p className="text-[13.5px] text-white">
            {shownId === "baseline" ? "Baseline restored." : `${activeName} is active.`}{" "}
            <span className="text-white/65">{latestPlanId ? "Recalculate the current plan to see the new numbers." : "Create a plan to see its effect."}</span>
          </p>
          {latestPlanId && (
            <span className="flex items-center gap-2">
              <button type="button" onClick={recalculate} disabled={busy !== null} className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-60">
                {busy === "recalc" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
                Recalculate current plan
              </button>
              <Link href={`/procurement/${latestPlanId}`} className="text-[12.5px] text-white/70 hover:text-white">
                Open plan
              </Link>
            </span>
          )}
        </div>
      )}

      {scenarios.length === 0 && (
        <p className="surface px-5 py-6 text-fg-2">No scenarios are set up. Run the database migrations (npm run db:migrate) to add the five demo scenarios.</p>
      )}
      <div className="grid grid-cols-5 gap-4 max-xl:grid-cols-3 max-lg:grid-cols-2 max-md:grid-cols-1">
        {scenarios.map((s) => {
          const Icon = ICON[s.id as keyof typeof ICON] ?? PackageMinus;
          const isActive = s.id === active;
          const e = effect(s);
          return (
            <article key={s.id} className={cn("flex min-h-[220px] flex-col p-5", isActive ? "surface-hero ring-1 ring-brand/30" : "surface")}>
              <header className="flex items-start justify-between gap-3">
                <span className="glass-pill flex size-10 items-center justify-center text-fg-2">
                  <Icon className={cn("size-[18px]", isActive && "text-brand")} strokeWidth={1.5} aria-hidden />
                </span>
                {isActive && <span className="rounded-full border border-brand/30 bg-brand-glow px-2.5 text-[12px] leading-6 text-brand">Active</span>}
              </header>
              <h3 className="mt-4 text-[17px] leading-6 tracking-[-0.015em] text-fg-1">{s.name}</h3>
              <p className="mt-1 text-[12.5px] leading-[18px] text-fg-2">{e.change}</p>
              <p className="mt-1.5 text-[12px] leading-[17px] text-fg-3">{e.result}</p>
              <div className="mt-auto pt-4">
                {isActive ? (
                  s.id === "baseline" ? (
                    <span className="text-[12.5px] text-fg-3">The data as seeded.</span>
                  ) : (
                    <button type="button" onClick={() => run("baseline")} disabled={busy !== null} className="glass-pill inline-flex h-9 items-center gap-2 px-4 text-[13px] text-fg-1 hover:bg-white/[0.09] disabled:opacity-50">
                      {busy === "baseline" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
                      Reset
                    </button>
                  )
                ) : (
                  <button type="button" onClick={() => run(s.id)} disabled={busy !== null} className="inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-[13px] font-medium text-black transition-colors hover:bg-white/90 disabled:opacity-50">
                    {busy === s.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
                    {s.id === "baseline" ? "Use baseline" : "Run scenario"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
