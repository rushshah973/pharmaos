"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type ReasonTarget = { lineId: string; sku: string; brand: string; status: "deferred" | "rejected" };

/** Defer or reject a line: a reason (3+ characters) is required and saved to the audit log. */
export function ReasonDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: ReasonTarget | null;
  onClose: () => void;
  onSubmit: (target: ReasonTarget, reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const defer = target?.status === "deferred";
  const valid = reason.trim().length >= 3;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target || !valid) return;
    setPending(true);
    const ok = await onSubmit(target, reason.trim());
    setPending(false);
    if (ok) {
      setReason("");
      onClose();
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && !pending && (setReason(""), onClose())}>
      <DialogContent
        showCloseButton={!pending}
        className="gap-0 border border-border-strong bg-surface-2 p-0 shadow-[0_12px_32px_rgba(0,0,0,0.45)] ring-0 sm:max-w-[440px]"
      >
        <form onSubmit={submit}>
          <div className="space-y-1.5 px-6 pt-6">
            <DialogTitle className="text-[15px] leading-[22px] font-semibold text-fg-1">
              {defer ? "Defer" : "Reject"} <span className="font-mono text-[14px]">{target?.sku}</span>
            </DialogTitle>
            <DialogDescription className="text-fg-2">
              {target?.brand}.{" "}
              {defer
                ? "The line leaves this plan for now; you can restore it later."
                : "The line is removed from this plan and stays out when the plan is recalculated."}
            </DialogDescription>
          </div>
          <div className="space-y-2 px-6 py-5">
            <Label htmlFor="line-reason" className="micro-label">
              Reason
            </Label>
            <Textarea
              id="line-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              autoFocus
              disabled={pending}
              placeholder={defer ? "e.g. Branch transfer arriving on Friday" : "e.g. Discontinued by the manufacturer"}
              className="min-h-20 border-border-strong bg-surface-1 text-[13.5px] placeholder:text-fg-3"
            />
            <p className="text-[12px] text-fg-3">Required · saved with the line and in the activity log.</p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" className="h-9 px-4" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={defer ? "default" : "destructive"} className="h-9 min-w-[120px] px-4" disabled={pending || !valid}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {defer ? "Defer line" : "Reject line"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
