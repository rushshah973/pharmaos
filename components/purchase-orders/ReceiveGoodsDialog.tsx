"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2, PackageCheck, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ApiError, apiCall, errorMessage } from "@/lib/api/client";
import { formatDisplayDate } from "@/lib/format/date";
import type { ReceiptDraft, ReceiptResult } from "@/lib/services/receiving";

type Row = { lineId: string; qty: string; batchNumber: string; expiryDate: string; binId: string };
type Problem = { lineId: string; sku: string; code: string; message: string };

const input = "h-8 rounded-lg border border-white/12 bg-white/[0.04] px-2 text-[12.5px] text-fg-1 focus-visible:border-brand/60 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand disabled:opacity-50";

/**
 * Goods receipt: when the delivery arrives, enter the packs received per line (a short delivery is fine), the
 * batch number and expiry printed on the cartons, and the bin it goes to (the put-away rule suggests one).
 * The stock lands in the warehouse at once; the PO becomes Received. Mounted fresh each time it opens.
 */
export function ReceiveGoodsDialog({ poId, poNumber, open, onOpenChange }: { poId: string; poNumber: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    fetch(`/api/purchase-orders/${poId}/receive`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error?.message ?? `The receipt could not load (HTTP ${r.status}).`);
        return j as ReceiptDraft;
      })
      .then((d) => {
        if (stop) return;
        setDraft(d);
        setRows(d.lines.map((l) => ({ lineId: l.lineId, qty: String(l.qty), batchNumber: l.batchNumber, expiryDate: l.expiryDate, binId: l.binId ?? "" })));
      })
      .catch((err) => !stop && setLoadError(errorMessage(err)));
    return () => {
      stop = true;
    };
  }, [open, poId]);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const total = rows.reduce((n, r) => n + (Number(r.qty) || 0), 0);
  const missingBin = rows.some((r) => Number(r.qty) > 0 && !r.binId);

  async function submit() {
    if (!draft) return;
    setSaving(true);
    setProblems([]);
    try {
      const res = await apiCall<ReceiptResult>(`/api/purchase-orders/${poId}/receive`, "POST", {
        lines: rows.map((r) => ({ lineId: r.lineId, qty: Number(r.qty) || 0, batchNumber: r.batchNumber, expiryDate: r.expiryDate, binId: r.binId || draft.lines.find((l) => l.lineId === r.lineId)?.binOptions[0]?.binId || "00000000-0000-4000-8000-000000000000" })),
      });
      toast.success(`${poNumber} received: ${res.packs.toLocaleString("en-IN")} packs`, {
        description: `Put away in ${res.bins.slice(0, 4).join(", ")}${res.bins.length > 4 ? "…" : ""}${res.shortLines ? ` · ${res.shortLines} line${res.shortLines === 1 ? "" : "s"} short` : ""}. Stock is available now.`,
        action: { label: "See in warehouse", onClick: () => router.push(`/warehouse?sku=${encodeURIComponent(draft.lines[0]?.sku ?? "")}`) },
      });
      onOpenChange(false);
      startTransition(() => router.refresh());
    } catch (err) {
      if (err instanceof ApiError && err.code === "RECEIPT_INVALID") setProblems(((err.details as { problems?: Problem[] })?.problems ?? []) as Problem[]);
      else toast.error(`Could not receive ${poNumber}`, { description: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  const problemFor = (lineId: string) => problems.filter((p) => p.lineId === lineId);

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent showCloseButton={!saving} className="gap-0 border border-border-strong bg-surface-2 p-0 shadow-(--shadow-pop) ring-0 sm:max-w-[920px]">
        <div className="space-y-1.5 px-6 pt-6">
          <DialogTitle className="text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">
            Receive goods · <span className="font-mono text-[14px]">{poNumber}</span>
          </DialogTitle>
          <DialogDescription className="text-fg-2">
            Enter what arrived: packs per line (less than ordered is fine), the batch and expiry on the cartons, and the bin. Stock is available as soon as you
            receive it. Expiry must be at least 90 days away{draft ? ` (on or after ${formatDisplayDate(draft.minExpiry)})` : ""}.
          </DialogDescription>
        </div>

        <div className="max-h-[55vh] overflow-auto px-6 py-4">
          {loadError && (
            <p role="alert" className="flex items-center gap-2 rounded-xl border border-stockout/30 bg-stockout-bg px-3 py-2 text-[12.5px] text-stockout">
              <TriangleAlert className="size-4" aria-hidden /> {loadError} Close and try again.
            </p>
          )}
          {!draft && !loadError && (
            <div className="space-y-2" aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="shimmer block h-10 rounded-lg" />
              ))}
            </div>
          )}
          {draft && (
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead>
                <tr className="text-left">
                  {["SKU", "Ordered", "Received", "Batch number", "Expiry", "Bin"].map((h, i) => (
                    <th key={h} className={`micro-label h-8 pr-3 font-medium ${i === 1 || i === 2 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {draft.lines.map((l, i) => {
                  const r = rows[i];
                  const qty = Number(r?.qty) || 0;
                  const errs = problemFor(l.lineId);
                  return (
                    <tr key={l.lineId} className="border-t border-white/[0.06] align-top">
                      <td className="py-2 pr-3">
                        <div className="font-mono text-fg-1">{l.sku}</div>
                        <div className="max-w-[200px] truncate text-[11.5px] text-fg-3">
                          {l.brandName} · {l.strength} · {l.storageClass}
                        </div>
                        {errs.map((e) => (
                          <div key={e.code} className="mt-1 text-[11.5px] text-stockout">
                            {e.message}
                          </div>
                        ))}
                      </td>
                      <td className="num py-2 pr-3 text-right text-fg-2">
                        {l.ordered.toLocaleString("en-IN")}
                        {l.freeQty > 0 && <span className="block text-[11px] text-healthy">+{l.freeQty} free</span>}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <input
                          aria-label={`Packs received for ${l.sku}`}
                          inputMode="numeric"
                          value={r?.qty ?? ""}
                          onChange={(e) => set(i, { qty: e.target.value.replace(/[^\d]/g, "") })}
                          disabled={saving}
                          className={`${input} num w-20 text-right`}
                        />
                        {qty < l.ordered + l.freeQty && <span className="block text-[11px] text-expiry">{qty === 0 ? "not delivered" : `${l.ordered + l.freeQty - qty} short`}</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <input aria-label={`Batch number for ${l.sku}`} value={r?.batchNumber ?? ""} onChange={(e) => set(i, { batchNumber: e.target.value })} disabled={saving || qty === 0} className={`${input} w-32 font-mono`} />
                      </td>
                      <td className="py-2 pr-3">
                        <input aria-label={`Expiry date for ${l.sku}`} type="date" min={draft.minExpiry} value={r?.expiryDate ?? ""} onChange={(e) => set(i, { expiryDate: e.target.value })} disabled={saving || qty === 0} className={`${input} w-36`} />
                      </td>
                      <td className="py-2">
                        <select aria-label={`Bin for ${l.sku}`} value={r?.binId ?? ""} onChange={(e) => set(i, { binId: e.target.value })} disabled={saving || qty === 0} className={`${input} w-44`}>
                          {!r?.binId && <option value="">No bin with room</option>}
                          {l.binId && !l.binOptions.some((b) => b.binId === l.binId) && <option value={l.binId}>{l.binCode} (suggested)</option>}
                          {l.binOptions.map((b) => (
                            <option key={b.binId} value={b.binId}>
                              {b.binCode}
                              {b.binId === l.binId ? " (suggested)" : ""} · {b.free.toLocaleString("en-IN")} free
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {problems.length > 0 && (
          <p role="alert" className="mx-6 mb-2 rounded-xl border border-stockout/30 bg-stockout-bg px-3 py-2 text-[12.5px] text-stockout">
            Nothing was received: fix the {problems.length} highlighted problem{problems.length === 1 ? "" : "s"} and receive again.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
          <span className="text-[12.5px] text-fg-3">
            {draft ? (
              <>
                <span className="num text-fg-1">{total.toLocaleString("en-IN")}</span> packs from {draft.supplierName} ·{" "}
                <Link href="/warehouse" className="hover:text-fg-1 hover:underline">
                  warehouse
                </Link>
              </>
            ) : null}
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" className="h-9 px-4" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="h-9 min-w-[150px] px-4" disabled={saving || !draft || total === 0 || missingBin} onClick={submit}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <PackageCheck className="size-4" strokeWidth={1.75} aria-hidden />}
              Receive {total.toLocaleString("en-IN")} packs
            </Button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
