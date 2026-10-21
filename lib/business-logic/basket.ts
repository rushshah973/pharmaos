// §6.9 — greedy budget basket (pass 1) and the alternative-offer / partial-quantity second pass.
import type { BasketCandidate, BasketResult, Money } from "./types";
import { notImplemented } from "./_stub";

/** Candidates must already be in priority order. Guarantees Σ in-basket lineTotal ≤ budget. */
export const buildBasket: (candidates: BasketCandidate[], budget: Money) => BasketResult = () => notImplemented("buildBasket");
