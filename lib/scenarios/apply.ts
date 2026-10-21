// Applies a scenario's changes to a loaded planning context, in memory only (plan §12).
// P24 implements every scenario; until then only 'baseline' (no change) is supported.
import type { PlanningContext } from "@/lib/business-logic/types";

export function applyScenario(ctx: PlanningContext, scenarioId: string): PlanningContext {
  if (scenarioId === "baseline") return ctx;
  // TODO(P24): demand_spike, supplier_delay, budget_cut, expiry_risk.
  // Pick affected SKUs deterministically per SKU (e.g. from params or the SKU code), not from the
  // whole context: line edits load a single-SKU context and must see the same scenario effect.
  return ctx;
}
