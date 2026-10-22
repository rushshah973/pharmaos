// The AI plan summary (implementationplan.md §9.1): 3–5 sentences written by the Ask PharmaOS agent from tool
// results, after the plan is saved (non-blocking). Without a key, or if the agent fails, the plan simply has no
// summary; nothing in the plan depends on it.
import { savePlanSummary } from "@/lib/services/plans";
import { runAgent } from "./orchestrator";

const PROMPT =
  "Summarise this purchase plan for the owner in 3 to 5 short sentences of plain prose (no lists, no headings, " +
  "no markdown). Cover the plan total, how many lines and supplier POs, which supplier POs need Owner approval, " +
  "and the most urgent SKUs (stockout risk first). Use get_plan and get_po_projection for every number.";

export async function generatePlanSummary(planId: string): Promise<void> {
  try {
    const r = await runAgent({ message: PROMPT, planId, budgetMs: 120_000 }); // runs after the response: nobody waits
    await savePlanSummary(planId, r.source === "agent" ? r.reply.trim() : null);
  } catch (err) {
    console.error("[plan summary]", err);
    await savePlanSummary(planId, null).catch(() => {});
  }
}
