// §6.1 — UTC calendar dates as "YYYY-MM-DD". Never local-time getters.
import type { IsoDate } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Days since 1970-01-01 (UTC) for a YYYY-MM-DD string; throws on anything else. */
function utcDayNumber(date: IsoDate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Expected a YYYY-MM-DD date, got "${date}"`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Reject impossible dates such as 2026-02-30 (Date.UTC would roll them over).
  const check = new Date(ms);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid calendar date "${date}"`);
  }
  return ms / MS_PER_DAY;
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return utcDayNumber(to) - utcDayNumber(from);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new Error(`addDays needs whole days, got ${days}`);
  return new Date((utcDayNumber(date) + days) * MS_PER_DAY).toISOString().slice(0, 10);
}
