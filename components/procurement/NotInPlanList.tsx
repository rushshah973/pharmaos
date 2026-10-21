"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { type PillStatus, StatusPill } from "@/components/layout/StatusPill";
import { apiCall, errorMessage } from "@/lib/api/client";
import { REASON_TEXT, deferReasonText } from "@/lib/format/codes";
import { dec, formatINR } from "@/lib/money";
import type { LineView, PlanStatus } from "@/lib/services/plans";

type Kind = { tone: PillStatus; label: string; restorable: boolean };

function kindOf(l: LineView): Kind {
  if (l.status === "rejected") return { tone: "stockout", label: "Rejected", restorable: true };
  if (l.status === "deferred") return { tone: "neutral", label: "Deferred", restorable: true };
  if (l.status === "edited") return { tone: "expiry", label: "Edit blocked", restorable: false };
  return { tone: "neutral", label: "No eligible offer", restorable: false };
}

/** Lines the plan does not buy: owner-deferred / rejected (restorable), edits that now fail a hard stop, SKUs with no offer. */
export function NotInPlanList({ planId, planStatus, lines }: { planId: string; planStatus: PlanStatus; lines: LineView[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const locked = planStatus === "approved" || planStatus === "rejected";
  if (lines.length === 0) return null;

  async function restore(l: LineView) {
    setBusy(l.id);
    try {
      await apiCall(`/api/purchase-plans/${planId}/lines/${l.id}`, "PATCH", { status: "proposed" });
      toast.success(`${l.sku} restored`, { description: "Back in the plan; the totals and supplier POs are updated." });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error(`Could not restore ${l.sku}`, { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="surface overflow-hidden" aria-label="Not in this plan">
      <header className="px-5 pt-5 pb-4">
        <h2 className="text-[15px] leading-[22px] font-semibold text-fg-1">Not in this plan</h2>
        <p className="text-fg-2">Deferred or rejected by you, and SKUs that need stock but have no supplier offer that can be used.</p>
      </header>
      <ul className="border-t border-border">
        {lines.map((l) => {
          const k = kindOf(l);
          const why =
            l.status === "proposed" ? REASON_TEXT.NO_ELIGIBLE_OFFER.meaning : (deferReasonText(l.deferReason) ?? "No reason given");
          const risk = dec(l.lossPrevented).greaterThan(0);
          return (
            <li key={l.id} className="flex min-h-14 items-center gap-4 border-b border-border px-5 py-2.5 last:border-b-0">
              <div className="w-[230px] shrink-0">
                <div className="font-mono text-[12.5px] text-fg-1">{l.sku}</div>
                <div className="truncate text-[12.5px] text-fg-2">
                  {l.brandName} · {l.strength}
                </div>
              </div>
              <StatusPill status={k.tone} className="shrink-0">
                {k.label}
              </StatusPill>
              <p className="min-w-0 flex-1 truncate text-fg-2" title={why}>
                {why}
              </p>
              <div className="w-[130px] shrink-0 text-right">
                <div className="num text-fg-1">{risk ? formatINR(l.lossPrevented) : "—"}</div>
                <div className="text-[11.5px] text-fg-3">loss left uncovered</div>
              </div>
              <div className="w-[96px] shrink-0 text-right">
                {k.restorable && (
                  <button
                    type="button"
                    disabled={locked || busy !== null}
                    onClick={() => restore(l)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-surface-2 px-3 text-[12.5px] font-medium text-fg-1 transition-colors duration-150 hover:bg-surface-3 disabled:opacity-50"
                  >
                    {busy === l.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
                    Restore
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
