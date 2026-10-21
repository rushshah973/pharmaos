import Decimal from "decimal.js";

// All money maths goes through Decimal. Never use JS floats for rupees.
// Postgres numeric columns arrive from postgres.js as strings; pass them straight in.
export type MoneyInput = Decimal.Value;

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export function dec(value: MoneyInput): Decimal {
  return new D(value);
}

/** Round to paise (2 dp, half-up). Use for every stored line amount and total. */
export function roundMoney(value: MoneyInput): Decimal {
  return new D(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Round a per-pack unit price or cost (4 dp, half-up). */
export function roundUnit(value: MoneyInput): Decimal {
  return new D(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function sumMoney(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new D(0));
}

/** String with exactly 2 dp, for writing to numeric(14,2) columns and JSON responses. */
export function toMoneyString(value: MoneyInput): string {
  return roundMoney(value).toFixed(2);
}

/**
 * Indian-style rupee display, e.g. 200000 -> "₹2,00,000.00". UI only.
 * `{ paise: false }` rounds to whole rupees ("₹2,00,000") for KPI tiles and the top bar.
 */
export function formatINR(value: MoneyInput, opts: { paise?: boolean } = {}): string {
  const dp = opts.paise === false ? 0 : 2;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(new D(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toNumber());
}
