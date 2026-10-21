// §6.2 — demand baseline d̄ = 0.6·d7 + 0.4·d28, plus NO_DEMAND / LOW_HISTORY / DEMAND_SPIKE flags.
import type { EngineConfig } from "./config";
import type { DemandResult, IsoDate, SalesPoint } from "./types";
import { notImplemented } from "./_stub";

export const computeDemand: (
  sales: SalesPoint[],
  asOf: IsoDate,
  firstSaleDate: IsoDate | null,
  config?: EngineConfig,
) => DemandResult = () => notImplemented("computeDemand");

