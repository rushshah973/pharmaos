// npm run debug:plan — load the planning context from the database and print the
// engine's plan at ₹2,00,000 and ₹1,00,000 (implementationplan.md §15 Stage 2).
// Read-only: nothing is saved.
import { config } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { buildPlan } from "@/lib/business-logic/engine";
import type { PlanResult, PlanningContext } from "@/lib/business-logic/types";
import { resolveAsOfDate } from "@/lib/services/as-of";
import { loadPlanningContext } from "@/lib/services/context";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const BUDGETS = ["200000.00", "100000.00"];
const TOP = 20;

const pad = (v: unknown, n: number, right = false) => {
  const s = String(v ?? "");
  return right ? s.padStart(n) : s.padEnd(n);
};

function printPlan(plan: PlanResult, ctx: PlanningContext) {
  const supplierCode = (id: string | null) => (id ? (ctx.skus[0]?.suppliers[id]?.code ?? "?") : "-");
  const inBasket = plan.lines.filter((l) => l.inBasket);
  console.log(`\n══ Budget ₹${plan.budget} ═══════════════════════════════════════════════════════════════`);
  console.log(
    `${pad("#", 3)} ${pad("SKU", 9)} ${pad("status", 13)} ${pad("cover", 6, true)} ${pad("qty+free", 9, true)} ${pad("supplier", 8)} ${pad("eff/pack", 10, true)} ${pad("line ₹", 11, true)} ${pad("priority", 8, true)}  basket    reasons`,
  );
  for (const l of plan.lines.slice(0, TOP)) {
    const offers = (l.evidence as { offers?: { offerId: string; effectiveCost: string | null }[] }).offers ?? [];
    const eff = offers.find((o) => o.offerId === l.offerId)?.effectiveCost ?? "-";
    console.log(
      `${pad(l.rank, 3)} ${pad(l.sku, 9)} ${pad(l.status, 13)} ${pad(l.cover === null ? "-" : l.cover.toFixed(1), 6, true)} ${pad(`${l.qty}+${l.freeQty}`, 9, true)} ${pad(supplierCode(l.supplierId), 8)} ${pad(eff, 10, true)} ${pad(l.totals?.lineTotal ?? "-", 11, true)} ${pad(l.priority.toFixed(4), 8, true)}  ${pad(l.inBasket ? "IN" : "deferred", 8)}  ${l.reasons.join(", ")}`,
    );
  }
  console.log(
    `\nLines ${plan.lines.length} · in basket ${inBasket.length} · deferred ${plan.lines.length - inBasket.length} · total ₹${plan.planTotal} · remaining ₹${plan.budgetRemaining}`,
  );
  console.log("Impact Card:");
  for (const [k, v] of Object.entries(plan.impact)) console.log(`  ${pad(k, 22)} ${v}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local).");
  const sql = postgres(url, { max: 4, prepare: false, onnotice: () => {} });
  try {
    const asOf = await resolveAsOfDate(sql);
    const [state] = await sql<{ active_scenario_id: string }[]>`select active_scenario_id from app_state where id = 1`;
    const scenario = state?.active_scenario_id ?? "baseline";
    const t0 = performance.now();
    const ctx = await loadPlanningContext(sql, asOf, scenario);
    const loadMs = Math.round(performance.now() - t0);
    console.log(`As-of ${asOf} · scenario ${scenario} · ${ctx.skus.length} SKUs loaded in ${loadMs} ms`);

    const plans = BUDGETS.map((b) => {
      const t = performance.now();
      const plan = buildPlan(ctx, b);
      console.log(`Plan at ₹${b} built in ${Math.round(performance.now() - t)} ms`);
      return plan;
    });
    plans.forEach((p) => printPlan(p, ctx));

    // ---- Checks ----
    console.log("\n══ Checks ═════════════════════════════════════════════════════════════════════");
    for (const plan of plans) {
      const priced = plan.lines.filter((l) => l.totals);
      const firstNonUrgent = priced.findIndex((l) => l.priority === 0);
      const urgentAfter = firstNonUrgent >= 0 && priced.slice(firstNonUrgent).some((l) => l.priority > 0);
      console.log(
        `₹${plan.budget}: urgent first ${urgentAfter ? "✗" : "✓"} · deferred ${plan.lines.some((l) => !l.inBasket) ? "✓" : "✗ none"} · total ≤ budget ${Number(plan.planTotal) <= Number(plan.budget) ? "✓" : "✗"}`,
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
