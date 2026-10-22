// The shared agent loop for the procurement pipeline (implementationplan.md §9.5): the same Gemini rules as Ask
// PharmaOS (§9.4) — mode AUTO, automatic function calling disabled, candidate.content appended unchanged, all
// functionResponses in ONE user turn in call order with matching id and name, every call.args Zod-validated,
// max 12 turns, 15 s per call, transient Gemini errors (429/5xx) retried twice — but each agent sees only its own tools plus ONE terminal submit_* tool, and must
// finish by calling it. Every tool call goes to agent_steps. An invalid terminal call (or a reply with no call) is
// sent back as an error up to 2 times; after that, or on any API failure, the agent returns a fallback.
import { ApiError, type Content, type FunctionCall, type FunctionDeclaration, FinishReason, FunctionCallingConfigMode, GoogleGenAI, type Part } from "@google/genai";
import { z } from "zod";
import { ServiceError } from "@/lib/api/errors";
import { type ToolResult, toolError, toolOk } from "@/lib/validation/tool-contract";
import { RETRY_DELAYS_MS, withRetry } from "../retry";
import type { AgentName, StepSink } from "@/lib/services/agent-runs";

export const MAX_TURNS = 12;
export const TIMEOUT_MS = 15_000;
export const TERMINAL_RETRIES = 2;

/** The slice of the Gemini SDK the loop uses; tests pass a scripted fake. */
export type ModelResponse = {
  candidates?: { content?: Content; finishReason?: string }[];
  functionCalls?: FunctionCall[];
  text?: string;
};
export type ModelClient = { generateContent(req: { model: string; contents: Content[]; config: Record<string, unknown> }): Promise<ModelResponse> };

/** The real client, or null when no key is configured (→ fallback). */
export function geminiClient(): ModelClient | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  const ai = new GoogleGenAI({ apiKey });
  return { generateContent: (req) => ai.models.generateContent(req) as Promise<ModelResponse> };
}

export type AgentTool = {
  name: string;
  description: string;
  schema: z.ZodObject;
  handler: (args: never) => Promise<unknown>;
};

export type Terminal<R> = {
  name: string;
  description: string;
  /** Sent to Gemini as parametersJsonSchema (typed, for guidance). */
  declared: z.ZodObject;
  /** Structural check of the terminal call; per-item guardrails run inside apply(). */
  schema: z.ZodObject;
  apply: (args: never) => Promise<R>;
};

export type AgentOutcome<R> = { status: "done"; result: R; turns: number } | { status: "fallback"; reason: string; turns: number };

const declaration = (name: string, description: string, schema: z.ZodObject): FunctionDeclaration => {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  void _drop;
  return { name, description, parametersJsonSchema: json };
};

function issues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
}

