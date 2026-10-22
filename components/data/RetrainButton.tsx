"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { apiCall, errorMessage } from "@/lib/api/client";

const pct = (x: number | null | undefined) => (typeof x === "number" ? `${(x * 100).toFixed(1)}%` : "n/a");

/** Retrains the demand model on the current sales (the training service audits model.trained). */
export function RetrainButton() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function retrain() {
    setBusy(true);
    try {
      const r = await apiCall<{ metrics: { horizon?: { blend: number | null } }; ms: number }>("/api/forecast-model/train", "POST", {});
      toast.success("Demand model retrained", { description: `14-day demand error ${pct(r.metrics.horizon?.blend)} · ${(r.ms / 1000).toFixed(0)} s` });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Could not retrain the model", { description: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" onClick={retrain} disabled={busy} className="glass-pill inline-flex h-9 items-center gap-2 px-4 text-[13px] text-fg-1 hover:bg-white/[0.09] disabled:opacity-60">
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
      {busy ? "Training…" : "Retrain"}
    </button>
  );
}
