// Owner email after the agents order stock (the Owner's request, 23 Oct 2026). One structured email per agent run
// that created POs, and one when the Owner approves an agent PO and it is sent. Sent through Resend's HTTP API to the
// Owner only (OWNER_EMAIL), never to a supplier. Safe by construction: it runs after the run is finished, has a
// 10 s timeout, never throws, and is skipped when RESEND_API_KEY or OWNER_EMAIL is not set. Every attempt is audited.
import { getSql } from "@/lib/db/client";
import { formatDisplayDate } from "@/lib/format/date";
import { formatINR, sumMoney } from "@/lib/money";
import { writeAudit } from "./audit";

const TIMEOUT_MS = 10_000;

export type EmailPo = {
  poId: string;
  poNumber: string;
  supplierName: string;
  supplierCode: string;
  status: string;
  grandTotal: string;
  lines: number;
  expectedDeliveryDate: string | null;
};
export type EmailLine = { poNumber: string; sku: string; name: string; qty: number; freeQty: number; lineTotal: string };
export type RunEmailData = {
  asOf: string;
  planId: string;
  pos: EmailPo[];
  lines: EmailLine[];
  forecastsChanged: number;
  suppliersSwitched: number;
  approvalLimit: string;
  appUrl: string;
};
export type Email = { subject: string; html: string; text: string };
export type SendResult = { status: "sent"; id: string | null } | { status: "skipped"; reason: string } | { status: "failed"; reason: string };

export function emailConfig() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return {
    apiKey: process.env.RESEND_API_KEY?.trim() || null,
    to: process.env.OWNER_EMAIL?.trim() || null,
    from: process.env.EMAIL_FROM?.trim() || "PharmaOS <onboarding@resend.dev>",
    appUrl: (process.env.APP_URL?.trim() || (host ? `https://${host}` : "https://pharmaos-gold.vercel.app")).replace(/\/$/, ""),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const rupees = (x: string) => formatINR(x, { paise: false });
const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  sent: { label: "Sent", color: "#15803d", bg: "#dcfce7" },
  pending_approval: { label: "Needs your approval", color: "#b45309", bg: "#fef3c7" },
  ready: { label: "Ready to send", color: "#334155", bg: "#e2e8f0" },
  approved: { label: "Approved", color: "#334155", bg: "#e2e8f0" },
};

