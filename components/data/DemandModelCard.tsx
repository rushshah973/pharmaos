import { BrainCircuit } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { formatDateTime, formatDisplayDate } from "@/lib/format/date";
import type { StoredModel } from "@/lib/services/forecast-model";

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

const FEATURE_TEXT: Record<string, string> = {
  lag1: "yesterday",
  lag7: "same day last week",
  mean7: "7-day mean",
  mean28: "28-day mean",
  std28: "28-day spread",
  zeroShare28: "share of zero days",
  trend28: "28-day trend",
};

/** The demand model in use (§6.2a): how it was trained and how it did on days it never saw. */
export function DemandModelCard({ model, skus, action }: { model: StoredModel | null; skus: number; action?: React.ReactNode }) {
  if (!model) {
    return <EmptyState icon={BrainCircuit} title="No demand model yet" description="Train it to forecast with ML. Until then every SKU uses the trend-aware average." action={action} />;
  }
  const m = model.metrics;
  const h = m.horizon;
  const blendWins = h ? h.blend !== null && h.oldAverage !== null && h.blend < h.oldAverage : m.mlWape !== null && m.baselineWape !== null && m.mlWape < m.baselineWape;
  const base = model.featureNames.filter((n) => FEATURE_TEXT[n]);
  const dows = model.featureNames.filter((n) => n.startsWith("dow_")).length;
  const cats = model.featureNames.filter((n) => n.startsWith("cat_")).length;

  return (
    <section className="surface p-6" aria-label="Demand model">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] leading-[24px] font-normal tracking-[-0.015em] text-fg-1">Demand model</h2>
          <p className="text-fg-2">Global ridge regression over all SKUs, predicting packs sold per day. Trained on synthetic demo data.</p>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border-strong px-2.5 text-[12px] leading-6 text-fg-2">
            Trained {formatDateTime(model.trainedAt)} · as of {formatDisplayDate(model.asOf)}
          </span>
          {action}
        </span>
      </div>

      <div className="mt-5 grid gap-6 md:grid-cols-3">
        {h ? (
          <>
            <Figure
              label="14-day demand error · ML blend"
              value={pct(h.blend)}
              note={`Last ${model.holdoutDays} days, never seen in training · ML alone ${pct(h.ml)}`}
              tone={blendWins ? "brand" : undefined}
            />
            <Figure label="14-day error · averages" value={pct(h.average)} note={`Trend-aware average · old 0.6 × d7 + 0.4 × d28: ${pct(h.oldAverage)}`} />
          </>
        ) : (
          <>
            <Figure label="ML error (holdout)" value={pct(m.mlWape)} note={`Last ${model.holdoutDays} days, never seen in training`} tone={blendWins ? "brand" : undefined} />
            <Figure label="Average error (holdout)" value={pct(m.baselineWape)} note="Held flat over the holdout" />
          </>
        )}
        <Figure label="SKUs using the ML blend" value={`${m.skusUsingMl} / ${skus}`} note="50% ML + 50% trend-aware average; the rest keep the average" />
      </div>

      <p className="mt-4 text-[12.5px] text-fg-3">
        The plan orders on 14-day demand, so that is the error that matters: |Σ14 forecast − Σ14 sold| ÷ Σ14 sold, pooled over SKUs. Per-day error stays near{" "}
        {pct(m.mlWape)} for any method because daily sales of a few packs are random. On this synthetic data the true demand is known: against it the ML blend is off by about 8%
        over 14 days, the old average by 12% (npm run eval:forecast).
      </p>

      <dl className="mt-5 grid gap-4 border-t border-border pt-5 text-[12.5px] md:grid-cols-3">
        <div>
          <dt className="micro-label">Training</dt>
          <dd className="mt-1 text-fg-1">
            <span className="num">{model.trainRows.toLocaleString("en-IN")}</span> rows (SKU × day) · {model.featureNames.length} features
          </dd>
        </div>
        <div>
          <dt className="micro-label">Regularisation λ</dt>
          <dd className="mt-1 text-fg-1">
            <span className="num">{model.lambda}</span>{" "}
            <span className="text-fg-3">
              (validation: {m.validation.map((v) => `${v.lambda} → ${pct(v.wape)}`).join(", ")})
            </span>
          </dd>
        </div>
        <div>
          <dt className="micro-label">Features</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">
            {base.map((n) => (
              <span key={n} className="rounded border border-border-strong px-1.5 leading-5 text-fg-2">
                {FEATURE_TEXT[n]}
              </span>
            ))}
            <span className="rounded border border-border-strong px-1.5 leading-5 text-fg-2">day of week ({dows})</span>
            <span className="rounded border border-border-strong px-1.5 leading-5 text-fg-2">category ({cats})</span>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function Figure({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "brand" }) {
  return (
    <div>
      <p className="micro-label">{label}</p>
      <p className={`num mt-2 display text-[40px] leading-[44px] ${tone === "brand" ? "text-brand" : "text-fg-1"}`}>{value}</p>
      <p className="mt-1 text-fg-2">{note}</p>
    </div>
  );
}
