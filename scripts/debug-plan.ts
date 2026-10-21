// npm run debug:plan — load the planning context from the database and print the
// engine's plan with its projected supplier POs (implementationplan.md §15 Stage 2).
// Read-only: nothing is saved.
import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { ENGINE_CONFIG } from "@/lib/business-logic/config";
import { buildPlan } from "@/lib/business-logic/engine";
import type { PlanResult, PlanningContext } from "@/lib/business-logic/types";
import { resolvePlanningState } from "@/lib/services/as-of";
import { loadPlanningContext } from "@/lib/services/context";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const TOP = 20;

const pad = (v: unknown, n: number, right = false) => {
  const s = String(v ?? "");
  return right ? s.padStart(n) : s.padEnd(n);
};

function printPlan(plan: PlanResult, ctx: PlanningContext) {
  const supplierCode = (id: string | null) => (id ? (ctx.skus[0]?.suppliers[id]?.code ?? "?") : "-");
  const included = plan.lines.filter((l) => l.inBasket);
  console.log(`\n══ Plan (PO approval above ₹${plan.approvalLimit}) ══════════════════════════════════════════════`);
  console.log(
    `${pad("#", 3)} ${pad("SKU", 9)} ${pad("status", 13)} ${pad("cover", 6, true)} ${pad("qty+free", 9, true)} ${pad("supplier", 8)} ${pad("eff/pack", 10, true)} ${pad("line ₹", 11, true)} ${pad("priority", 8, true)}  plan      reasons`,
  );
  for (const l of plan.lines.slice(0, TOP)) {
    const offers = (l.evidence as { offers?: { offerId: string; effectiveCost: string | null }[] }).offers ?? [];
    const eff = offers.find((o) => o.offerId === l.offerId)?.effectiveCost ?? "-";
    console.log(
      `${pad(l.rank, 3)} ${pad(l.sku, 9)} ${pad(l.status, 13)} ${pad(l.cover === null ? "-" : l.cover.toFixed(1), 6, true)} ${pad(`${l.qty}+${l.freeQty}`, 9, true)} ${pad(supplierCode(l.supplierId), 8)} ${pad(eff, 10, true)} ${pad(l.totals?.lineTotal ?? "-", 11, true)} ${pad(l.priority.toFixed(4), 8, true)}  ${pad(l.inBasket ? "IN" : "no offer", 8)}  ${l.reasons.join(", ")}`,
    );
  }
  console.log(
    `\nLines ${plan.lines.length} · in plan ${included.length} · no eligible offer ${plan.lines.length - included.length} · total ₹${plan.planTotal}`,
  );
  console.log("Projected POs:");
  for (const po of plan.supplierTotals) {
    console.log(`  ${pad(supplierCode(po.supplierId), 8)} ${pad(po.lines, 3, true)} lines  ₹${pad(po.total, 11, true)}  ${po.needsApproval ? "needs Owner approval" : "can be sent"}`);
  }
  console.log("Impact Card:");
  for (const [k, v] of Object.entries(plan.impact)) console.log(`  ${pad(k, 22)} ${v}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local).");
  const sql = postgres(url, { max: 4, onnotice: () => {} });
  try {
    const { asOf, scenarioId: scenario, approvalLimit } = await resolvePlanningState(sql);
    const t0 = performance.now();
    const ctx = await loadPlanningContext(sql, asOf, scenario);
    const loadMs = Math.round(performance.now() - t0);
    console.log(`As-of ${asOf} · scenario ${scenario} · ${ctx.skus.length} SKUs loaded in ${loadMs} ms`);

    const t = performance.now();
    const plans = [buildPlan(ctx, { ...ENGINE_CONFIG, poApprovalLimit: approvalLimit })];
    console.log(`Plan built in ${Math.round(performance.now() - t)} ms`);
    plans.forEach((p) => printPlan(p, ctx));

    // ---- Checks ----
    console.log("\n══ Checks ═════════════════════════════════════════════════════════════════════");
    for (const plan of plans) {
      const priced = plan.lines.filter((l) => l.totals);
      const firstNonUrgent = priced.findIndex((l) => l.priority === 0);
      const urgentAfter = firstNonUrgent >= 0 && priced.slice(firstNonUrgent).some((l) => l.priority > 0);
      console.log(
        `urgent first ${urgentAfter ? "✗" : "✓"} · every priced line in the plan ${priced.every((l) => l.inBasket) ? "✓" : "✗"} · PO totals add up ${plan.supplierTotals.reduce((n, p) => n + Number(p.total), 0).toFixed(2) === plan.planTotal ? "✓" : "✗"}`,
      );
    }
    const casesFile = path.resolve(process.cwd(), "data/synthetic/demo-cases.json");
    if (existsSync(casesFile)) {
      const cases = JSON.parse(readFileSync(casesFile, "utf8")) as Record<string, string[]>;
      const lineBySku = new Map(plans[0].lines.map((l) => [l.sku, l]));
      for (const [key, code] of [["cheapestTooSlow", "CHEAPER_OFFER_TOO_SLOW"], ["schemeSkip", "SCHEME_SKIPPED_EXPIRY"]] as const) {
        for (const sku of cases[key] ?? []) {
          const reasons = lineBySku.get(sku)?.reasons ?? [];
          console.log(`  ${pad(key, 16)} ${sku}: ${reasons.includes(code) ? "✓" : "✗"} ${code}  (${reasons.join(", ") || "not a plan line"})`);
        }
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
