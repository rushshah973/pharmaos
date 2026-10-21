// §6.5 — candidate rule, order quantity with pack/MOQ rounding, and the scheme decision.
import type { EngineConfig } from "./config";
import type { Money, OrderQuantity, SchemeDecision } from "./types";
import { notImplemented } from "./_stub";

/** d̄ > 0 and stock position < ROP at the fastest eligible offer's lead time. */
export const isCandidate: (
  args: { avgDailyDemand: number; stockPosition: number; leadFastest: number },
  config?: EngineConfig,
) => boolean = () => notImplemented("isCandidate");

export const orderQuantity: (
  args: {
    avgDailyDemand: number;
    stockPosition: number;
    leadTimeDays: number;
    moq: number;
    packMultiple: number;
    hasAtRiskBatches: boolean;
  },
  config?: EngineConfig,
) => OrderQuantity = () => notImplemented("orderQuantity");

export const applyScheme: (
  args: {
    q: number;
    packMultiple: number;
    schemePaidQty: number;
    schemeFreeQty: number;
    stockPosition: number;
    avgDailyDemand: number;
    shelfLifeDays: number;
    /** Effective cost per pack without the scheme, for expiryAvoidedValue. */
    effectiveUnitCost: Money;
  },
  config?: EngineConfig,
) => SchemeDecision = () => notImplemented("applyScheme");
