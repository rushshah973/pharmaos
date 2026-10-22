// Every tunable number in the decision engine lives here, so the UI can show
// the policy and assumptions next to each recommendation.
export const ENGINE_CONFIG = {
  /** Confirmed incoming POs count only if expected within this many days of as-of date. */
  planningHorizonDays: 14,
  /** R in the target-stock formula: days until the next purchase review. */
  reviewPeriodDays: 14,
  /** Safety stock = max(minSafetyPacks, avg daily demand x safetyBufferDays). */
  safetyBufferDays: 5,
  minSafetyPacks: 2,
  /** A batch must be sold this many days before expiry (chemists refuse short-dated stock). */
  expiryRiskWindowDays: 90,
  /** Quotes older than this are stale even if still valid. */
  quoteStaleDays: 14,
  /** 7-day average at least this many times the 28-day average = flagged spike. */
  spikeRatio: 2,
  /** Demand blend: avg = w7 x last-7-day avg + w28 x last-28-day avg. */
  demandWeight7: 0.6,
  demandWeight28: 0.4,
  /** Stock position above target x excessFactor = excess stock. */
  excessFactor: 1.5,
  /** Supplier score weights (sum = 1). Factors are normalised to 0-100. */
  supplierWeights: { cost: 0.45, leadTime: 0.25, reliability: 0.2, terms: 0.1 },
  /** Payment terms at or beyond this many days score 100. */
  paymentTermsCapDays: 45,
  /** w_crit multiplier in loss prevented per rupee. */
  criticalityWeights: { life_saving: 2, chronic: 1.5, acute: 1, otc: 0.7 },
  /** A purchase order whose grand total is ABOVE this (rupees) needs Owner approval before it can be sent. */
  poApprovalLimit: "1000000.00" as string, // ₹10,00,000; a Money string; editable in app_state.po_approval_limit
} as const;

export type EngineConfig = typeof ENGINE_CONFIG;
