"use client";

// The AI plan summary above the Impact Card (§9.1). The agent writes it after the plan is created (non-blocking):
// while it is pending the card polls the plan for up to 90 s; without a key, or if the agent failed, nothing shows.
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { PlanSummary } from "@/lib/services/plans";
import { formatDateTime } from "@/lib/format/date";
import { RichText, SourceTag } from "./RichText";

type Summary = PlanSummary["aiSummary"];
const POLL_MS = 3000;
const POLL_FOR_MS = 90_000;

export function PlanSummaryCard({ planId, initial }: { planId: string; initial: Summary }) {
  const [summary, setSummary] = useState<Summary>(initial);
  const pending = summary?.status === "pending";

  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const res = await fetch(`/api/purchase-plans/${planId}`);
        const plan = (await res.json()) as { aiSummary?: Summary };
        if (plan.aiSummary?.status !== "pending" || Date.now() - started > POLL_FOR_MS) {
          setSummary(plan.aiSummary?.status === "pending" ? null : (plan.aiSummary ?? null));
          return;
        }
      } catch {
        // keep polling until the window closes
      }
      if (Date.now() - started > POLL_FOR_MS) return setSummary(null);
      setTimeout(tick, POLL_MS);
    };
    const t = setTimeout(tick, POLL_MS);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [pending, planId]);

  if (!summary) return null;
  return (
    <section className="surface px-5 py-4" aria-label="Plan summary" aria-busy={pending}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles className="size-4 text-brand" strokeWidth={1.75} aria-hidden />
        <h2 className="text-[13.5px] font-semibold text-fg-1">Plan summary</h2>
        {pending ? (
          <span className="text-[12px] text-fg-3">PharmaOS AI is writing it from the plan&apos;s data…</span>
        ) : (
          <>
            <SourceTag source="agent" />
            {summary.createdAt && (
              <span className="text-[11.5px] text-fg-3" title="Written once, when the plan was created. Later edits, recalculations and agent runs are not in it.">
                Written {formatDateTime(summary.createdAt)}, when the plan was created; later changes are not in it
              </span>
            )}
          </>
        )}
      </div>
      {pending ? (
        <div className="space-y-2">
          <span className="shimmer block h-4 w-full rounded" />
          <span className="shimmer block h-4 w-11/12 rounded" />
          <span className="shimmer block h-4 w-3/5 rounded" />
        </div>
      ) : (
        <RichText text={summary.text ?? ""} planId={planId} />
      )}
    </section>
  );
}
