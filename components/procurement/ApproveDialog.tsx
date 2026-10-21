"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ApiError, apiCall, errorMessage } from "@/lib/api/client";
import { supplierTotals } from "@/lib/business-logic/totals";
import { formatINR, sumMoney } from "@/lib/money";
import type { ApproveResult } from "@/lib/services/approval";
import type { LineView } from "@/lib/services/plans";

type Failure = { lineId: string; sku: string; codes: string[] };

/**
 * Approve selected lines into purchase orders (§10.3). A fresh idempotency key is made each time the dialog
 * opens, so a double click or a retry can never create POs twice. The dialog shows the POs that will be
 * created, one per supplier, and which will need Owner approval (above the limit).
 */
export function ApproveDialog({
  planId,
  lines,
  approvalLimit,
  disabled,
  onApproved,
}: {
  planId: string;
  lines: LineView[];
  approvalLimit: string;
  disabled: boolean;
  onApproved: () => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);

  const pos = useMemo(() => {
    const names = new Map(lines.map((l) => [l.supplierId, { code: l.supplierCode ?? "", name: l.supplierName ?? "" }]));
    return supplierTotals(
      lines.map((l) => ({ supplierId: l.supplierId, lineTotal: l.totals.lineTotal, inBasket: true, status: l.status })),
      approvalLimit,
    ).map((t) => ({ ...t, ...names.get(t.supplierId)! }));
  }, [lines, approvalLimit]);
  const total = sumMoney(lines.map((l) => l.totals.lineTotal)).toFixed(2);
  const limit = formatINR(approvalLimit, { paise: false });

  function openDialog(next: boolean) {
    if (pending) return;
    if (next) {
      setKey(crypto.randomUUID());
      setFailures([]);
    }
    setOpen(next);
  }

  async function approve() {
    setPending(true);
    setFailures([]);
    try {
      const res = await apiCall<ApproveResult>(`/api/purchase-plans/${planId}/approve`, "POST", { lineIds: lines.map((l) => l.id), idempotencyKey: key });
      const waiting = res.purchaseOrders.filter((p) => p.status === "pending_approval").length;
      toast.success(`${res.purchaseOrders.length} purchase order${res.purchaseOrders.length === 1 ? "" : "s"} created`, {
        description: (
          <span className="flex flex-col gap-0.5">
            {res.purchaseOrders.map((p) => (
              <Link key={p.id} href={`/purchase-orders/${p.id}`} className="text-brand hover:underline">
                {p.poNumber} · {p.supplierCode} · {formatINR(p.grandTotal, { paise: false })}
                {p.status === "pending_approval" ? " · needs Owner approval" : " · ready to send"}
              </Link>
            ))}
            {waiting > 0 && <span className="text-fg-3">POs above {limit} wait for the Owner before they can be sent.</span>}
          </span>
        ),
        duration: 10000,
      });
      setOpen(false);
      onApproved();
      startTransition(() => router.refresh());
    } catch (err) {
      if (err instanceof ApiError && err.code === "HARD_STOP") {
        setFailures(((err.details as { failures?: Failure[] })?.failures ?? []) as Failure[]);
      } else {
        toast.error("Could not approve the lines", { description: errorMessage(err) });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button className="h-9 px-4" disabled={disabled} onClick={() => openDialog(true)}>
        <ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden />
        Approve selected
      </Button>
      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent
          showCloseButton={!pending}
          className="gap-0 border border-border-strong bg-surface-2 p-0 shadow-(--shadow-pop) ring-0 sm:max-w-[540px]"
        >
          <div className="space-y-1.5 px-6 pt-6">
            <DialogTitle className="text-[15px] leading-[22px] font-semibold text-fg-1">Create purchase orders</DialogTitle>
            <DialogDescription className="text-fg-2">
              {lines.length} line{lines.length === 1 ? "" : "s"} · {formatINR(total)}. One PO per supplier; each line is re-checked against fresh stock, prices
              and quotes first.
            </DialogDescription>
          </div>
          <ul className="mx-6 mt-4 divide-y divide-border rounded-lg border border-border bg-surface-1">
            {pos.map((po) => (
              <li key={po.supplierId} className="flex items-center gap-3 px-4 py-3">
                <span className="font-mono text-[12.5px] text-fg-1">{po.code}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">
                  {po.name} · {po.lines} line{po.lines === 1 ? "" : "s"}
                </span>
                {po.needsApproval ? (
                  <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-expiry-bg px-2 text-[11.5px] font-medium text-expiry">
                    <ShieldAlert className="size-3" aria-hidden /> Owner approval
                  </span>
                ) : (
                  <span className="text-[11.5px] text-fg-3">Ready to send</span>
                )}
                <span className="num w-[96px] text-right font-semibold text-fg-1">{formatINR(po.total, { paise: false })}</span>
              </li>
            ))}
          </ul>
          <p className="px-6 pt-3 text-[12px] text-fg-3">
            POs above {limit} are created as <span className="text-expiry">Pending approval</span> and cannot be sent until the Owner approves. Sending is
            simulated: nothing is emailed.
          </p>
          {failures.length > 0 && (
            <div role="alert" className="mx-6 mt-3 rounded-lg border border-stockout/30 bg-stockout-bg px-3 py-2.5 text-[12.5px] text-stockout">
              <p className="font-medium">Some lines fail a hard stop and were not approved:</p>
              <ul className="mt-1 space-y-0.5">
                {failures.map((f) => (
                  <li key={f.lineId}>
                    <span className="font-mono">{f.sku}</span> — {f.codes.join(", ")}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-fg-2">Deselect or edit them, then approve again.</p>
            </div>
          )}
          <div className="mt-5 flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            <Button variant="ghost" className="h-9 px-4" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="h-9 min-w-[170px] px-4" disabled={pending || lines.length === 0} onClick={approve}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden />}
              {pending ? "Creating POs…" : `Create ${pos.length} PO${pos.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
