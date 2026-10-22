// Ask PharmaOS: the manual function-calling loop (implementationplan.md §9.4) on Gemini via @google/genai.
// We run every tool ourselves (automatic function calling is off): allow-list + Zod re-validation in runTool.
// The model turn is appended EXACTLY as returned (keeps thoughtSignature parts); all function responses go back in
// ONE user turn, in call order, with matching id and name. Any failure → a deterministic answer (source
// 'deterministic'): missing key, ApiError (429 / 5xx), network or timeout, a non-STOP finish reason, or 8 turns.
import { CALL_TIMEOUT_MS, DEFAULT_GEMINI_MODEL, modelChain, withRetry } from "./retry";
import { ApiError, type Content, FinishReason, FunctionCallingConfigMode, GoogleGenAI, type Part } from "@google/genai";
import { formatINR } from "@/lib/money";
import { resolvePlanningState } from "@/lib/services/as-of";
import { writeAudit } from "@/lib/services/audit";
import { getPlan } from "@/lib/services/plans";
import { SYSTEM_PROMPT } from "./prompts";
import { FUNCTION_DECLARATIONS, type Reference, runTool } from "./tools";

const MAX_TURNS = 8;

export type AgentReply = {
  reply: string;
  toolCalls: { name: string; ok: boolean; ms: number }[];
  references: Reference[];
  source: "agent" | "deterministic";
  /** Why the deterministic path answered (for logs and the UI note); absent when the agent answered. */
  fallbackReason?: string;
};

export async function runAgent({ message, planId }: { message: string; planId?: string }): Promise<AgentReply> {
  const toolCalls: AgentReply["toolCalls"] = [];
  const references = new Map<string, Reference>();
  const fallback = async (reason: string): Promise<AgentReply> => ({
    reply: await deterministicReply(planId),
    toolCalls,
    references: [...references.values()],
    source: "deterministic",
    fallbackReason: reason,
  });

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return fallback("GEMINI_API_KEY is not set");
  const ai = new GoogleGenAI({ apiKey }); // server only
  const models = modelChain(process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL);
  let active = 0; // stays on the backup model once it has answered

  const { asOf } = await resolvePlanningState();
  const contents: Content[] = [{ role: "user", parts: [{ text: `${message}\n\nContext: planId=${planId ?? "none"}, asOf=${asOf}` }] }];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      // One quick retry on a transient error, on the backup model: the person is waiting for the answer.
      const response = await withRetry(
        (attempt) => {
          const i = Math.min(active + attempt, models.length - 1);
          return ai.models.generateContent({
            model: models[i],
            contents,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              tools: [{ functionDeclarations: FUNCTION_DECLARATIONS }],
              toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
              automaticFunctionCalling: { disable: true },
              maxOutputTokens: 8192,
              httpOptions: { timeout: CALL_TIMEOUT_MS },
            },
          }).then((r) => {
            active = i;
            return r;
          });
        },
        [1000],
      );
      const candidate = response.candidates?.[0];
      const finish = candidate?.finishReason;
      if (!candidate?.content) return fallback("the model returned no content");
      if (finish && finish !== FinishReason.STOP) return fallback(`finish reason ${finish}`);

      const calls = response.functionCalls ?? [];
      if (calls.length === 0) {
        const text = response.text?.trim();
        if (!text) return fallback("the model returned no text");
        const note = asksToAct(message) ? await policyNote() : null;
        return { reply: note ? `${text}\n\n${note}` : text, toolCalls, references: [...references.values()], source: "agent" };
      }

      contents.push(candidate.content); // exactly as returned
      const parts: Part[] = [];
      for (const call of calls) {
        const run = await runTool(call.name, call.args);
        toolCalls.push({ name: run.name, ok: run.ok, ms: run.ms });
        for (const r of run.refs) references.set(`${r.type}:${r.id}`, r);
        if (run.mutates) {
          await writeAudit({
            actorType: "agent",
            actorId: "ask-pharmaos",
            action: "agent.tool_call",
            entityType: "plan",
            entityId: (call.args as { planId?: string } | undefined)?.planId ?? planId ?? null,
            after: { tool: run.name, ok: run.ok, ms: run.ms },
          });
        }
        parts.push({ functionResponse: { id: call.id, name: call.name, response: run.result as unknown as Record<string, unknown> } });
      }
      contents.push({ role: "user", parts }); // all responses in ONE user turn, same order as the calls
    }
    return fallback(`no answer after ${MAX_TURNS} turns`);
  } catch (err) {
    if (err instanceof ApiError) return fallback(`Gemini API error ${err.status}`);
    const msg = err instanceof Error ? err.message : String(err);
    return fallback(/abort|timeout|timed out/i.test(msg) ? "Gemini timed out" : `network error: ${msg.slice(0, 120)}`);
  }
}

/** What Ask PharmaOS says without the model: the plan's facts, straight from the services. */
async function deterministicReply(planId?: string): Promise<string> {
  const note = "AI unavailable — showing calculated figures.";
  if (!planId) return `${note} Open a purchase plan to see its totals, supplier POs and which need Owner approval.`;
  try {
    const p = await getPlan(planId);
    const limit = formatINR(p.approvalLimit, { paise: false });
    const gated = p.supplierPos.filter((s) => s.needsApproval);
    const pos = p.supplierPos.map((s) => `${s.supplierCode} ${formatINR(s.total)}${s.needsApproval ? " (needs Owner approval)" : ""}`).join(", ");
    return [
      note,
      `This plan totals ${formatINR(p.proposedTotal)} across ${p.supplierPos.length} supplier PO${p.supplierPos.length === 1 ? "" : "s"}: ${pos}.`,
      gated.length > 0
        ? `${gated.length} PO${gated.length === 1 ? " is" : "s are"} above ${limit}, so the Owner must approve before sending.`
        : `No PO is above ${limit}, so none needs Owner approval.`,
      "Approve lines with the Approve button; sending is simulated and nothing leaves the app.",
    ].join(" ");
  } catch {
    return `${note} The plan could not be loaded.`;
  }
}

/** The user asked PharmaOS to edit, approve, create or send something (which it cannot do). */
function asksToAct(message: string): boolean {
  return /\b(change|edit|set|update|approve|reject|create|prepare|place|raise|send|submit|order)\b/i.test(message) && /\b(po|pos|purchase orders?|order|line|qty|quantity|packs?)\b/i.test(message);
}

/**
 * A fixed note (app text, not model output) appended when the user asks the agent to act: who does each step, the
 * Owner rule and that sending is simulated. Keeps the answer complete whatever the model chose to say.
 */
async function policyNote(): Promise<string> {
  const { approvalLimit } = await resolvePlanningState();
  return [
    "**What happens next (you do these steps; PharmaOS AI cannot):**",
    "- Change a quantity or supplier in the line's **Edit** dialog.",
    "- Approve lines with the **Approve** button; PharmaOS then creates one purchase order per supplier.",
    `- A purchase order above **${formatINR(approvalLimit, { paise: false })}** needs the **Owner's approval** before it can be sent.`,
    "- **Sending is simulated**: nothing leaves the app.",
  ].join("\n");
}
