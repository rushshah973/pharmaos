// Applies a scenario's changes to a loaded planning context, in memory only (plan §12).
// P24 implements every scenario; until then only 'baseline' (no change) is supported.
import type { PlanningContext } from "@/lib/business-logic/types";

export function applyScenario(ctx: PlanningContext, scenarioId: string): PlanningContext {
  if (scenarioId === "baseline") return ctx;
  // TODO(P24): demand_spike, supplier_delay, budget_cut, expiry_risk.
  return ctx;
}
