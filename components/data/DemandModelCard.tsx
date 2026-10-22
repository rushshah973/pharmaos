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
export function DemandModelCard({ model, skus }: { model: StoredModel | null; skus: number }) {
  if (!model) {
    return <EmptyState icon={BrainCircuit} title="No demand model yet" description="Run npm run train:forecast (or npm run seed) to train it. Until then every SKU uses the 7/28-day average." />;
  }
  const m = model.metrics;
  const mlWins = m.mlWape !== null && m.baselineWape !== null && m.mlWape < m.baselineWape;
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
        <span className="rounded-full border border-border-strong px-2.5 text-[12px] leading-6 text-fg-2">
          Trained {formatDateTime(model.trainedAt)} · as of {formatDisplayDate(model.asOf)}
        </span>
      </div>

      <div className="mt-5 grid gap-6 md:grid-cols-3">
        <Figure label="ML error (holdout)" value={pct(m.mlWape)} note={`Last ${model.holdoutDays} days, never seen in training`} tone={mlWins ? "brand" : undefined} />
        <Figure label="Average error (holdout)" value={pct(m.baselineWape)} note="0.6 × d7 + 0.4 × d28, held flat" />
        <Figure label="SKUs using ML" value={`${m.skusUsingMl} / ${skus}`} note="ML is used only where it was at least 5% better" />
      </div>

      <p className="mt-4 text-[12.5px] text-fg-3">
        Error is WAPE: Σ|actual − forecast| ÷ Σ actual, pooled over SKUs, per day. Daily sales of a few packs are noisy, so both errors are high; what matters is the gap, measured
        per SKU.
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
