// Read-only sections of the line drawer. Everything shown comes from the line's evidence (§10.3).
import { cn } from "cn";
import { StatusPill } from "@/components/layout/StatusPill";
import { formatDisplayDate } from "@/lib/format/date";
import { dec, formatINR } from "@/lib/money";
import type { Formula, LineDetail, OfferRow } from "@/lib/services/line-detail";

const EXCLUSION_TEXT: Record<string, string> = {
  SUPPLIER_NOT_APPROVED: "Supplier not approved",
  QUOTE_EXPIRED: "Quote expired",
  QUOTE_STALE: "Quote older than 14 days",
  MISSING_PRICE: "No price",
  OFFER_INACTIVE: "Offer inactive",
  PRODUCT_MISMATCH: "Different product",
  INSUFFICIENT_AVAILABILITY: "Not enough stock",
  INVALID_PACK_RULES: "Invalid pack rules",
  TOO_SLOW_FOR_COVER: "Arrives after stockout",
};

const INELIGIBLE_TEXT: Record<string, string> = {
  quarantine: "In quarantine",
  rejected: "Rejected by QC",
  recalled: "Recalled",
  expired: "Expired",
};

export function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="micro-label">{title}</h3>
        {aside && <div className="text-[12px] text-fg-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "stockout" | "expiry" }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-fg-3">{label}</div>
      <div className={cn("num text-[17px] leading-[24px] font-normal tracking-[-0.015em]", tone === "stockout" ? "text-stockout" : tone === "expiry" ? "text-expiry" : "text-fg-1")}>
        {value}
      </div>
      {note && <div className="text-[11.5px] leading-4 text-fg-3">{note}</div>}
    </div>
  );
}

const packs = (n: number | null) => (n === null ? "—" : Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toFixed(1));

