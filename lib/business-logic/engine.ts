// §6.12 — analyseSku() and buildPlan(): compose the modules above. Pure and deterministic.
import type { EngineConfig } from "./config";
import type { Money, PlanResult, PlanningContext, SkuAnalysis, SkuContext } from "./types";
import { notImplemented } from "./_stub";

export const analyseSku: (sku: SkuContext, config?: EngineConfig) => SkuAnalysis = () => notImplemented("analyseSku");

export const buildPlan: (ctx: PlanningContext, budget: Money, config?: EngineConfig) => PlanResult = () =>
  notImplemented("buildPlan");
