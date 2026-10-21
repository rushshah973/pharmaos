// §6.4 — confirmed incoming, stock position, cover, safety stock, ROP, target and SKU status.
import type { EngineConfig } from "./config";
import type { IncomingInput, IsoDate, SkuStatus } from "./types";
import { notImplemented } from "./_stub";

/** Σ packs (+ free) on 'open' POs expected within the planning horizon. */
export const confirmedIncoming: (incoming: IncomingInput[], asOf: IsoDate, config?: EngineConfig) => number = () =>
  notImplemented("confirmedIncoming");

export const stockPosition: (eligibleAvailable: number, confirmedIncomingQty: number) => number = () =>
  notImplemented("stockPosition");

/** Days of cover; null when d̄ = 0 ("No reliable demand estimate"). */
export const coverDays: (stockPositionQty: number, avgDailyDemand: number) => number | null = () => notImplemented("coverDays");

export const safetyStock: (avgDailyDemand: number, config?: EngineConfig) => number = () => notImplemented("safetyStock");

export const reorderPoint: (avgDailyDemand: number, leadTimeDays: number, config?: EngineConfig) => number = () =>
  notImplemented("reorderPoint");

export const targetStock: (avgDailyDemand: number, leadTimeDays: number, config?: EngineConfig) => number = () =>
  notImplemented("targetStock");

export const skuStatus: (
  args: { avgDailyDemand: number; stockPosition: number; leadFastest: number },
  config?: EngineConfig,
) => SkuStatus = () => notImplemented("skuStatus");
