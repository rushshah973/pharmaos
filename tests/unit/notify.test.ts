// The Owner email after an agent run: what it says, that it escapes data, and that it is skipped safely when email
// is not set up (no network in these tests).
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApprovedEmail, buildRunEmail, sendOwnerEmail, type RunEmailData } from "@/lib/services/notify";

const base: RunEmailData = {
  asOf: "2026-10-21",
  planId: "11111111-1111-4111-8111-111111111111",
  approvalLimit: "1000000.00",
  appUrl: "https://example.test",
  forecastsChanged: 8,
  suppliersSwitched: 0,
  pos: [
    { poId: "a", poNumber: "PO-20261023-1003", supplierName: "Shreeji Medical Agencies", supplierCode: "SUP-01", status: "sent", grandTotal: "103577.39", lines: 3, expectedDeliveryDate: "2026-10-22" },
    { poId: "b", poNumber: "PO-20261023-1001", supplierName: "Shreeji Drug House", supplierCode: "SUP-06", status: "sent", grandTotal: "69657.75", lines: 3, expectedDeliveryDate: "2026-10-22" },
  ],
  lines: [
    { poNumber: "PO-20261023-1003", sku: "PHX-0115", name: "Vexolin 500 500mg", qty: 545, freeQty: 0, lineTotal: "70589.04" },
    { poNumber: "PO-20261023-1001", sku: "PHX-0220", name: "Revolin 100 100IU/ml", qty: 336, freeQty: 0, lineTotal: "18500.00" },
  ],
};

describe("Owner email", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("summarises the sent POs and what was restocked", () => {
    const e = buildRunEmail(base);
    expect(e.subject).toBe("PharmaOS · 2 purchase orders sent · ₹1,73,235 · 21 Oct 2026");
    expect(e.html).toContain("2 medicines restocked. 2 purchase orders sent.");
    expect(e.html).toContain("PO-20261023-1003");
    expect(e.html).toContain("Vexolin 500 500mg");
    expect(e.html).toContain("https://example.test/procurement/11111111-1111-4111-8111-111111111111");
    expect(e.html).not.toContain("Waiting for your approval");
    expect(e.text).toContain("- Vexolin 500 500mg (PHX-0115): 545 packs · PO-20261023-1003");
  });

  it("asks the Owner to approve a PO above the limit, with a link", () => {
    const e = buildRunEmail({ ...base, pos: [...base.pos, { ...base.pos[0], poId: "c", poNumber: "PO-20261023-1016", status: "pending_approval", grandTotal: "1100150.60" }] });
    expect(e.subject).toContain("2 POs sent, 1 needs your approval");
    expect(e.html).toContain("Waiting for your approval");
    expect(e.html).toContain("https://example.test/purchase-orders?filter=awaiting");
  });

  it("escapes data before putting it in HTML", () => {
    const e = buildRunEmail({ ...base, pos: [{ ...base.pos[0], supplierName: "<script>x</script> & Co" }] });
    expect(e.html).not.toContain("<script>x</script>");
    expect(e.html).toContain("&lt;script&gt;x&lt;/script&gt; &amp; Co");
  });

  it("the approval email names the PO and links to it", () => {
    const e = buildApprovedEmail(base.pos[0], "https://example.test");
    expect(e.subject).toBe("PharmaOS · PO-20261023-1003 approved and sent · ₹1,03,577");
    expect(e.html).toContain("https://example.test/purchase-orders/a");
  });

  it("is skipped, with no request, when the key or the Owner address is missing", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("OWNER_EMAIL", "owner@example.test");
    expect(await sendOwnerEmail(buildRunEmail(base))).toEqual({ status: "skipped", reason: "RESEND_API_KEY is not set" });
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("OWNER_EMAIL", "");
    expect(await sendOwnerEmail(buildRunEmail(base))).toEqual({ status: "skipped", reason: "OWNER_EMAIL is not set" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports a provider error instead of throwing", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("OWNER_EMAIL", "owner@example.test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 }));
    expect(await sendOwnerEmail(buildRunEmail(base))).toEqual({ status: "failed", reason: "Resend 403: domain not verified" });
  });
});
