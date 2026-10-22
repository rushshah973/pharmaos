import { CountUp } from "@/components/dashboard/CountUp";
import type { ImpactCard as Impact } from "@/lib/business-logic/types";
import { formatINR } from "@/lib/money";

/**
 * Plan Impact Card (§6.10): every field, large numbers, one line of explanation each.
 * Three headline figures, then the supporting ones.
 */
export function ImpactCard({ impact, approvalLimit }: { impact: Impact; approvalLimit: string }) {
  const per100 = impact.lossPreventedPerRupee === null ? null : impact.lossPreventedPerRupee * 100;
  const limit = formatINR(approvalLimit, { paise: false });

  return (
    <section className="surface-hero p-6" aria-label="Plan impact">
      <div className="grid gap-6 md:grid-cols-3">
        <Headline label="Total spend" value={<CountUp value={Number(impact.totalSpend)} kind="inr" />}>
          Every line in the plan, incl. GST and freight
        </Headline>
        <Headline
          label="Stockouts covered"
          value={
            <>
              <CountUp value={impact.stockoutsCovered} />
              <span className="text-fg-3"> / {impact.skusAtRisk}</span>
            </>
          }
        >
          SKUs at stockout risk that this plan buys
        </Headline>
        <Headline label="Loss prevented per ₹100" value={per100 === null ? "—" : <CountUp value={per100} kind="inr-paise" />}>
          Margin protected plus expiry avoided, per ₹100 spent
        </Headline>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-5 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Margin protected" value={formatINR(impact.marginProtected, { paise: false })}>
          Margin kept by not running out
        </Stat>
        <Stat label="Expiry avoided" value={formatINR(impact.expiryAvoided, { paise: false })}>
          Free goods skipped that would have expired
        </Stat>
        <Stat label="Expiry exposure" value={formatINR(impact.expiryExposure, { paise: false })} tone="expiry">
          Stock already on hand that won&apos;t sell in time
        </Stat>
        <Stat
          label="Supplier POs"
          value={
            <>
              {impact.poCount}
              {impact.posNeedingApproval > 0 && <span className="text-expiry"> · {impact.posNeedingApproval} need approval</span>}
            </>
          }
        >
          {impact.posNeedingApproval > 0 ? `Above ${limit} need the Owner` : `None above ${limit}`}
        </Stat>
        <Stat label="Not in this plan" value={impact.excludedCount}>
          {formatINR(impact.excludedRisk, { paise: false })} of loss left uncovered
        </Stat>
      </dl>
    </section>
  );
}

function Headline({ label, value, children }: { label: string; value: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="micro-label">{label}</p>
      <p className="mt-2 display text-[40px] leading-[44px] text-fg-1">{value}</p>
      <p className="mt-1 text-fg-2">{children}</p>
    </div>
  );
}

function Stat({ label, value, tone, children }: { label: string; value: React.ReactNode; tone?: "expiry"; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="micro-label">{label}</dt>
      <dd className={`num mt-1 text-[17px] leading-6 font-semibold ${tone === "expiry" ? "text-expiry" : "text-fg-1"}`}>{value}</dd>
      <dd className="mt-0.5 text-[12.5px] leading-[18px] text-fg-3">{children}</dd>
    </div>
  );
}
