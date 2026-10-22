"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiCall, errorMessage } from "@/lib/api/client";
import { formatINR } from "@/lib/money";

/** The Owner approval limit (default ₹4,00,000): a supplier PO above it waits for the Owner. PATCH /api/settings. */
export function ApprovalLimitForm({ current }: { current: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [value, setValue] = useState(String(Math.round(Number(current))));
  const [saving, setSaving] = useState(false);
  const n = Number(value.replace(/[,\s₹]/g, ""));
  const valid = Number.isFinite(n) && n > 0 && n <= 1e9;
  const changed = valid && n !== Math.round(Number(current));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!changed) return;
    setSaving(true);
    try {
      await apiCall("/api/settings", "PATCH", { poApprovalLimit: n });
      toast.success("Owner approval limit updated", { description: `POs above ${formatINR(n, { paise: false })} now need the Owner before they can be sent.` });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Could not update the limit", { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="surface flex flex-col p-6" aria-label="Owner approval limit">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] leading-6 tracking-[-0.015em] text-fg-1">Owner approval limit</h2>
          <p className="text-[12.5px] text-fg-3">A supplier PO above this waits for the Owner before it can be sent. Changes are audited.</p>
        </div>
        <span className="glass-pill flex size-9 items-center justify-center text-brand">
          <ShieldCheck className="size-4" strokeWidth={1.6} aria-hidden />
        </span>
      </div>
      <div className="display mt-5 text-[40px] leading-[44px] text-fg-1">{formatINR(current, { paise: false })}</div>
      <label htmlFor="approval-limit" className="micro-label mt-5">
        New limit (₹)
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="approval-limit"
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={!valid}
          className="num h-10 min-w-0 flex-1 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[14px] text-fg-1 outline-none focus:border-brand/60"
        />
        <button type="submit" disabled={!changed || saving} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-40">
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save
        </button>
      </div>
      {!valid && <p className="mt-1.5 text-[12px] text-stockout">Enter an amount in rupees above zero.</p>}
      {valid && changed && <p className="mt-1.5 text-[12px] text-fg-3">New limit: {formatINR(n, { paise: false })}</p>}
    </form>
  );
}
