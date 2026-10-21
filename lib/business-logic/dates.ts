// §6.1 — UTC calendar dates as "YYYY-MM-DD". Never local-time getters.
import type { IsoDate } from "./types";
import { notImplemented } from "./_stub";

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export const daysBetween: (from: IsoDate, to: IsoDate) => number = () => notImplemented("daysBetween");

export const addDays: (date: IsoDate, days: number) => IsoDate = () => notImplemented("addDays");