export async function runAgentLoop<R>(args: {
  agent: AgentName;
  client: ModelClient;
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools: AgentTool[];
  terminal: Terminal<R>;
  log: StepSink;
  /** Backoff before retrying a transient Gemini error (429/5xx); tests pass zeros. */
  retryDelaysMs?: readonly number[];
}): Promise<AgentOutcome<R>> {
  const { agent, client, model, systemPrompt, userMessage, tools, terminal, log } = args;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const functionDeclarations = [...tools.map((t) => declaration(t.name, t.description, t.schema)), declaration(terminal.name, terminal.description, terminal.declared)];
  const contents: Content[] = [{ role: "user", parts: [{ text: userMessage }] }];
  let terminalErrors = 0;

  const fallback = async (reason: string, turns: number): Promise<AgentOutcome<R>> => {
    await log.add({ agent, kind: "fallback", output: { reason }, ok: false });
    return { status: "fallback", reason, turns };
  };

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let response: ModelResponse;
    try {
      response = await withRetry(
        () =>
          client.generateContent({
            model,
            contents,
            config: {
              systemInstruction: systemPrompt,
              tools: [{ functionDeclarations }],
              toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
              automaticFunctionCalling: { disable: true },
              maxOutputTokens: 8192,
              httpOptions: { timeout: TIMEOUT_MS },
            },
          }),
        args.retryDelaysMs ?? RETRY_DELAYS_MS,
        (err, attempt) => console.warn(`[agent ${agent}] Gemini ${(err as ApiError).status}, retry ${attempt}`),
      );
    } catch (err) {
      if (err instanceof ApiError) return fallback(`Gemini API error ${err.status}`, turn);
      const msg = err instanceof Error ? err.message : String(err);
      return fallback(/abort|timeout|timed out/i.test(msg) ? "Gemini timed out" : `network error: ${msg.slice(0, 120)}`, turn);
    }

    const candidate = response.candidates?.[0];
    if (!candidate?.content) return fallback("the model returned no content", turn);
    if (candidate.finishReason && candidate.finishReason !== FinishReason.STOP) return fallback(`finish reason ${candidate.finishReason}`, turn);
    const calls = response.functionCalls ?? [];

    if (calls.length === 0) {
      // A reply with no call: the agent must finish with its terminal tool.
      const text = response.text?.trim() ?? "";
      await log.add({ agent, kind: "message", output: { text: text.slice(0, 2000) } });
      if (++terminalErrors > TERMINAL_RETRIES) return fallback(`no ${terminal.name} call after ${TERMINAL_RETRIES} reminders`, turn);
      contents.push(candidate.content);
      contents.push({ role: "user", parts: [{ text: `Finish by calling ${terminal.name} with your decisions.` }] });
      continue;
    }

    contents.push(candidate.content); // exactly as returned (keeps thoughtSignature parts)
    const parts: Part[] = [];
    let finished: R | undefined;
    for (const call of calls) {
      const t0 = performance.now();
      let result: ToolResult<unknown>;
      if (call.name === terminal.name) {
        const parsed = terminal.schema.safeParse(call.args ?? {});
        if (!parsed.success) {
          terminalErrors++;
          result = toolError("INVALID_TOOL_INPUT", `${terminal.name}: ${issues(parsed.error)}. Call ${terminal.name} again with valid arguments.`);
        } else {
          try {
            finished = await terminal.apply(parsed.data as never);
            result = toolOk(finished);
          } catch (err) {
            terminalErrors++;
            result = toolError(err instanceof ServiceError ? err.code : "TOOL_FAILED", err instanceof Error ? err.message : "The terminal call failed.");
          }
        }
      } else {
        const tool = call.name ? byName.get(call.name) : undefined;
        if (!tool) {
          result = toolError("INVALID_TOOL_INPUT", `Unknown tool ${call.name ?? ""}. Only these tools exist: ${[...byName.keys(), terminal.name].join(", ")}.`);
        } else {
          const parsed = tool.schema.safeParse(call.args ?? {});
          if (!parsed.success) result = toolError("INVALID_TOOL_INPUT", issues(parsed.error));
          else {
            try {
              result = toolOk(await tool.handler(parsed.data as never));
            } catch (err) {
              result = err instanceof ServiceError ? toolError(err.code, err.message) : toolError("TOOL_FAILED", "The tool failed while reading data.");
              if (!(err instanceof ServiceError)) console.error(`[agent ${agent} ${call.name}]`, err);
            }
          }
        }
      }
      const ms = Math.round(performance.now() - t0);
      await log.add({ agent, kind: "tool_call", toolName: call.name ?? "?", input: call.args ?? {}, output: result, ok: result.ok, ms });
      parts.push({ functionResponse: { id: call.id, name: call.name, response: result as unknown as Record<string, unknown> } });
    }
    if (finished !== undefined) return { status: "done", result: finished, turns: turn };
    if (terminalErrors > TERMINAL_RETRIES) return fallback(`invalid ${terminal.name} after ${TERMINAL_RETRIES} retries`, turn);
    contents.push({ role: "user", parts }); // all responses in ONE user turn, in call order
  }
  return fallback(`no ${terminal.name} within ${MAX_TURNS} turns`, MAX_TURNS);
}