export function StockSection({ detail }: { detail: LineDetail }) {
  const { stock, policy } = detail;
  const short = stock.cover !== null && stock.cover < policy.leadFastest;
  const ineligibleQty = stock.ineligible.reduce((n, b) => n + b.onHandQty, 0);
  return (
    <Section title="Stock" aside={`Incoming counts POs due within ${stock.horizonDays} days`}>
      <div className="grid grid-cols-4 gap-4 rounded-lg border border-border bg-surface-1 p-4">
        <Figure label="On hand" value={packs(stock.onHand)} note="eligible batches" />
        <Figure label="Reserved" value={packs(stock.reserved)} note="for open orders" />
        <Figure label="Available" value={packs(stock.available)} note="sells before expiry" />
        <Figure label="Incoming" value={packs(stock.incoming)} note={`${stock.incomingLines.length} PO line(s) on order`} />
      </div>
      <div className="grid grid-cols-4 gap-4 px-1">
        <Figure label="Position" value={packs(stock.position)} note="available + incoming" />
        <Figure label="Cover" value={stock.cover === null ? "—" : `${stock.cover.toFixed(1)} d`} note={short ? `runs out before delivery (${policy.leadFastest} d)` : `fastest delivery ${policy.leadFastest} d`} tone={short ? "stockout" : undefined} />
        <Figure label="Reorder point" value={packs(policy.reorderPoint)} note="order below this" />
        <Figure label="Target" value={packs(policy.targetStock)} note="order up to this" />
      </div>
      {stock.ineligible.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-1 px-4 py-3">
          <div className="text-[12px] text-fg-3">Not counted · {ineligibleQty.toLocaleString("en-IN")} packs</div>
          <ul className="mt-1 space-y-0.5">
            {stock.ineligible.map((b) => (
              <li key={b.batchId} className="flex justify-between gap-3 text-[12.5px]">
                <span className="font-mono text-fg-2">{b.batchNumber}</span>
                <span className="text-fg-2">{INELIGIBLE_TEXT[b.reason] ?? b.reason}</span>
                <span className="num text-fg-1">{b.onHandQty} packs</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

export function BatchesTable({ detail }: { detail: LineDetail }) {
  if (detail.batches.length === 0) {
    return (
      <Section title="Batches (FEFO)">
        <p className="rounded-lg border border-border bg-surface-1 px-4 py-3 text-fg-2">No eligible stock on hand.</p>
      </Section>
    );
  }
  return (
    <Section title="Batches (FEFO)" aside={dec(detail.atRiskValue).greaterThan(0) ? <span className="text-expiry">{formatINR(detail.atRiskValue)} at expiry risk</span> : "Nothing at expiry risk"}>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse text-[12.5px] whitespace-nowrap">
          <thead>
            <tr className="bg-surface-1">
              {["Batch", "Expires", "Sell-by days", "Available", "Will sell", "At risk", "₹ at risk"].map((h, i) => (
                <th key={h} className={cn("micro-label h-8 px-3 font-medium", i === 0 ? "text-left" : "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.batches.map((b) => {
              const risk = b.atRiskQty > 0;
              return (
                <tr key={b.batchId} className="h-9 border-t border-border">
                  <td className="px-3 font-mono text-fg-1">{b.batchNumber}</td>
                  <td className="num px-3 text-right text-fg-2">{formatDisplayDate(b.expiryDate)}</td>
                  <td className="num px-3 text-right text-fg-2">{b.sellableDays}</td>
                  <td className="num px-3 text-right text-fg-1">{packs(b.available)}</td>
                  <td className="num px-3 text-right text-fg-1">{packs(b.projectedSold)}</td>
                  <td className={cn("num px-3 text-right", risk ? "text-expiry" : "text-fg-3")}>{risk ? packs(b.atRiskQty) : "—"}</td>
                  <td className={cn("num px-3 text-right", risk ? "text-expiry" : "text-fg-3")}>{risk ? formatINR(b.atRiskValue) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

const FACTORS: { key: keyof NonNullable<OfferRow["factors"]>; label: string }[] = [
  { key: "cost", label: "Cost" },
  { key: "leadTime", label: "Lead" },
  { key: "reliability", label: "Reliability" },
  { key: "terms", label: "Terms" },
];

export function SupplierComparison({ offers }: { offers: OfferRow[] }) {
  return (
    <Section title="Supplier comparison" aside="Score = 0.45 cost + 0.25 lead + 0.20 reliability + 0.10 terms">
      {offers.length === 0 && <p className="text-[12.5px] text-fg-2">No supplier has an offer for this SKU, so it cannot be bought until one is added.</p>}
      <p className="text-[11.5px] text-fg-3">Offer prices are synthetic demo data, not real supplier quotes.</p>
      <ul className="space-y-2">
        {offers.map((o) => {
          const excluded = o.exclusions.length > 0;
          return (
            <li
              key={o.offerId}
              className={cn(
                "rounded-lg border bg-surface-1 p-3.5",
                o.winner ? "border-brand/40 shadow-[inset_2px_0_0_var(--brand)]" : "border-border",
                excluded && "opacity-75",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12.5px] text-fg-1">{o.supplierCode}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg-2">{o.supplierName}</span>
                {o.winner && <StatusPill status="healthy">Engine pick</StatusPill>}
                {o.selected && !o.winner && <StatusPill status="excess">Your pick</StatusPill>}
                {o.score !== null && <span className="num text-[13px] font-semibold text-fg-1">{o.score.toFixed(1)}</span>}
              </div>
              <dl className="mt-2.5 grid grid-cols-5 gap-3 text-[12.5px]">
                <Cell label="Cost/pack" value={o.effectiveCost ? formatINR(o.effectiveCost) : o.unitPrice ? formatINR(o.unitPrice) : "—"} warn={o.priceAnomaly} />
                <Cell label="Lead" value={`${o.leadTimeDays} d`} />
                <Cell label="MOQ · multiple" value={`${o.moq} · ${o.packMultiple}`} />
                <Cell label="Available" value={o.availableQty.toLocaleString("en-IN")} />
                <Cell label="Scheme" value={o.scheme ?? "—"} />
              </dl>
              {o.factors && (
                <div className="mt-3 grid grid-cols-4 gap-3">
                  {FACTORS.map((f) => (
                    <div key={f.key}>
                      <div className="flex justify-between text-[11px] text-fg-3">
                        <span>{f.label}</span>
                        <span className="num">{Math.round(o.factors![f.key])}</span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-surface-3">
                        <div className={cn("h-1 rounded-full", o.winner ? "bg-brand" : "bg-fg-3")} style={{ width: `${Math.max(2, o.factors![f.key])}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fg-3">
                <span>Offer dated {formatDisplayDate(o.quotedAt)}</span>
                <span>Valid until {formatDisplayDate(o.validUntil)}</span>
                {o.exclusions.map((c) => (
                  <span key={c} className="rounded border border-stockout/30 px-1.5 leading-4 text-stockout">
                    {EXCLUSION_TEXT[c] ?? c}
                  </span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Cell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-fg-3">{label}</dt>
      <dd className={cn("num truncate font-medium", warn ? "text-stockout" : "text-fg-1")} title={warn ? "More than 20% above this SKU's other offers" : undefined}>
        {value}
      </dd>
      {warn && <dd className="text-[10.5px] text-stockout">price anomaly</dd>}
    </div>
  );
}

export function FormulaPanel({ formulas }: { formulas: Formula[] }) {
  return (
    <Section title="How the numbers were calculated" aside="The engine's recommendation, with this line's values">
      <ol className="divide-y divide-border rounded-lg border border-border bg-surface-1">
        {formulas.map((f) => (
          <li key={f.label} className="px-4 py-2.5">
            <div className="text-[12px] text-fg-3">{f.label}</div>
            <div className="mt-0.5 font-mono text-[12.5px] leading-[18px] text-fg-2">
              {f.expr}
              <br />= {f.subst} = <span className="font-semibold text-fg-1">{f.result}</span>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
