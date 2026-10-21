"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  Ban,
  BadgeAlert,
  CircleSlash,
  Gift,
  History,
  Hourglass,
  MapPinOff,
  PauseCircle,
  Pencil,
  ShieldCheck,
  TrendingUp,
  UserCog,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { SkuStatusPill } from "@/components/layout/SkuStatusPill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiCall, errorMessage } from "@/lib/api/client";
import type { WarningCode } from "@/lib/business-logic/types";
import { REASON_ORDER, REASON_TEXT, WARNING_TEXT } from "@/lib/format/codes";
import { formatINR, sumMoney } from "@/lib/money";
import type { LineView, PlanStatus } from "@/lib/services/plans";
import { requestLine } from "./drawer/line-store";
import { ReasonDialog, type ReasonTarget } from "./ReasonDialog";
import { WhyButton } from "./WhyButton";

const WARNING_ICON: Record<WarningCode, { icon: LucideIcon; tone: string }> = {
  NO_DEMAND: { icon: CircleSlash, tone: "text-fg-2" },
  LOW_HISTORY: { icon: History, tone: "text-fg-2" },
  DEMAND_SPIKE: { icon: TrendingUp, tone: "text-expiry" },
  AT_RISK_BATCHES: { icon: Hourglass, tone: "text-expiry" },
  SCHEME_EXCESS_RISK: { icon: Gift, tone: "text-expiry" },
  PRICE_ANOMALY: { icon: BadgeAlert, tone: "text-stockout" },
  NOT_TOP_SUPPLIER: { icon: UserCog, tone: "text-excess" },
  CAPACITY_REVIEW: { icon: Warehouse, tone: "text-expiry" },
  UNMAPPED_STOCK: { icon: MapPinOff, tone: "text-fg-2" },
};

const HEADERS: { label: string; className?: string }[] = [
  { label: "#", className: "w-9 text-right" },
  { label: "SKU" },
  { label: "Status" },
  { label: "Cover", className: "text-right" },
  { label: "Qty", className: "text-right" },
  { label: "Supplier" },
  { label: "Cost/pack", className: "text-right" },
  { label: "Lead", className: "text-right" },
  { label: "Line total", className: "text-right" },
  { label: "Flags" },
  { label: "Reason" },
  { label: "", className: "w-[132px]" },
];

// Checkbox, rank and SKU stay pinned when the table scrolls sideways (tablet widths).
const STICKY = ["sticky left-0 z-10", "sticky left-9 z-10", "sticky left-[72px] z-10"];
const EDGE = "shadow-[inset_-1px_0_0_var(--border)]";

const cover = (c: number | null) => (c === null ? "—" : `${c.toFixed(1)} d`);
const selectable = (l: LineView) => l.status === "proposed" || l.status === "edited";