/** The run email: what was ordered, from whom, what waits for the Owner, and what the agents changed. Pure. */
export function buildRunEmail(d: RunEmailData): Email {
  const sent = d.pos.filter((p) => p.status === "sent");
  const waiting = d.pos.filter((p) => p.status === "pending_approval");
  const total = sumMoney(d.pos.map((p) => p.grandTotal)).toFixed(2);
  const sentTotal = sumMoney(sent.map((p) => p.grandTotal)).toFixed(2);
  const date = formatDisplayDate(d.asOf);
  const medicines = new Set(d.lines.map((l) => l.sku)).size;
  const subject = waiting.length
    ? `PharmaOS · ${sent.length} PO${sent.length === 1 ? "" : "s"} sent, ${waiting.length} need${waiting.length === 1 ? "s" : ""} your approval · ${rupees(total)}`
    : `PharmaOS · ${sent.length} purchase order${sent.length === 1 ? "" : "s"} sent · ${rupees(sentTotal)} · ${date}`;

  const headline = waiting.length
    ? `${medicines} medicines restocked. ${waiting.length} order${waiting.length === 1 ? "" : "s"} above ${rupees(d.approvalLimit)} ${waiting.length === 1 ? "waits" : "wait"} for you.`
    : `${medicines} medicines restocked. ${sent.length} purchase order${sent.length === 1 ? "" : "s"} sent.`;

  const poRows = d.pos
    .map((p) => {
      const s = STATUS[p.status] ?? STATUS.ready;
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eef0f3;font-family:ui-monospace,Menlo,monospace;font-size:12.5px;color:#0f172a;white-space:nowrap">${esc(p.poNumber)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eef0f3;font-size:13px;color:#0f172a">${esc(p.supplierName)}<br><span style="color:#64748b;font-size:12px">${esc(p.supplierCode)} · ${p.lines} item${p.lines === 1 ? "" : "s"}${p.expectedDeliveryDate ? ` · arrives ${esc(formatDisplayDate(p.expectedDeliveryDate))}` : ""}</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #eef0f3;font-size:13px;color:#0f172a;text-align:right;white-space:nowrap">${esc(formatINR(p.grandTotal))}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #eef0f3;text-align:right"><span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:11.5px;font-weight:600;color:${s.color};background:${s.bg};white-space:nowrap">${s.label}</span></td>
      </tr>`;
    })
    .join("");

  const lineRows = d.lines
    .map(
      (l) => `<tr>
        <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a">${esc(l.name)} <span style="color:#94a3b8;font-family:ui-monospace,Menlo,monospace;font-size:11.5px">${esc(l.sku)}</span></td>
        <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#0f172a;text-align:right;white-space:nowrap">${l.qty.toLocaleString("en-IN")} packs${l.freeQty ? ` + ${l.freeQty} free` : ""}</td>
        <td style="padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;text-align:right;white-space:nowrap">${esc(l.poNumber)}</td>
      </tr>`,
    )
    .join("");

  const approveBlock = waiting.length
    ? `<tr><td style="padding:0 28px 8px">
        <div style="border:1px solid #fcd34d;background:#fffbeb;border-radius:12px;padding:16px">
          <p style="margin:0 0 8px;font-size:14px;color:#92400e;font-weight:600">Waiting for your approval</p>
          <p style="margin:0 0 12px;font-size:13px;color:#92400e">${waiting.map((p) => `${esc(p.poNumber)} · ${esc(p.supplierName)} · ${esc(formatINR(p.grandTotal))}`).join("<br>")}</p>
          <a href="${esc(d.appUrl)}/purchase-orders?filter=awaiting" style="display:inline-block;background:#b45309;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;padding:9px 16px;border-radius:999px">Review and approve</a>
        </div>
      </td></tr>`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
        <tr><td style="background:#111114;padding:20px 28px">
          <span style="font-size:16px;font-weight:600;color:#ffffff;letter-spacing:-0.02em">Pharma<span style="color:#ff8d4d">OS</span></span>
          <span style="float:right;font-size:12px;color:#a1a1aa;line-height:22px">Procurement update · ${esc(date)}</span>
        </td></tr>
        <tr><td style="padding:28px 28px 8px">
          <p style="margin:0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:600;letter-spacing:-0.02em">${esc(headline)}</p>
          <p style="margin:10px 0 0;font-size:14px;color:#475569">The procurement agents reviewed today's plan and ordered what runs out first.</p>
        </td></tr>
        <tr><td style="padding:16px 28px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${[
              ["Purchase orders", String(d.pos.length)],
              ["Sent to suppliers", String(sent.length)],
              ["Medicines restocked", String(medicines)],
              ["Total value", rupees(total)],
            ]
              .map(
                ([k, v]) =>
                  `<td style="padding:4px"><div style="border:1px solid #eef0f3;border-radius:12px;padding:12px"><div style="font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:#64748b">${k}</div><div style="margin-top:4px;font-size:20px;font-weight:600;color:#0f172a">${esc(v)}</div></div></td>`,
              )
              .join("")}
          </tr></table>
        </td></tr>
        ${approveBlock}
        <tr><td style="padding:16px 28px 4px"><p style="margin:0;font-size:13px;font-weight:600;color:#0f172a">Purchase orders</p></td></tr>
        <tr><td style="padding:0 28px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f3;border-radius:12px;border-collapse:separate;overflow:hidden">${poRows}</table>
        </td></tr>
        <tr><td style="padding:16px 28px 4px"><p style="margin:0;font-size:13px;font-weight:600;color:#0f172a">What was restocked</p></td></tr>
        <tr><td style="padding:0 28px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eef0f3;border-radius:12px;border-collapse:separate;overflow:hidden">${lineRows}</table>
        </td></tr>
        <tr><td style="padding:16px 28px 8px">
          <p style="margin:0;font-size:13px;color:#475569">AI agents: ${d.forecastsChanged} forecast${d.forecastsChanged === 1 ? "" : "s"} switched to the more accurate method · ${d.suppliersSwitched ? `${d.suppliersSwitched} supplier${d.suppliersSwitched === 1 ? "" : "s"} switched` : "every supplier kept"} · every decision is in the run's trace.</p>
        </td></tr>
        <tr><td style="padding:12px 28px 28px">
          <a href="${esc(d.appUrl)}/procurement/${esc(d.planId)}" style="display:inline-block;background:#ff8d4d;color:#111114;text-decoration:none;font-size:14px;font-weight:600;padding:11px 18px;border-radius:999px">Open the plan</a>
          <a href="${esc(d.appUrl)}/purchase-orders" style="display:inline-block;margin-left:8px;color:#0f172a;text-decoration:none;font-size:14px;padding:11px 14px">View purchase orders →</a>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:14px 28px;font-size:11.5px;color:#94a3b8">
          Sent to the Owner only. Sending to suppliers is simulated in this demo: no supplier was emailed. Synthetic demo data.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;

  const text = [
    headline,
    "",
    `Purchase orders: ${d.pos.length} · sent: ${sent.length} · medicines restocked: ${medicines} · total ${rupees(total)}`,
    ...(waiting.length ? ["", "Waiting for your approval:", ...waiting.map((p) => `- ${p.poNumber} ${p.supplierName} ${formatINR(p.grandTotal)}`), `Approve: ${d.appUrl}/purchase-orders?filter=awaiting`] : []),
    "",
    "Purchase orders:",
    ...d.pos.map((p) => `- ${p.poNumber} · ${p.supplierName} (${p.supplierCode}) · ${p.lines} items · ${formatINR(p.grandTotal)} · ${(STATUS[p.status] ?? STATUS.ready).label}`),
    "",
    "Restocked:",
    ...d.lines.map((l) => `- ${l.name} (${l.sku}): ${l.qty} packs${l.freeQty ? ` + ${l.freeQty} free` : ""} · ${l.poNumber}`),
    "",
    `Open the plan: ${d.appUrl}/procurement/${d.planId}`,
    "Sent to the Owner only. Sending to suppliers is simulated in this demo.",
  ].join("\n");
  return { subject, html, text };
}

/** The approval email: one agent PO the Owner approved, now sent. Pure. */
export function buildApprovedEmail(po: EmailPo, appUrl: string): Email {
  const subject = `PharmaOS · ${po.poNumber} approved and sent · ${rupees(po.grandTotal)}`;
  const text = `${po.poNumber} to ${po.supplierName} (${formatINR(po.grandTotal)}, ${po.lines} items) was approved by you and sent (simulated).\n${appUrl}/purchase-orders/${po.poId}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden">
      <div style="background:#111114;padding:18px 24px;font-size:16px;font-weight:600;color:#ffffff">Pharma<span style="color:#ff8d4d">OS</span></div>
      <div style="padding:24px">
        <p style="margin:0;font-size:20px;font-weight:600;color:#0f172a">${esc(po.poNumber)} approved and sent</p>
        <p style="margin:10px 0 0;font-size:14px;color:#475569">${esc(po.supplierName)} · ${po.lines} items · ${esc(formatINR(po.grandTotal))}${po.expectedDeliveryDate ? ` · arrives ${esc(formatDisplayDate(po.expectedDeliveryDate))}` : ""}</p>
        <a href="${esc(appUrl)}/purchase-orders/${esc(po.poId)}" style="display:inline-block;margin-top:18px;background:#ff8d4d;color:#111114;text-decoration:none;font-size:14px;font-weight:600;padding:10px 16px;border-radius:999px">View the purchase order</a>
      </div>
      <div style="background:#f8fafc;padding:12px 24px;font-size:11.5px;color:#94a3b8">Sent to the Owner only. Sending to suppliers is simulated in this demo.</div>
    </div></body></html>`;
  return { subject, html, text };
}

/** Sends one email to the Owner through Resend. Never throws. */
export async function sendOwnerEmail(email: Email): Promise<SendResult> {
  const cfg = emailConfig();
  if (!cfg.apiKey) return { status: "skipped", reason: "RESEND_API_KEY is not set" };
  if (!cfg.to) return { status: "skipped", reason: "OWNER_EMAIL is not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: cfg.from, to: [cfg.to], subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) return { status: "failed", reason: `Resend ${res.status}: ${body?.message ?? "request failed"}`.slice(0, 300) };
    return { status: "sent", id: body?.id ?? null };
  } catch (err) {
    return { status: "failed", reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}

/** POs (with supplier and item count) and their lines, for the emails. */
async function loadPos(poIds: string[]): Promise<{ pos: EmailPo[]; lines: EmailLine[] }> {
  if (poIds.length === 0) return { pos: [], lines: [] };
  const sql = getSql();
  const [pos, lines] = await Promise.all([
    sql<EmailPo[]>`
      select po.id as "poId", po.po_number as "poNumber", s.name as "supplierName", s.supplier_code as "supplierCode", po.status,
        po.grand_total::text as "grandTotal", (select count(*)::int from purchase_order_lines l where l.po_id = po.id) as lines,
        to_char(po.expected_delivery_date, 'YYYY-MM-DD') as "expectedDeliveryDate"
      from purchase_orders po join suppliers s on s.id = po.supplier_id
      where po.id = any(${poIds}::uuid[]) order by po.grand_total desc
    `,
    sql<EmailLine[]>`
      select po.po_number as "poNumber", p.sku, (p.brand_name || ' ' || p.strength) as name, l.quantity_packs as qty, l.free_qty as "freeQty", l.line_total::text as "lineTotal"
      from purchase_order_lines l join purchase_orders po on po.id = l.po_id join products p on p.id = l.product_id
      where po.id = any(${poIds}::uuid[]) order by l.line_total desc
    `,
  ]);
  return { pos, lines };
}

/** After an agent run: one email to the Owner about the POs it created. Never throws; audited either way. */
export async function notifyOwnerOfRun(args: { runId: string; planId: string; asOf: string; approvalLimit: string; poIds: string[]; forecastsChanged: number; suppliersSwitched: number }): Promise<SendResult> {
  let result: SendResult;
  try {
    const { pos, lines } = await loadPos(args.poIds);
    if (pos.length === 0) return { status: "skipped", reason: "the run created no purchase orders" };
    const email = buildRunEmail({ ...args, pos, lines, appUrl: emailConfig().appUrl });
    result = await sendOwnerEmail(email);
  } catch (err) {
    result = { status: "failed", reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
  await auditEmail("agent_run", args.runId, result).catch(() => {});
  return result;
}

/** After the Owner approves an agent PO and it is sent: a short confirmation. Never throws; audited either way. */
export async function notifyOwnerOfApprovedPo(poId: string): Promise<SendResult> {
  let result: SendResult;
  try {
    const { pos } = await loadPos([poId]);
    if (!pos[0]) return { status: "skipped", reason: "purchase order not found" };
    result = await sendOwnerEmail(buildApprovedEmail(pos[0], emailConfig().appUrl));
  } catch (err) {
    result = { status: "failed", reason: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
  await auditEmail("purchase_order", poId, result).catch(() => {});
  return result;
}

async function auditEmail(entityType: string, entityId: string, r: SendResult) {
  if (r.status === "skipped") return; // not configured: nothing happened worth a row
  await writeAudit({
    actorType: "system",
    actorId: "notifier",
    action: r.status === "sent" ? "email.sent" : "email.failed",
    entityType,
    entityId,
    after: r.status === "sent" ? { to: "owner", resendId: r.id } : { to: "owner", reason: r.reason },
  });
}
