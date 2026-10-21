// §6.6 — offer eligibility, effective landed cost, urgency rule, weighted score, price anomalies.
import type { EngineConfig } from "./config";
import type {
  IsoDate,
  Money,
  OfferExclusionCode,
  OfferInput,
  ScoreInput,
  ScoredOffer,
  SupplierInput,
  UrgencyResult,
} from "./types";
import { notImplemented } from "./_stub";

export const offerExclusions: (
  args: { offer: OfferInput; supplier: SupplierInput | undefined; productId: string; asOf: IsoDate; qty: number },
  config?: EngineConfig,
) => OfferExclusionCode[] = () => notImplemented("offerExclusions");

/** grossPerPack × paidShare + freight, rounded to 4 dp. */
export const effectiveUnitCost: (args: {
  unitPrice: Money;
  taxRate: Money;
  freightPerPack: Money;
  schemePaidQty: number | null;
  schemeFreeQty: number | null;
  schemeTaken: boolean;
}) => Money = () => notImplemented("effectiveUnitCost");

export const applyUrgencyRule: (
  offers: { offerId: string; leadTimeDays: number; effectiveCost: Money }[],
  cover: number | null,
) => UrgencyResult = () => notImplemented("applyUrgencyRule");

/** Scores every offer (factors 0–100) and returns them best first. */
export const scoreOffers: (offers: ScoreInput[], config?: EngineConfig) => ScoredOffer[] = () => notImplemented("scoreOffers");

/** Offer ids priced above 1.2 × the median unit price of the SKU's other offers. */
export const priceAnomalies: (offers: { offerId: string; unitPrice: Money }[]) => string[] = () =>
  notImplemented("priceAnomalies");
