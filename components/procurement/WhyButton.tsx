"use client";

import { useState } from "react";
import { MessageCircleQuestion } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiCall, errorMessage } from "@/lib/api/client";

type Explanation = { text: string; source: "agent" | "deterministic" };

/** "Why?" — fetches the line's explanation once, on first open, and shows it in a popover. */
export function WhyButton({ planId, lineId, sku }: { planId: string; lineId: string; sku: string }) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; text?: string; source?: string }>({ status: "idle" });

  async function load() {
    if (state.status === "loading" || state.status === "done") return;
    setState({ status: "loading" });
    try {
      const r = await apiCall<Explanation>(`/api/purchase-plans/${planId}/lines/${lineId}/explain`, "POST");
      setState({ status: "done", text: r.text, source: r.source });
    } catch (err) {
      setState({ status: "error", text: errorMessage(err) });
    }
  }

  return (
    <Popover onOpenChange={(open) => open && load()}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<button type="button" className="row-action" aria-label={`Why is ${sku} in the plan?`} />}
            />
          }
        >
          <MessageCircleQuestion className="size-4" strokeWidth={1.75} aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Why?</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[340px] border border-border-strong bg-surface-2 p-4 shadow-(--shadow-pop) ring-0">
        <p className="micro-label">Why {sku}</p>
        {state.status === "loading" || state.status === "idle" ? (
          <div className="space-y-2" aria-label="Loading explanation">
            <span className="shimmer block h-4 w-full rounded" />
            <span className="shimmer block h-4 w-4/5 rounded" />
            <span className="shimmer block h-4 w-3/5 rounded" />
          </div>
        ) : state.status === "error" ? (
          <p className="text-stockout">{state.text}</p>
        ) : (
          <>
            <p className="text-[13.5px] leading-5 text-fg-1">{state.text}</p>
            <p className="text-[11.5px] text-fg-3">{state.source === "agent" ? "Explained by PharmaOS AI from the line's evidence" : "Calculated from the line's evidence"}</p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
