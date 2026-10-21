"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight, Loader2, Minus, Plus, RotateCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { ApiError, apiCall, errorMessage } from "@/lib/api/client";
import { dec, formatINR } from "@/lib/money";
import type { LineDetail, OfferRow } from "@/lib/services/line-detail";
import type { EditResult, SupplierPo } from "@/lib/services/plans";

type Draft = { kind: "qty"; qty: number } | { kind: "offer"; offerId: string };
type Preview =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; result: EditResult }
  | { status: "error"; message: string };

const PREVIEW_DELAY_MS = 350;

/** Friendlier text for the hard stops, with the supplier's actual numbers. */
function editError(err: unknown, rules: { moq: number; packMultiple: number; availableQty: number }): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case "BELOW_MOQ":
      return `Below the supplier's MOQ of ${rules.moq} packs.`;
    case "INVALID_PACK_MULTIPLE":
      return `Order in multiples of ${rules.packMultiple} packs.`;
    case "ABOVE_AVAILABILITY":
      return `The supplier has only ${rules.availableQty.toLocaleString("en-IN")} packs available.`;
    case "NON_POSITIVE_QTY":
      return "Order at least one pack.";
    default:
      return err.message;
  }
}

/**
 * Edit one thing at a time (quantity or supplier). Every change is previewed (PATCH preview: true),
 * showing line, plan and supplier PO totals before → after, then saved explicitly.
 */
