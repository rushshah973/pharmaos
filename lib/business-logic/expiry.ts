// §6.3 — FEFO sell-through projection, at-risk value and ineligible stock.
import type { EngineConfig } from "./config";
import type { BalanceInput, BatchInput, ExpiryResult, IsoDate } from "./types";
import { notImplemented } from "./_stub";

export const projectExpiry: (
  args: { batches: BatchInput[]; balances: BalanceInput[]; avgDailyDemand: number; asOf: IsoDate },
  config?: EngineConfig,
) => ExpiryResult = () => notImplemented("projectExpiry");
