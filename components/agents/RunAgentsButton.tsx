"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { ApiError, apiCall, errorMessage } from "@/lib/api/client";
import type { AgentRun } from "@/lib/services/agent-runs";
import { AgentRunPanel } from "./AgentRunPanel";

/**
 * "Run procurement agents" (§9.5): POST /api/agents/run, then the Agent Run panel follows the run live. Disabled
 * while a run is active on this plan (the latest run is checked on load) or when the plan is locked.
 */
export function RunAgentsButton({ planId, locked = false, className }: { planId: string; locked?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);

  // A run already going on this plan (another tab, or before a reload): follow it instead of starting one.
  useEffect(() => {
    let stop = false;
    fetch(`/api/agents/runs?planId=${planId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { runs: AgentRun[] } | null) => {
        if (stop || !j) return;
        const latest = j.runs[0];
        if (latest) setRunId((id) => id ?? latest.id);
        if (latest?.status === "running") setActive(true);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [planId]);

  async function start() {
    if (active) {
      setOpen(true);
      return;
    }
    setStarting(true);
    try {
      const { runId: id } = await apiCall<{ runId: string }>("/api/agents/run", "POST", { planId });
      setRunId(id);
      setActive(true);
      setOpen(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "RUN_IN_PROGRESS") {
        toast.error("The agents are already running on this plan", { description: "Open the panel to follow that run." });
        setActive(true);
      } else if (err instanceof ApiError && err.code === "PLAN_LOCKED") {
        toast.error("This plan is locked", { description: err.message });
      } else {
        toast.error("Could not start the agents", { description: errorMessage(err) });
      }
    } finally {
      setStarting(false);
    }
  }

  const onFinished = useCallback(() => setActive(false), []);

  return (
    <>
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={start}
          disabled={locked || starting}
          title={locked ? "The plan is approved or rejected: the agents cannot change it." : active ? "The agents are running: open the live trace" : undefined}
          className={cn(
            "glass-pill inline-flex h-9 items-center gap-2 px-4 text-[13px] text-fg-1 transition-colors hover:bg-white/[0.09] disabled:pointer-events-none disabled:opacity-50",
            active && "border-expiry/30 text-expiry",
            className,
          )}
        >
          {starting || active ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Bot className="size-4 text-brand" strokeWidth={1.6} aria-hidden />}
          {active ? "Agents running…" : "Run procurement agents"}
        </button>
        {!active && runId && (
          <button type="button" onClick={() => setOpen(true)} className="rounded-full px-2.5 py-2 text-[12px] text-fg-3 transition-colors hover:text-fg-1">
            Past runs
          </button>
        )}
      </span>
      <AgentRunPanel planId={planId} runId={runId} open={open} onOpenChange={setOpen} onSelectRun={setRunId} onFinished={onFinished} follow={active} />
    </>
  );
}
