// §6.11 — hard stops (block approval) and soft warnings (allowed with a note).
import type { EngineConfig } from "./config";
import type { BatchInput, HardStopCode, IsoDate, Money, OfferInput, ProductInput, SupplierInput, WarningCode } from "./types";
import { notImplemented } from "./_stub";

export const hardStops: (
  args: {
    product: ProductInput | undefined;
    offer: OfferInput | undefined;
    supplier: SupplierInput | undefined;
    qty: number;
    asOf: IsoDate;
    budget: Money;
    planTotal: Money;
    batches: BatchInput[];
  },
  config?: EngineConfig,
) => HardStopCode[] = () => notImplemented("hardStops");

export const softWarnings: (args: {
  hasAtRiskBatches: boolean;
  chosenIsTopScored: boolean;
  demandFlags: WarningCode[];
  schemeWarning: WarningCode | null;
  priceAnomaly: boolean;
  capacityReview: boolean;
  hasUnmappedStock: boolean;
}) => WarningCode[] = () => notImplemented("softWarnings");