/** The ranked decision list (§10.3): what to buy, from whom, why — with row actions and a selection footer. */
export function PlanTable({
  planId,
  planStatus,
  lines,
  children,
}: {
  planId: string;
  planStatus: PlanStatus;
  lines: LineView[];
  /** Rendered between the table and the selection footer (the "Not in this plan" list). */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonTarget, setReasonTarget] = useState<ReasonTarget | null>(null);
  const locked = planStatus === "approved" || planStatus === "rejected";

  const rows = useMemo(() => [...lines].sort((a, b) => a.rank - b.rank), [lines]);
  const pickable = rows.filter(selectable);
  // Drop selections of lines that are no longer selectable (after a refresh).
  const chosen = rows.filter((l) => selected.has(l.id) && selectable(l));
  const allChosen = pickable.length > 0 && chosen.length === pickable.length;
  const selectedTotal = sumMoney(chosen.map((l) => l.totals.lineTotal)).toFixed(2);

  // The drawer is driven by ?line=<id>. requestLine opens it on its skeleton at once; the navigation then
  // streams that line's evidence from the server.
  const openLine = (lineId: string) => {
    requestLine(lineId);
    router.push(`?line=${lineId}`, { scroll: false });
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function changeStatus(target: ReasonTarget, reason: string): Promise<boolean> {
    try {
      await apiCall(`/api/purchase-plans/${planId}/lines/${target.lineId}`, "PATCH", { status: target.status, reason });
      toast.success(`${target.sku} ${target.status === "deferred" ? "deferred" : "rejected"}`, {
        description: "Moved to Not in this plan. The totals and supplier POs are updated.",
      });
      toggle(target.lineId, false);
      startTransition(() => router.refresh());
      return true;
    } catch (err) {
      toast.error(`Could not update ${target.sku}`, { description: errorMessage(err) });
      return false;
    }
  }

  return (
    <>
      <section className="surface overflow-hidden" aria-label="Plan lines">
        <header className="flex flex-wrap items-end justify-between gap-3 px-5 pt-5 pb-4">
          <div>
            <h2 className="text-[15px] leading-[22px] font-semibold text-fg-1">Plan lines</h2>
            <p className="text-fg-2">Ranked by loss prevented per rupee · most urgent first · {rows.length} lines</p>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse whitespace-nowrap">
            <thead>
              <tr className="border-y border-border bg-surface-2">
                <th className={cn("h-10 w-9 pl-5", STICKY[0], "bg-surface-2")}>
                  <Checkbox
                    aria-label="Select all lines"
                    checked={allChosen}
                    indeterminate={chosen.length > 0 && !allChosen}
                    disabled={locked || pickable.length === 0}
                    onCheckedChange={(on) => setSelected(on ? new Set(pickable.map((l) => l.id)) : new Set())}
                  />
                </th>
                {HEADERS.map((h, i) => (
                  <th key={h.label || i} className={cn("micro-label h-10 px-2.5 text-left font-medium", h.className, i < 2 && [STICKY[i + 1], "bg-surface-2"], i === 1 && EDGE)}>
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <PlanRow
                  key={l.id}
                  line={l}
                  planId={planId}
                  locked={locked}
                  checked={selected.has(l.id)}
                  onCheck={(on) => toggle(l.id, on)}
                  onReason={(status) => setReasonTarget({ lineId: l.id, sku: l.sku, brand: `${l.brandName} ${l.strength}`, status })}
                  onOpen={openLine}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {children}
      <FooterBar count={chosen.length} total={selectedTotal} />
      <ReasonDialog target={reasonTarget} onClose={() => setReasonTarget(null)} onSubmit={changeStatus} />
    </>
  );
}

function PlanRow({
  line: l,
  planId,
  locked,
  checked,
  onCheck,
  onReason,
  onOpen,
}: {
  line: LineView;
  planId: string;
  locked: boolean;
  checked: boolean;
  onCheck: (on: boolean) => void;
  onReason: (status: "deferred" | "rejected") => void;
  onOpen: (lineId: string) => void;
}) {
  const reasons = REASON_ORDER.filter((r) => l.reasons.includes(r));
  // Pinned cells need an opaque background that follows the row's hover / selected state.
  const cellBg = checked ? "bg-[color-mix(in_srgb,var(--brand)_10%,var(--surface-1))]" : "bg-surface-1 group-hover:bg-surface-3";
  const main = reasons[0];
  const onPo = l.status === "approved_for_po";
  const rowLocked = locked || onPo;

  return (
    <tr
      className={cn(
        "group h-14 border-b border-border transition-colors duration-150 last:border-b-0 hover:bg-surface-3",
        checked && "bg-brand-glow shadow-[inset_2px_0_0_var(--brand)] hover:bg-brand-glow",
      )}
    >
      <td className={cn("pl-5", STICKY[0], cellBg)}>
        <Checkbox aria-label={`Select ${l.sku}`} checked={checked} disabled={rowLocked} onCheckedChange={(on) => onCheck(on === true)} />
      </td>
      <td className={cn("num px-2.5 text-right text-fg-3", STICKY[1], cellBg)}>{l.rank}</td>
      <td className={cn("px-2.5 py-2", STICKY[2], cellBg, EDGE)}>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onOpen(l.id)} className="font-mono text-[12.5px] text-fg-1 hover:text-brand hover:underline">
            {l.sku}
          </button>
          {l.status === "edited" && <Tag className="border-brand/30 text-brand">Edited</Tag>}
          {onPo && <Tag className="border-healthy/30 text-healthy">On PO</Tag>}
        </div>
        <div className="max-w-[180px] truncate text-[12.5px] text-fg-2" title={`${l.brandName} · ${l.strength} · ${l.packSize}/pack`}>
          {l.brandName} · {l.strength} · {l.packSize}/pack
        </div>
      </td>
      <td className="px-2.5">
        <SkuStatusPill status={l.skuStatus} compact />
      </td>
      <td className={cn("num px-2.5 text-right", l.cover !== null && l.leadTimeDays !== null && l.cover < l.leadTimeDays ? "text-stockout" : "text-fg-1")}>
        {cover(l.cover)}
      </td>
      <td className="num px-2.5 text-right text-fg-1">
        {l.qty.toLocaleString("en-IN")}
        {l.freeQty > 0 && <span className="text-healthy"> +{l.freeQty}</span>}
      </td>
      <td className="px-2.5">
        <span className="font-mono text-[12.5px] text-fg-1" title={l.supplierName ?? undefined}>
          {l.supplierCode ?? "—"}
        </span>
      </td>
      <td className="num px-2.5 text-right text-fg-2">{l.effectiveCost ? formatINR(l.effectiveCost) : "—"}</td>
      <td className="num px-2.5 text-right text-fg-2">{l.leadTimeDays === null ? "—" : `${l.leadTimeDays} d`}</td>
      <td className="num px-2.5 text-right font-medium text-fg-1">{formatINR(l.totals.lineTotal)}</td>
      <td className="px-2.5">
        <div className="flex items-center gap-1">
          {l.warnings.length === 0 && <span className="text-fg-3">—</span>}
          {l.warnings.map((w) => {
            const { icon: Icon, tone } = WARNING_ICON[w];
            return (
              <Tooltip key={w}>
                <TooltipTrigger render={<span tabIndex={0} className={cn("inline-flex size-6 items-center justify-center rounded", tone)} />}>
                  <Icon className="size-4" strokeWidth={1.75} aria-label={WARNING_TEXT[w].short} />
                </TooltipTrigger>
                <TooltipContent className="max-w-60">
                  <span className="font-medium">{WARNING_TEXT[w].short}.</span> {WARNING_TEXT[w].meaning}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </td>
      <td className="px-2.5">
        {main && (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  tabIndex={0}
                  className="inline-flex h-[22px] max-w-[124px] items-center gap-1 rounded-full border border-border-strong px-2.5 text-[12px] text-fg-2"
                />
              }
            >
              <span className="truncate">{REASON_TEXT[main].short}</span>
              {reasons.length > 1 && <span className="text-fg-3">+{reasons.length - 1}</span>}
            </TooltipTrigger>
            <TooltipContent className="max-w-72 flex-col items-start gap-1">
              {reasons.map((r) => (
                <span key={r} className="block">
                  <span className="font-medium">{REASON_TEXT[r].short}:</span> {REASON_TEXT[r].meaning}
                </span>
              ))}
            </TooltipContent>
          </Tooltip>
        )}
      </td>
      <td className="pr-4 pl-2">
        <div className="flex items-center justify-end gap-0.5 opacity-70 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100">
          <WhyButton planId={planId} lineId={l.id} sku={l.sku} />
          <IconAction icon={Pencil} label={`Details and edit ${l.sku}`} hint="Details & edit" onClick={() => onOpen(l.id)} />
          <IconAction icon={PauseCircle} label={`Defer ${l.sku}`} hint="Defer" disabled={rowLocked} onClick={() => onReason("deferred")} />
          <IconAction icon={Ban} label={`Reject ${l.sku}`} hint="Reject" disabled={rowLocked} onClick={() => onReason("rejected")} danger />
        </div>
      </td>
    </tr>
  );
}

function IconAction({
  icon: Icon,
  label,
  hint,
  disabled,
  onClick,
  danger,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick?: () => void;
  danger?: boolean;
}) {
  return (
    <Tooltip>
      {/* The span keeps the tooltip working on a disabled button. */}
      <TooltipTrigger render={<span className="inline-flex" />}>
        <button type="button" className={cn("row-action", danger && "hover:not-disabled:text-stockout")} aria-label={label} disabled={disabled} onClick={onClick}>
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

function Tag({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("rounded border px-1.5 text-[10.5px] leading-4 font-medium", className)}>{children}</span>;
}

/** Sticky selection bar. Approving lines into purchase orders arrives in stage 4. */
function FooterBar({ count, total }: { count: number; total: string }) {
  return (
    <div className="sticky bottom-4 z-20">
      <div className="surface flex items-center justify-between gap-4 border-border-strong bg-surface-2/95 px-5 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.45)] backdrop-blur">
        <p className="text-fg-2">
          {count === 0 ? (
            "Select lines to approve them into purchase orders."
          ) : (
            <>
              <span className="num font-semibold text-fg-1">{count}</span> line{count === 1 ? "" : "s"} selected ·{" "}
              <span className="num font-semibold text-fg-1">{formatINR(total)}</span>
            </>
          )}
        </p>
        <div className="flex items-center gap-3">
        <span className="text-[12.5px] text-fg-3">Available in stage 4</span>
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" tabIndex={0} />}>
            <Button className="h-9 px-4" disabled>
              <ShieldCheck className="size-4" strokeWidth={1.75} aria-hidden />
              Approve selected
            </Button>
          </TooltipTrigger>
          <TooltipContent>Approving lines into purchase orders arrives in stage 4</TooltipContent>
        </Tooltip>
        </div>
      </div>
    </div>
  );
}
