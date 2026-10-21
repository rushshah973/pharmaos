// §6.10 — Plan Impact Card.
import type { ImpactCard, LineTotals, Money, ReasonCode, SkuStatus } from "./types";
import { notImplemented } from "./_stub";

export const computeImpact: (args: {
  skus: { status: SkuStatus; atRiskValue: Money }[];
  lines: {
    status: SkuStatus;
    inBasket: boolean;
    lossPrevented: Money;
    totals: LineTotals | null;
    reasons: ReasonCode[];
    expiryAvoidedValue: Money;
  }[];
  budget: Money;
}) => ImpactCard = () => notImplemented("computeImpact");
