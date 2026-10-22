// Goods receipt against a real database: a seeded in-transit PO is received (one line short) into its suggested
// bins; stock becomes available, the PO is 'received', short-dated stock is refused, and a second receipt is
// refused. Skipped unless TEST_DATABASE_URL is set (a seeded PharmaOS database; the test changes one PO).
import { config } from "dotenv";
import { describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const T = 180_000;

describe.skipIf(!url)("goods receipt (integration)", () => {
  it(
    "receives an in-transit PO into bins; refuses short-dated stock and a second receipt",
    async () => {
      const { getSql } = await import("@/lib/db/client");
      const { getReceiptDraft, receivePurchaseOrder } = await import("@/lib/services/receiving");
      const sql = getSql();
      const [po] = await sql<{ id: string }[]>`select id::text from purchase_orders where status = 'open' order by expected_delivery_date limit 1`;
      const draft = await getReceiptDraft(po.id);
      const valid = draft.lines.map((l, i) => ({ lineId: l.lineId, qty: i === 0 ? Math.floor(l.qty / 2) : l.qty, batchNumber: `${l.batchNumber}T`, expiryDate: l.expiryDate, binId: l.binId! }));

      const shortDated = valid.map((l) => ({ ...l, expiryDate: draft.asOf }));
      await expect(receivePurchaseOrder(po.id, { lines: shortDated })).rejects.toMatchObject({ code: "RECEIPT_INVALID" });

      const res = await receivePurchaseOrder(po.id, { lines: valid });
      expect(res.status).toBe("received");
      expect(res.packs).toBe(valid.reduce((n, l) => n + l.qty, 0));
      expect(res.shortLines).toBeGreaterThanOrEqual(1);
      const [row] = await sql<{ status: string; received: number }[]>`
        select status, (select sum(received_qty)::int from purchase_order_lines where po_id = ${po.id}) as received from purchase_orders where id = ${po.id}`;
      expect(row).toEqual({ status: "received", received: res.packs });
      await expect(receivePurchaseOrder(po.id, { lines: valid })).rejects.toMatchObject({ code: "PO_NOT_RECEIVABLE" });
    },
    T,
  );
});
