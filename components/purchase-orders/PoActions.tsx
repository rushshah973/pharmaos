"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Ban, Download, Loader2, PackageCheck, Printer, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiCall, errorMessage } from "@/lib/api/client";
import type { PoStatus } from "@/lib/services/purchase-orders";
import { ReceiveGoodsDialog } from "./ReceiveGoodsDialog";

type Mode = "approve" | "reject" | null;

/** Actions by status (§10.3): Owner approve / reject, simulated send, CSV export and print. Hidden when printing. */
export function PoActions({ poId, poNumber, status, pharmaos }: { poId: string; poNumber: string; status: PoStatus; pharmaos: boolean }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [text, setText] = useState("");
  const [receiving, setReceiving] = useState(false);

  const done = (title: string, description: string) => {
    toast.success(title, { description });
    startTransition(() => router.refresh());
  };

  async function run(action: "approve" | "reject" | "send") {
    setBusy(action);
    try {
      if (action === "send") {
        await apiCall(`/api/purchase-orders/${poId}/send`, "POST");
        done(`${poNumber} marked as sent`, "Marked as sent — simulated, nothing was emailed.");
      } else if (action === "approve") {
        await apiCall(`/api/purchase-orders/${poId}/approve`, "POST", text.trim() ? { note: text.trim() } : {});
        done(`${poNumber} approved by the Owner`, "It can now be sent (simulated).");
      } else {
        await apiCall(`/api/purchase-orders/${poId}/reject`, "POST", { reason: text.trim() });
        done(`${poNumber} rejected`, "It will not be sent. Its lines stay on this PO.");
      }
      setMode(null);
      setText("");
    } catch (err) {
      toast.error(`Could not ${action} ${poNumber}`, { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  async function exportCsv() {
    setBusy("export");
    try {
      const res = await fetch(`/api/purchase-orders/${poId}/export`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? `Export failed (HTTP ${res.status}).`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${poNumber}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${poNumber}.csv downloaded`, { description: "The PO status does not change." });
    } catch (err) {
      toast.error("Could not export the CSV", { description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  const working = busy !== null || refreshing;
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Button variant="ghost" className="h-9 px-3" onClick={() => window.print()} disabled={working}>
        <Printer className="size-4" strokeWidth={1.75} aria-hidden /> Print
      </Button>
      <Button variant="outline" className="h-9 border-border-strong bg-surface-2 px-3" onClick={exportCsv} disabled={working}>
        {busy === "export" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" strokeWidth={1.75} aria-hidden />} Export CSV
      </Button>
      {pharmaos && status === "pending_approval" && (
        <>
          <Button variant="ghost" className="h-9 px-3 text-fg-2 hover:text-stockout" onClick={() => setMode("reject")} disabled={working}>
            <Ban className="size-4" strokeWidth={1.75} aria-hidden /> Reject
          </Button>
          <Button className="h-9 px-4" onClick={() => setMode("approve")} disabled={working}>
            <ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden /> Approve as Owner
          </Button>
        </>
      )}
      {(status === "sent" || status === "open") && (
        <>
          <Button className="h-9 px-4" onClick={() => setReceiving(true)} disabled={working}>
            <PackageCheck className="size-4" strokeWidth={1.75} aria-hidden />
            Receive goods
          </Button>
          {receiving && <ReceiveGoodsDialog poId={poId} poNumber={poNumber} open onOpenChange={setReceiving} />}
        </>
      )}
      {pharmaos && (status === "ready" || status === "approved") && (
        <Button className="h-9 px-4" onClick={() => run("send")} disabled={working}>
          {busy === "send" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" strokeWidth={1.75} aria-hidden />}
          Send to supplier (simulated)
        </Button>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && !busy && (setMode(null), setText(""))}>
        <DialogContent showCloseButton={!busy} className="gap-0 border border-border-strong bg-surface-2 p-0 shadow-(--shadow-pop) ring-0 sm:max-w-[440px]">
          <div className="space-y-1.5 px-6 pt-6">
            <DialogTitle className="text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">
              {mode === "approve" ? "Approve" : "Reject"} <span className="font-mono text-[14px]">{poNumber}</span> as Owner
            </DialogTitle>
            <DialogDescription className="text-fg-2">
              {mode === "approve"
                ? "This PO is above the approval limit. After your approval it can be sent (simulated — nothing is emailed)."
                : "The PO will not be sent. Its lines stay on it and are not re-planned automatically."}
            </DialogDescription>
          </div>
          <div className="space-y-2 px-6 py-5">
            <Label htmlFor="po-decision-text" className="micro-label">
              {mode === "approve" ? (
                <>
                  Note <span className="tracking-normal normal-case">(optional)</span>
                </>
              ) : (
                "Reason"
              )}
            </Label>
            <Textarea
              id="po-decision-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              autoFocus
              disabled={busy !== null}
              placeholder={mode === "approve" ? "e.g. OK for the festival week" : "e.g. Split into two smaller orders"}
              className="min-h-20 border-border-strong bg-surface-1 text-[13.5px] placeholder:text-fg-3"
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            <Button variant="ghost" className="h-9 px-4" disabled={busy !== null} onClick={() => (setMode(null), setText(""))}>
              Cancel
            </Button>
            <Button
              variant={mode === "reject" ? "destructive" : "default"}
              className="h-9 min-w-[130px] px-4"
              disabled={busy !== null || (mode === "reject" && text.trim().length < 3)}
              onClick={() => run(mode!)}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {mode === "approve" ? "Approve PO" : "Reject PO"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
