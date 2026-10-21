"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiCall, errorMessage } from "@/lib/api/client";

/** Reject the whole plan (reason required). No purchase orders are created from a rejected plan. */
export function RejectPlanButton({ planId, disabled }: { planId: string; disabled?: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const valid = reason.trim().length >= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setPending(true);
    try {
      await apiCall(`/api/purchase-plans/${planId}/reject`, "POST", { reason: reason.trim() });
      toast.success("Plan rejected", { description: "No purchase orders will be created from it." });
      setOpen(false);
      setReason("");
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error("Could not reject the plan", { description: errorMessage(err) });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="ghost" className="h-9 px-3 text-fg-2 hover:text-stockout" disabled={disabled} onClick={() => setOpen(true)}>
        <Ban className="size-4" strokeWidth={1.75} aria-hidden /> Reject plan
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent showCloseButton={!pending} className="gap-0 border border-border-strong bg-surface-2 p-0 shadow-(--shadow-pop) ring-0 sm:max-w-[440px]">
          <form onSubmit={submit}>
            <div className="space-y-1.5 px-6 pt-6">
              <DialogTitle className="text-[15px] leading-[22px] font-semibold text-fg-1">Reject this plan</DialogTitle>
              <DialogDescription className="text-fg-2">The plan is closed and no purchase orders are created from it. POs already created stay as they are.</DialogDescription>
            </div>
            <div className="space-y-2 px-6 py-5">
              <Label htmlFor="plan-reject-reason" className="micro-label">
                Reason
              </Label>
              <Textarea
                id="plan-reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                autoFocus
                disabled={pending}
                placeholder="e.g. Waiting for the new price list from distributors"
                className="min-h-20 border-border-strong bg-surface-1 text-[13.5px] placeholder:text-fg-3"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
              <Button type="button" variant="ghost" className="h-9 px-4" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" className="h-9 min-w-[120px] px-4" disabled={pending || !valid}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Reject plan
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
