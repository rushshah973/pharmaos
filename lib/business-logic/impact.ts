// §6.10 — Plan Impact Card.
import { sumMoney } from "@/lib/money";
import type { ImpactCard, LineTotals, Money, ReasonCode, SkuStatus, SupplierTotal } from "./types";

export function computeImpact(args: {
  skus: { status: SkuStatus; atRiskValue: Money }[];
  lines: {
    status: SkuStatus;
    inBasket: boolean; // in the plan and counted (not deferred / rejected, has an offer)
    lossPrevented: Money;
    totals: LineTotals | null;
    reasons: ReasonCode[];
    expiryAvoidedValue: Money;
  }[];
  supplierTotals: SupplierTotal[];
}): ImpactCard {
  const included = args.lines.filter((l) => l.inBasket);
  const excluded = args.lines.filter((l) => !l.inBasket);

  const marginProtected = sumMoney(included.map((l) => l.lossPrevented));
  // Expiry avoided by this plan's purchases: free goods not taken because they would have expired.
  const expiryAvoided = sumMoney(included.filter((l) => l.reasons.includes("SCHEME_SKIPPED_EXPIRY")).map((l) => l.expiryAvoidedValue));
  const totalSpend = sumMoney(included.map((l) => l.totals?.lineTotal ?? "0"));

  return {
    skusAtRisk: args.skus.filter((s) => s.status === "STOCKOUT_RISK").length,
    stockoutsCovered: included.filter((l) => l.status === "STOCKOUT_RISK").length,
    marginProtected: marginProtected.toFixed(2),
    expiryExposure: sumMoney(args.skus.map((s) => s.atRiskValue)).toFixed(2),
    expiryAvoided: expiryAvoided.toFixed(2),
    totalSpend: totalSpend.toFixed(2),
    poCount: args.supplierTotals.length,
    posNeedingApproval: args.supplierTotals.filter((s) => s.needsApproval).length,
    excludedCount: excluded.length,
    excludedRisk: sumMoney(excluded.map((l) => l.lossPrevented)).toFixed(2),
    lossPreventedPerRupee: totalSpend.greaterThan(0)
      ? marginProtected.plus(expiryAvoided).dividedBy(totalSpend).toDecimalPlaces(6).toNumber()
      : null,
  };
}
