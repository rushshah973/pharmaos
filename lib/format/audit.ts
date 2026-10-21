// Plain-language summary of an audit row's before → after (Activity log, §10.3).

export type AuditView = {
  id: string;
  createdAt: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  reason: string | null;
};

const LABEL: Record<string, string> = {
  status: "status",
  qty: "qty",
  freeQty: "free",
  lineTotal: "line ₹",
  planTotal: "plan ₹",
  grandTotal: "PO ₹",
  supplierCode: "supplier",
  lines: "lines",
  included: "lines in plan",
  pos: "POs",
  posNeedingApproval: "POs needing approval",
  mlWape: "ML error",
  baselineWape: "average error",
  skusUsingMl: "SKUs on ML",
  lambda: "λ",
  note: "note",
};

const SKIP = new Set(["offerId", "planId", "approvalLimit", "idempotencyKey", "asOf", "scenarioId", "supplierId", "changed", "purchaseOrders", "lineIds", "simulated", "format"]);

function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString("en-IN") : v < 1 ? `${(v * 100).toFixed(1)}%` : v.toFixed(2);
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  if (/^\d+\.\d{2}$/.test(s)) return `₹${Number(s).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return s.length > 40 ? `${s.slice(0, 39)}…` : s.replaceAll("_", " ");
}

/** Up to 4 "field: before → after" items (or "field: value" when there is no before). */
export function changeSummary(before: unknown, after: unknown): string[] {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const key of Object.keys(a)) {
    if (SKIP.has(key) || typeof a[key] === "object") continue;
    const label = LABEL[key] ?? key;
    if (key in b) {
      if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) out.push(`${label}: ${show(b[key])} → ${show(a[key])}`);
    } else out.push(`${label}: ${show(a[key])}`);
    if (out.length >= 4) break;
  }
  if (Array.isArray(a.changed) && a.changed.length) out.push(`${a.changed.length} line(s) moved in or out`);
  if (Array.isArray(a.purchaseOrders)) out.push(`${a.purchaseOrders.length} PO(s) created`);
  return out;
}