export function EditPanel({
  planId,
  detail,
  planTotal,
  supplierPos,
  locked,
}: {
  planId: string;
  detail: LineDetail;
  planTotal: string;
  supplierPos: SupplierPo[];
  locked: boolean;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const { line } = detail;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  const current = detail.offers.find((o) => o.offerId === line.offerId);
  const draftOffer = draft?.kind === "offer" ? detail.offers.find((o) => o.offerId === draft.offerId) : undefined;
  const rules = draftOffer ?? current;
  const pm = line.packMultiple ?? rules?.packMultiple ?? 1;
  const moq = line.moq ?? rules?.moq ?? pm;
  const available = line.availableQty ?? rules?.availableQty ?? Number.MAX_SAFE_INTEGER;
  const editable = !locked && line.status !== "approved_for_po" && line.offerId !== null;
  const qty = draft?.kind === "qty" ? draft.qty : preview.status === "ok" ? preview.result.after.qty : line.qty;
  const choices = detail.offers.filter((o) => o.selectable);

  // Preview each change after a short pause; only the latest request's answer is shown.
  useEffect(() => {
    if (!draft) return;
    const id = ++seq.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setPreview({ status: "loading" });
      const body = draft.kind === "qty" ? { qty: draft.qty, preview: true } : { offerId: draft.offerId, preview: true };
      try {
        const result = await apiCall<EditResult>(`/api/purchase-plans/${planId}/lines/${line.id}`, "PATCH", body, controller.signal);
        if (id === seq.current) setPreview({ status: "ok", result });
      } catch (err) {
        if (controller.signal.aborted || id !== seq.current) return;
        const r = draft.kind === "offer" && draftOffer ? draftOffer : { moq, packMultiple: pm, availableQty: available };
        setPreview({ status: "error", message: editError(err, r) });
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // draftOffer / rules derive from draft; listing them would re-run the same preview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, planId, line.id]);

  function reset() {
    seq.current++;
    setDraft(null);
    setPreview({ status: "idle" });
  }

  async function save() {
    if (!draft || preview.status !== "ok") return;
    setSaving(true);
    const body = draft.kind === "qty" ? { qty: draft.qty } : { offerId: draft.offerId };
    try {
      await apiCall<EditResult>(`/api/purchase-plans/${planId}/lines/${line.id}`, "PATCH", body);
      toast.success(`${line.sku} updated`, { description: "The plan total and supplier POs are recalculated." });
      reset();
      startTransition(() => router.refresh());
    } catch (err) {
      setPreview({ status: "error", message: editError(err, { moq, packMultiple: pm, availableQty: available }) });
    } finally {
      setSaving(false);
    }
  }

  const step = (dir: 1 | -1) => {
    const next = Math.min(available, Math.max(moq, qty + dir * pm));
    setDraft(next === line.qty && !draftOffer ? null : { kind: "qty", qty: next });
    if (next === line.qty) setPreview({ status: "idle" });
  };

  if (!editable) {
    return (
      <p className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-fg-2">
        {line.status === "approved_for_po" ? "This line is on a purchase order and can no longer change." : line.offerId === null ? "No supplier offer can be used, so there is nothing to edit." : "This plan is closed."}
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-border-strong bg-surface-1 p-4">
      <div className="grid grid-cols-[auto_1fr] items-end gap-4">
        <div>
          <label className="text-[12px] text-fg-3" htmlFor="edit-qty">
            Quantity <span className="text-fg-3">(packs, steps of {pm}, min {moq})</span>
          </label>
          <div className="mt-1 flex items-center gap-1">
            <button type="button" className="row-action border border-border-strong" onClick={() => step(-1)} disabled={draft?.kind === "offer" || qty - pm < moq} aria-label="Fewer packs">
              <Minus className="size-4" aria-hidden />
            </button>
            <input
              id="edit-qty"
              inputMode="numeric"
              value={qty}
              disabled={draft?.kind === "offer"}
              onChange={(e) => {
                const v = Number(e.target.value.replace(/\D/g, ""));
                if (!Number.isFinite(v)) return;
                setDraft(v === line.qty ? null : { kind: "qty", qty: v });
                if (v === line.qty) setPreview({ status: "idle" });
              }}
              className="num h-8 w-20 rounded-md border border-border-strong bg-surface-2 px-2 text-center text-[13.5px] text-fg-1 disabled:opacity-50"
            />
            <button type="button" className="row-action border border-border-strong" onClick={() => step(1)} disabled={draft?.kind === "offer" || qty + pm > available} aria-label="More packs">
              <Plus className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        <div className="min-w-0">
          <label className="text-[12px] text-fg-3" htmlFor="edit-offer">
            Supplier
          </label>
          <select
            id="edit-offer"
            value={draft?.kind === "offer" ? draft.offerId : (line.offerId ?? "")}
            disabled={draft?.kind === "qty"}
            onChange={(e) => {
              const v = e.target.value;
              setDraft(v === line.offerId ? null : { kind: "offer", offerId: v });
              if (v === line.offerId) setPreview({ status: "idle" });
            }}
            className="mt-1 h-8 w-full rounded-md border border-border-strong bg-surface-2 px-2 text-[13px] text-fg-1 disabled:opacity-50"
          >
            {choices.map((o) => (
              <option key={o.offerId} value={o.offerId}>
                {optionLabel(o)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {draft && <p className="text-[12px] text-fg-3">One change at a time: save or reset to change the {draft.kind === "qty" ? "supplier" : "quantity"}.</p>}

      <PreviewBox preview={preview} planTotal={planTotal} supplierPos={supplierPos} />

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" className="h-9 px-3" disabled={!draft || saving} onClick={reset}>
          <RotateCcw className="size-4" aria-hidden /> Reset
        </Button>
        <Button className="h-9 min-w-[120px] px-4" disabled={!draft || preview.status !== "ok" || saving || refreshing} onClick={save}>
          {(saving || refreshing) && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save change
        </Button>
      </div>
    </div>
  );
}

function optionLabel(o: OfferRow) {
  const cost = o.effectiveCost ? formatINR(o.effectiveCost) : o.unitPrice ? formatINR(o.unitPrice) : "no price";
  const note = o.exclusions.includes("TOO_SLOW_FOR_COVER") ? " · arrives after stockout" : o.exclusions.includes("INSUFFICIENT_AVAILABILITY") ? " · short stock" : "";
  return `${o.supplierCode} · ${cost}/pack · ${o.leadTimeDays} d${o.winner ? " · engine pick" : ""}${note}`;
}

function PreviewBox({ preview, planTotal, supplierPos }: { preview: Preview; planTotal: string; supplierPos: SupplierPo[] }) {
  if (preview.status === "idle") {
    return <p className="rounded-lg bg-surface-2 px-3 py-2.5 text-[12.5px] text-fg-3">Change the quantity or supplier to preview the new totals. Nothing is saved until you press Save.</p>;
  }
  if (preview.status === "loading") {
    return (
      <div className="space-y-2 rounded-lg bg-surface-2 px-3 py-3" aria-label="Calculating preview">
        <span className="shimmer block h-4 w-3/4 rounded" />
        <span className="shimmer block h-4 w-2/3 rounded" />
        <span className="shimmer block h-4 w-1/2 rounded" />
      </div>
    );
  }
  if (preview.status === "error") {
    return (
      <p role="alert" className="rounded-lg border border-stockout/30 bg-stockout-bg px-3 py-2.5 text-[13px] text-stockout">
        {preview.message}
      </p>
    );
  }
  const { before, after, plan } = preview.result;
  const poBefore = (id: string | null) => supplierPos.find((p) => p.supplierId === id);
  const poAfter = (id: string | null) => plan.supplierPos.find((p) => p.supplierId === id);
  const newPo = poAfter(after.supplierId);
  const crosses = newPo?.needsApproval && !poBefore(after.supplierId)?.needsApproval;
  const switched = before.supplierId !== after.supplierId;
  const rows: { label: string; from: string; to: string }[] = [
    { label: "Quantity", from: `${before.qty}${before.freeQty ? ` +${before.freeQty}` : ""}`, to: `${after.qty}${after.freeQty ? ` +${after.freeQty}` : ""}` },
    { label: "Line total", from: formatINR(before.totals.lineTotal), to: formatINR(after.totals.lineTotal) },
    { label: "Plan total", from: formatINR(planTotal), to: formatINR(plan.proposedTotal) },
    { label: `${after.supplierCode} PO`, from: formatINR(poBefore(after.supplierId)?.total ?? "0"), to: formatINR(newPo?.total ?? "0") },
  ];
  if (switched) rows.push({ label: `${before.supplierCode} PO`, from: formatINR(poBefore(before.supplierId)?.total ?? "0"), to: formatINR(poAfter(before.supplierId)?.total ?? "0") });
  const diff = dec(after.totals.lineTotal).minus(before.totals.lineTotal);

  return (
    <div className="space-y-2 rounded-lg bg-surface-2 px-3 py-3">
      <dl className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 text-[13px]">
            <dt className="text-fg-2">{r.label}</dt>
            <dd className="num text-right text-fg-3">{r.from}</dd>
            <ArrowRight className="size-3.5 text-fg-3" aria-hidden />
            <dd className={cn("num min-w-[96px] text-right font-semibold", r.from === r.to ? "text-fg-2" : "text-fg-1")}>{r.to}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] text-fg-3">
        {diff.isZero() ? "No change to spend." : `${diff.greaterThan(0) ? "Adds" : "Saves"} ${formatINR(diff.abs())} of spend.`} Preview only — not saved yet.
      </p>
      {crosses && (
        <p className="flex items-center gap-1.5 rounded-md bg-expiry-bg px-2.5 py-1.5 text-[12.5px] font-medium text-expiry">
          <ShieldAlert className="size-4" aria-hidden /> The {after.supplierCode} PO will need Owner approval (above {formatINR(plan.approvalLimit, { paise: false })}).
        </p>
      )}
      {newPo?.needsApproval && !crosses && <p className="text-[12px] text-expiry">The {after.supplierCode} PO already needs Owner approval.</p>}
    </div>
  );
}
