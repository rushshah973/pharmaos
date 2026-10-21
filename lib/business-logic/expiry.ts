// §6.3 — FEFO sell-through projection, at-risk value and ineligible stock.
import type Decimal from "decimal.js";
import { dec, roundMoney, sumMoney } from "@/lib/money";
import { ENGINE_CONFIG, type EngineConfig } from "./config";
import { addDays, daysBetween } from "./dates";
import type { BalanceInput, BatchInput, BatchProjection, ExpiryResult, IneligibleBatch, IsoDate } from "./types";

const minDec = (a: Decimal, b: Decimal) => (a.lessThan(b) ? a : b);
const atLeastZero = (x: Decimal) => (x.isNegative() ? dec(0) : x);

export function projectExpiry(
  args: { batches: BatchInput[]; balances: BalanceInput[]; avgDailyDemand: number; asOf: IsoDate },
  config: EngineConfig = ENGINE_CONFIG,
): ExpiryResult {
  const { batches, balances, avgDailyDemand, asOf } = args;

  // On hand and reserved per batch, summed over its bins (unmapped stock included).
  const stock = new Map<string, { onHand: number; reserved: number }>();
  for (const b of balances) {
    const s = stock.get(b.batchId) ?? { onHand: 0, reserved: 0 };
    s.onHand += b.onHandQty;
    s.reserved += b.reservedQty;
    stock.set(b.batchId, s);
  }

  // Only released, unexpired batches are sellable; the rest are listed and never counted.
  const ineligible: IneligibleBatch[] = [];
  const eligible: BatchInput[] = [];
  for (const batch of batches) {
    const onHandQty = stock.get(batch.id)?.onHand ?? 0;
    if (batch.qualityStatus !== "released") {
      ineligible.push({ batchId: batch.id, batchNumber: batch.batchNumber, reason: batch.qualityStatus, onHandQty });
    } else if (batch.expiryDate <= asOf) {
      ineligible.push({ batchId: batch.id, batchNumber: batch.batchNumber, reason: "expired", onHandQty });
    } else {
      eligible.push(batch);
    }
  }

  // FEFO: earliest expiry first, then batch number.
  eligible.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.batchNumber.localeCompare(b.batchNumber));

  const demand = dec(avgDailyDemand);
  let consumed = dec(0);
  let totalSold = dec(0);
  let totalRisk = dec(0);
  const projections: BatchProjection[] = [];

  for (const batch of eligible) {
    const s = stock.get(batch.id) ?? { onHand: 0, reserved: 0 };
    // Reserved stock is subtracted here, once; nothing downstream subtracts it again.
    const available = dec(Math.max(0, s.onHand - s.reserved));
    const sellableDays = Math.max(0, daysBetween(asOf, addDays(batch.expiryDate, -config.expiryRiskWindowDays)));
    const capacity = atLeastZero(demand.times(sellableDays).minus(consumed));
    const sold = minDec(available, capacity);
    const atRisk = available.minus(sold);
    consumed = consumed.plus(sold);
    totalSold = totalSold.plus(sold);
    totalRisk = totalRisk.plus(atRisk);

    projections.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      daysToExpiry: daysBetween(asOf, batch.expiryDate),
      sellableDays,
      available: available.toNumber(),
      projectedSold: sold.toNumber(),
      atRiskQty: atRisk.toNumber(),
      atRiskValue: roundMoney(atRisk.times(batch.unitCost)).toFixed(2),
      returnPolicy: batch.returnPolicy,
    });
  }

  return {
    batches: projections,
    eligibleAvailable: totalSold.toNumber(),
    atRiskQty: totalRisk.toNumber(),
    atRiskValue: sumMoney(projections.map((p) => p.atRiskValue)).toFixed(2),
    ineligible,
  };
}
