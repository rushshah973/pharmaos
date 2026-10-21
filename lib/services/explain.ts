// Deterministic "Why?" for a plan line (implementationplan.md §7.7), built only from evidence_json.
// The agent (stage 6) may rephrase this; this text is the fallback and never needs an LLM.
import { dec } from "@/lib/money";
import { formatINR } from "@/lib/money";

type OfferEvidence = {
  offerId: string;
  supplierCode: string;
  exclusions: string[];
  effectiveCost: string | null;
  leadTimeDays: number;
  scheme: string | null;
};

type Evidence = {
  product?: { sku?: string; brandName?: string };
  stock?: { cover?: number | null; stockPosition?: number };
  policy?: { reorderPoint?: number; leadFastest?: number };
  offers?: OfferEvidence[];
  chosenOfferId?: string | null;
  qty?: number;
  freeQty?: number;
  reasons?: string[];
  expiryAvoidedValue?: string;
};

/** The line as it stands now (after owner edits), when it differs from the engine's evidence. */
export type CurrentLine = {
  qty: number;
  freeQty: number;
  offerId: string | null;
  status: string;
  inBasket: boolean;
  deferReason: string | null;
  reasons: string[];
};

const days = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)} day${n === 1 ? "" : "s"}`;
const packs = (n: number) => `${n.toLocaleString("en-IN")} pack${n === 1 ? "" : "s"}`;

export function explainLine(evidenceJson: Record<string, unknown>, current?: CurrentLine): string {
  const ev = evidenceJson as Evidence;
  const offers = ev.offers ?? [];
  const reasons = new Set(current?.reasons ?? ev.reasons ?? []);
  const cover = ev.stock?.cover ?? null;
  const name = ev.product?.brandName ?? ev.product?.sku ?? "This SKU";
  const offerId = current ? current.offerId : (ev.chosenOfferId ?? null);
  const chosen = offers.find((o) => o.offerId === offerId);
  const qty = current?.qty ?? ev.qty ?? 0;
  const freeQty = current?.freeQty ?? ev.freeQty ?? 0;
  const out: string[] = [];

  if (!chosen) {
    const blocked = [...new Set(offers.flatMap((o) => o.exclusions))].map((c) => c.toLowerCase().replaceAll("_", " "));
    out.push(
      `${name} needs stock${cover !== null ? ` (cover ${days(cover)})` : ""}, but no supplier offer can be used` +
        (blocked.length ? `: ${blocked.join(", ")}.` : "."),
    );
    return out.join(" ");
  }

  const free = freeQty > 0 ? ` + ${freeQty} free` : "";
  const why =
    cover === null
      ? "there is no recent demand to cover"
      : reasons.has("STOCKOUT_BEFORE_DELIVERY")
        ? `${cover <= 0 ? "stock has already run out" : `stock covers only ${days(cover)}`} and no supplier can deliver sooner than ${chosen.supplierCode}'s ${days(chosen.leadTimeDays)}`
        : `stock covers ${days(cover)} and ${chosen.supplierCode} delivers in ${days(chosen.leadTimeDays)}`;
  out.push(`Ordering ${packs(qty)}${free} from ${chosen.supplierCode} because ${why}.`);

  if (reasons.has("CHEAPER_OFFER_TOO_SLOW") && chosen.effectiveCost) {
    const cheaper = offers
      .filter((o) => o.exclusions.includes("TOO_SLOW_FOR_COVER") && o.effectiveCost && dec(o.effectiveCost).lessThan(chosen.effectiveCost!))
      .sort((a, b) => dec(a.effectiveCost!).comparedTo(b.effectiveCost!))[0];
    if (cheaper) {
      const pct = dec(chosen.effectiveCost).minus(cheaper.effectiveCost!).dividedBy(chosen.effectiveCost).times(100).toDecimalPlaces(0).toNumber();
      out.push(`${cheaper.supplierCode} is ${pct}% cheaper but takes ${days(cheaper.leadTimeDays)}, which is after the projected stockout.`);
    }
  }
  if (reasons.has("SCHEME_TAKEN") && chosen.scheme) {
    out.push(`The ${chosen.scheme} scheme is taken: the free packs sell well before expiry.`);
  }
  if (reasons.has("SCHEME_SKIPPED_EXPIRY") && chosen.scheme) {
    const avoided = ev.expiryAvoidedValue && dec(ev.expiryAvoidedValue).greaterThan(0) ? ` (${formatINR(ev.expiryAvoidedValue)} of stock that would expire)` : "";
    out.push(`The ${chosen.scheme} scheme is skipped because the extra stock would not sell before expiry${avoided}.`);
  }
  if (reasons.has("EXPIRY_REDUCED_QTY")) {
    out.push("The quantity is capped at the reorder point because existing batches are at expiry risk.");
  }

  if (current?.status === "deferred") out.push(`Deferred${current.deferReason ? `: ${current.deferReason}` : ""}.`);
  else if (current?.status === "rejected") out.push(`Rejected${current.deferReason ? `: ${current.deferReason}` : ""}.`);
  else if (current?.status === "edited" && !current.inBasket) out.push(`The owner's edit can no longer be bought (${current.deferReason ?? "hard stop"}).`);
  else if (current?.status === "edited") out.push("The owner edited this line.");
  return out.join(" ");
}
