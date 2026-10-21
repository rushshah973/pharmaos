// Heatmap modes for the warehouse views: label, colour token and the meaning of each severity step.
// Colour always ships with this text (legend, panel, table), never alone (§10.1).
import type { HeatmapMode, Severity } from "@/lib/business-logic/heatmap";

export type ModeMeta = {
  id: HeatmapMode;
  label: string;
  /** CSS colour (a token) the severity steps are tinted with. */
  tone: string;
  /** Text for severity 0, 1, 2, 3. */
  steps: [string, string, string, string];
  /** What the value inside a cell means, for the table header. */
  valueLabel: string;
  short: (value: number) => string;
};

export const MODES: ModeMeta[] = [
  {
    id: "stockout",
    label: "Stockout Risk",
    tone: "var(--stockout)",
    steps: ["Not at risk", "Cover 3 d or more", "Cover 1–3 d", "Cover under 1 d"],
    valueLabel: "Lowest cover",
    short: (v) => `${v.toFixed(1)}d`,
  },
  {
    id: "expiry",
    label: "Expiry Risk",
    tone: "var(--expiry)",
    steps: ["Nothing at risk", "Expires in over 90 d", "Expires in 31–90 d", "30 d or less, or expired"],
    valueLabel: "Days to expiry",
    short: (v) => (v < 0 ? "exp" : `${v}d`),
  },
  {
    id: "excess",
    label: "Excess Stock",
    tone: "var(--excess)",
    steps: ["No excess", "Under 2× target", "2–3× target", "3× target or more"],
    valueLabel: "Stock ÷ target",
    short: (v) => `${v.toFixed(1)}×`,
  },
  {
    id: "normal",
    label: "Normal",
    tone: "var(--neutral)",
    steps: ["Empty", "Under 70% full", "70–89% full", "90% full or more"],
    valueLabel: "Fill",
    short: (v) => `${v}%`,
  },
  {
    id: "proposed",
    label: "Proposed Replenishment",
    tone: "#22d3ee",
    steps: ["No proposed stock", "Under 70% full after put-away", "70–89% full after", "90% full or more after"],
    valueLabel: "Proposed packs",
    short: (v) => `+${v}`,
  },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<HeatmapMode, ModeMeta>;

const MIX: Record<Severity, number> = { 0: 0, 1: 22, 2: 46, 3: 78 };

/** Cell fill and border for a severity step. Severity 0 uses the plain raised surface. */
export function severityStyle(tone: string, severity: Severity): React.CSSProperties {
  if (severity === 0) return {};
  return {
    backgroundColor: `color-mix(in oklab, ${tone} ${MIX[severity]}%, var(--surface-2))`,
    borderColor: `color-mix(in oklab, ${tone} ${Math.min(100, MIX[severity] + 30)}%, transparent)`,
  };
}

export const STORAGE_LABEL: Record<string, string> = { ambient: "Ambient", cool: "Cool 8–15 °C", cold_chain: "Cold chain 2–8 °C" };
