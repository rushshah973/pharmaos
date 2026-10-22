"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** "Create Purchase Plan" (§10.3): optional priority text → POST /api/procurement/analyze → the new plan. */
export function CreatePlanDialog({
  variant = "default",
  label = "Create Purchase Plan",
  className,
}: {
  variant?: "default" | "outline";
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [priorities, setPriorities] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      const res = await fetch("/api/procurement/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(priorities.trim() ? { priorities: priorities.trim() } : {}),
      });
      const body = (await res.json().catch(() => null)) as { planId?: string; error?: { message?: string } } | null;
      if (!res.ok || !body?.planId) throw new Error(body?.error?.message ?? `The plan could not be created (HTTP ${res.status}).`);
      toast.success("Purchase plan created", { description: "Every line is ranked and explained." });
      router.push(`/procurement/${body.planId}`);
      setOpen(false);
      setPriorities("");
    } catch (err) {
      toast.error("Could not create the plan", { description: err instanceof Error ? err.message : "Check the connection and try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger render={<Button variant={variant} className={cn("h-9 px-4", className)} />}>
        <Sparkles className="size-4" strokeWidth={1.75} aria-hidden />
        {label}
      </DialogTrigger>
      <DialogContent
        showCloseButton={!pending}
        className="gap-0 border border-border-strong bg-surface-2 p-0 shadow-(--shadow-pop) ring-0 sm:max-w-[480px]"
      >
        <form onSubmit={submit}>
          <div className="space-y-1.5 px-6 pt-6">
            <DialogTitle className="text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">Create purchase plan</DialogTitle>
            <DialogDescription className="text-fg-2">
              PharmaOS checks every active SKU against demand, stock, expiry and supplier offers, then ranks what to buy first.
              Purchase orders above the Owner approval limit will need approval before they are sent.
            </DialogDescription>
          </div>
          <div className="space-y-2 px-6 py-5">
            <Label htmlFor="plan-priorities" className="micro-label">
              Priorities <span className="tracking-normal normal-case">(optional)</span>
            </Label>
            <Textarea
              id="plan-priorities"
              value={priorities}
              onChange={(e) => setPriorities(e.target.value)}
              maxLength={500}
              disabled={pending}
              placeholder="e.g. Keep life-saving and cold-chain SKUs stocked before the festival week"
              className="min-h-24 border-border-strong bg-surface-1 text-[13.5px] placeholder:text-fg-3"
            />
            <p className="text-[12px] text-fg-3">Saved with the plan for the record; the ranking itself is calculated.</p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            <Button type="button" variant="ghost" className="h-9 px-4" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" className="h-9 min-w-[176px] px-4" disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Analysing SKUs…
                </>
              ) : (
                <>
                  <Sparkles className="size-4" strokeWidth={1.75} aria-hidden />
                  Create plan
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
