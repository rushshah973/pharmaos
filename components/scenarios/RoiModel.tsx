"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Slider } from "@/components/ui/slider";

/**
 * The business case (problemstatement.md §11) as an editable, illustrative model: every assumption is a slider
 * and the totals update live. The defaults reproduce §11 (≈ ₹11.6 L a year + ₹25 L one-time cash). These are
 * assumptions, not measured results.
 */
type Key = keyof typeof DEFAULTS;
const DEFAULTS = {
  purchasesCr: 18,
  writeOffPct: 1,
  writeOffCutPct: 25,
  lostRevenueL: 80,
  marginPct: 9,
  recoveredPct: 25,
  inventoryCr: 2.5,
  inventoryDays: 50,
  daysSaved: 5,
  costOfCapitalPct: 14,
  hoursSavedPerDay: 1.2,
  workingDays: 300,
  hourlyValue: 500,
  subscriptionPerMonth: 5000,
};

const FIELDS: { key: Key; label: string; min: number; max: number; step: number; unit: (v: number) => string }[][] = [
  [
    { key: "purchasesCr", label: "Annual purchases", min: 2, max: 100, step: 1, unit: (v) => `₹${v} Cr` },
    { key: "writeOffPct", label: "Expiry write-off today", min: 0.2, max: 10, step: 0.1, unit: (v) => `${v.toFixed(1)}% of purchases` },
    { key: "writeOffCutPct", label: "Fewer write-offs with PharmaOS", min: 0, max: 60, step: 5, unit: (v) => `${v}%` },
  ],
  [
    { key: "lostRevenueL", label: "Revenue lost to stock-outs", min: 0, max: 400, step: 5, unit: (v) => `₹${v} L / year` },
    { key: "marginPct", label: "Gross margin", min: 3, max: 25, step: 0.5, unit: (v) => `${v}%` },
    { key: "recoveredPct", label: "Lost sales recovered", min: 0, max: 60, step: 5, unit: (v) => `${v}%` },
  ],
  [
    { key: "inventoryCr", label: "Inventory held", min: 0.5, max: 20, step: 0.5, unit: (v) => `₹${v} Cr` },
    { key: "inventoryDays", label: "Inventory days today", min: 15, max: 120, step: 1, unit: (v) => `${v} days` },
    { key: "daysSaved", label: "Inventory days removed", min: 0, max: 20, step: 1, unit: (v) => `${v} days` },
    { key: "costOfCapitalPct", label: "Cost of capital", min: 6, max: 24, step: 0.5, unit: (v) => `${v}%` },
  ],
  [
    { key: "hoursSavedPerDay", label: "Owner time saved", min: 0, max: 4, step: 0.1, unit: (v) => `${v.toFixed(1)} h / day` },
    { key: "workingDays", label: "Working days", min: 250, max: 365, step: 5, unit: (v) => `${v} / year` },
    { key: "hourlyValue", label: "Value of the Owner's hour", min: 100, max: 3000, step: 50, unit: (v) => `₹${v}` },
  ],
];

const GROUPS = ["Expiry write-off", "Lost sales", "Working capital", "Purchasing time"];

/** "₹4.5 L" / "₹1.2 Cr": the scale the business case is read in. */
function lakh(rupees: number): string {
  if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)} Cr`;
  return `₹${(rupees / 1e5).toFixed(1)} L`;
}

export function RoiModel() {
  const [a, setA] = useState(DEFAULTS);
  const set = (key: Key) => (v: number | readonly number[]) => setA((prev) => ({ ...prev, [key]: Array.isArray(v) ? v[0] : (v as number) }));

  const r = useMemo(() => {
    const expiry = a.purchasesCr * 1e7 * (a.writeOffPct / 100) * (a.writeOffCutPct / 100);
    const lost = a.lostRevenueL * 1e5 * (a.marginPct / 100) * (a.recoveredPct / 100);
    const released = ((a.inventoryCr * 1e7) / a.inventoryDays) * a.daysSaved;
    const capital = released * (a.costOfCapitalPct / 100);
    const time = a.hoursSavedPerDay * a.workingDays * a.hourlyValue;
    const annual = expiry + lost + capital + time;
    const paybackMonths = annual > 0 ? a.subscriptionPerMonth / (annual / 12) : Infinity;
    return { values: [expiry, lost, capital, time], annual, released, paybackMonths };
  }, [a]);

  const payback = !Number.isFinite(r.paybackMonths) ? "never" : r.paybackMonths < 1 ? `${Math.max(1, Math.round(r.paybackMonths * 30))} days` : `${r.paybackMonths.toFixed(1)} months`;

  return (
    <section className="surface p-6" aria-label="ROI model">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] leading-6 tracking-[-0.015em] text-fg-1">ROI model</h2>
          <p className="text-[12.5px] text-expiry">Illustrative model — edit the assumptions</p>
          <p className="mt-0.5 text-[12.5px] text-fg-3">The business case from the problem statement, for a typical stockist. Assumptions, not measured results.</p>
        </div>
        <button type="button" onClick={() => setA(DEFAULTS)} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] text-fg-3 hover:text-fg-1">
          <RotateCcw className="size-3.5" aria-hidden /> Reset assumptions
        </button>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_320px] gap-8 max-lg:grid-cols-1">
        <div className="grid grid-cols-2 gap-x-8 gap-y-7 max-md:grid-cols-1">
          {FIELDS.map((group, gi) => (
            <fieldset key={GROUPS[gi]} className="space-y-4">
              <legend className="mb-3 flex w-full items-baseline justify-between">
                <span className="micro-label">{GROUPS[gi]}</span>
                <span className="num text-[13px] text-fg-1">{lakh(r.values[gi])} / yr</span>
              </legend>
              {group.map((f) => (
                <div key={f.key}>
                  <div className="mb-2 flex items-baseline justify-between gap-3 text-[12.5px]">
                    <label id={`roi-${f.key}`} className="text-fg-2">
                      {f.label}
                    </label>
                    <span className="num text-fg-1">{f.unit(a[f.key])}</span>
                  </div>
                  <Slider aria-labelledby={`roi-${f.key}`} min={f.min} max={f.max} step={f.step} value={[a[f.key]]} onValueChange={set(f.key)} />
                </div>
              ))}
            </fieldset>
          ))}
        </div>

        <aside className="surface-warm flex flex-col p-6">
          <p className="micro-label text-white/60">Annual value</p>
          <p className="display mt-2 text-[48px] leading-[52px] text-white">{lakh(r.annual)}</p>
          <p className="mt-1 text-[12.5px] text-white/60">a year, plus {lakh(r.released)} of cash released once from inventory</p>
          <ul className="mt-6 space-y-2 text-[12.5px]">
            {GROUPS.map((g, i) => (
              <li key={g} className="flex justify-between gap-3 border-b border-white/10 pb-2 last:border-0">
                <span className="text-white/70">{g}</span>
                <span className="num text-white">{lakh(r.values[i])}</span>
              </li>
            ))}
          </ul>
          <div className="mt-auto pt-6">
            <div className="mb-2 flex items-baseline justify-between text-[12.5px]">
              <label id="roi-subscription" className="text-white/70">
                Subscription
              </label>
              <span className="num text-white">₹{a.subscriptionPerMonth.toLocaleString("en-IN")} / month</span>
            </div>
            <Slider aria-labelledby="roi-subscription" min={1000} max={50000} step={500} value={[a.subscriptionPerMonth]} onValueChange={set("subscriptionPerMonth")} />
            <p className="mt-4 text-[13px] text-white">
              Payback in <span className="num">{payback}</span>
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
