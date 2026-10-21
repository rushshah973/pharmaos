"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiCall, errorMessage } from "@/lib/api/client";

/** Re-plan with fresh data and the active scenario (§7.5). Owner edits, deferrals and rejections are kept. */
export function RecalculateButton({ planId, disabled }: { planId: string; disabled?: boolean }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [pending, setPending] = useState(false);
  const busy = pending || refreshing;

  async function run() {
    setPending(true);
    try {
      await apiCall(`/api/purchase-plans/${planId}/recalculate`, "POST", {});
      toast.success("Plan recalculated", { description: "Fresh stock, demand and offers. Your edits, deferrals and rejections were kept." });
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Could not recalculate the plan", { description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" className="h-9 border-border-strong bg-surface-2 px-4" disabled={disabled || busy} onClick={run}>
      <RefreshCw className={busy ? "size-4 animate-spin" : "size-4"} strokeWidth={1.75} aria-hidden />
      {busy ? "Recalculating…" : "Recalculate"}
    </Button>
  );
}
