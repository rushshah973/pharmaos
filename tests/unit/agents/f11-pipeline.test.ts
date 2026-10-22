// F11 — agent guardrails and the shared loop (implementationplan.md §9.5, §14.1), with a scripted fake Gemini client
// and an in-memory step log: no network, no database (the services the guardrails call are mocked).
import { ApiError, type Content } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/services/plans", () => ({ applyDemandDecision: vi.fn(), editLine: vi.fn(), getPlan: vi.fn() }));
vi.mock("@/lib/services/agent-data", () => ({ analyseLine: vi.fn(), analyseSkuCode: vi.fn(), salesHistory: vi.fn() }));

import type { StepInput } from "@/lib/services/agent-runs";
import { applyDemandDecision, editLine } from "@/lib/services/plans";
import { analyseLine } from "@/lib/services/agent-data";
import type { RunContext } from "@/lib/agents/pipeline/context";
import { applyDemandDecisions } from "@/lib/agents/pipeline/demand-agent";
import { type ModelClient, type ModelResponse, runAgentLoop } from "@/lib/agents/pipeline/loop";
import { applySupplierDecisions } from "@/lib/agents/pipeline/supplier-agent";
import { BACKUP_GEMINI_MODEL } from "@/lib/agents/retry";

type Call = { id: string; name: string; args: Record<string, unknown> };
const response = (calls: Call[], finishReason = "STOP"): ModelResponse => ({
  candidates: [{ content: { role: "model", parts: calls.map((c) => ({ functionCall: c, thoughtSignature: `sig-${c.id}` })) }, finishReason }],
  functionCalls: calls,
});

function fake(script: (ModelResponse | Error)[]) {
  const seen: Content[][] = [];
  const models: string[] = [];
  let i = 0;
  const client: ModelClient = {
    generateContent: async (req) => {
      seen.push(structuredClone(req.contents));
      models.push(req.model);
      const next = script[i++];
      if (!next) throw new Error("script exhausted");
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { client, seen, models };
}

function memoryLog() {
  const steps: StepInput[] = [];
  return { steps, sink: { add: async (s: StepInput) => void steps.push(s) } };
}

const terminal = {
  name: "submit_test",
  description: "finish",
  declared: z.object({ value: z.string() }),
  schema: z.object({ value: z.string() }),
  apply: async ({ value }: { value: string }) => ({ value }),
};
const echo = { name: "echo", description: "echo", schema: z.object({ x: z.number() }), handler: async ({ x }: { x: number }) => ({ x }) };

function loop(script: (ModelResponse | Error)[]) {
  const { client, seen, models } = fake(script);
  const { steps, sink } = memoryLog();
  const run = runAgentLoop({ agent: "demand", client, model: "primary-model", systemPrompt: "s", userMessage: "u", tools: [echo], terminal, log: sink, retryDelaysMs: [0, 0] });
  return { run, steps, seen, models };
}

describe("F11 shared agent loop", () => {
  it("an unknown tool → INVALID_TOOL_INPUT, and the agent can still finish", async () => {
    const { run, steps } = loop([response([{ id: "a", name: "send_po", args: { poId: "x" } }]), response([{ id: "b", name: "submit_test", args: { value: "ok" } }])]);
    const out = await run;
    expect(out.status).toBe("done");
    const bad = steps.find((s) => s.toolName === "send_po")!;
    expect(bad.ok).toBe(false);
    expect((bad.output as { error: { code: string } }).error.code).toBe("INVALID_TOOL_INPUT");
  });

  it("appends the model turn unchanged and sends every functionResponse in ONE user turn, in call order, with matching ids", async () => {
    const { run, seen } = loop([
      response([
        { id: "c1", name: "echo", args: { x: 1 } },
        { id: "c2", name: "echo", args: { x: 2 } },
      ]),
      response([{ id: "t", name: "submit_test", args: { value: "ok" } }]),
    ]);
    await run;
    const second = seen[1];
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe("model");
    expect(second[1].parts?.map((p) => p.thoughtSignature)).toEqual(["sig-c1", "sig-c2"]);
    expect(second[2].role).toBe("user");
    expect(second[2].parts?.map((p) => [p.functionResponse?.id, p.functionResponse?.name])).toEqual([
      ["c1", "echo"],
      ["c2", "echo"],
    ]);
  });

  it("Zod-validates tool args: bad args → INVALID_TOOL_INPUT, the handler does not run", async () => {
    const { run, steps } = loop([response([{ id: "a", name: "echo", args: { x: "seven" } }]), response([{ id: "b", name: "submit_test", args: { value: "ok" } }])]);
    await run;
    expect((steps[0].output as { error: { code: string } }).error.code).toBe("INVALID_TOOL_INPUT");
  });

  it("retries an invalid terminal call twice, then falls back", async () => {
    const bad = (id: string) => response([{ id, name: "submit_test", args: { value: 42 } }]);
    const twice = loop([bad("1"), bad("2"), response([{ id: "3", name: "submit_test", args: { value: "ok" } }])]);
    expect((await twice.run).status).toBe("done");
    const thrice = loop([bad("1"), bad("2"), bad("3")]);
    const out = await thrice.run;
    expect(out.status).toBe("fallback");
    expect(thrice.steps.at(-1)?.kind).toBe("fallback");
  });

  it("falls back on a non-STOP finish, and on an API error that persists after 2 retries", async () => {
    expect((await loop([response([{ id: "a", name: "echo", args: { x: 1 } }], "MAX_TOKENS")]).run).status).toBe("fallback");
    const busy = () => new ApiError({ message: "busy", status: 503 });
    const api = await loop([busy(), busy(), busy()]).run;
    expect(api).toMatchObject({ status: "fallback", reason: "Gemini API error 503" });
  });

  it("retries a transient Gemini error (504 deadline expired) and the agent still finishes", async () => {
    const { run, seen } = loop([new ApiError({ message: "deadline", status: 504 }), response([{ id: "t", name: "submit_test", args: { value: "ok" } }])]);
    expect((await run).status).toBe("done");
    expect(seen).toHaveLength(2);
  });

  it("retries an overloaded model (503) or a client timeout on the backup model, and stays on it", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const { run, models } = loop([new ApiError({ message: "high demand", status: 503 }), response([{ id: "a", name: "echo", args: { x: 1 } }]), timeout, response([{ id: "t", name: "submit_test", args: { value: "ok" } }])]);
    expect((await run).status).toBe("done");
    expect(models).toEqual(["primary-model", BACKUP_GEMINI_MODEL, BACKUP_GEMINI_MODEL, BACKUP_GEMINI_MODEL]);
  });

  it("does not retry a non-transient error (e.g. 400 bad request)", async () => {
    const { run, seen } = loop([new ApiError({ message: "bad", status: 400 }), response([{ id: "t", name: "submit_test", args: { value: "ok" } }])]);
    expect(await run).toMatchObject({ status: "fallback", reason: "Gemini API error 400" });
    expect(seen).toHaveLength(1);
  });
});

function ctx(): { c: RunContext; steps: StepInput[] } {
  const { steps, sink } = memoryLog();
  const c: RunContext = {
    runId: "11111111-1111-4111-8111-111111111111",
    planId: "22222222-2222-4222-8222-222222222222",
    asOf: "2026-10-21",
    lines: [{ lineId: "33333333-3333-4333-8333-333333333333", sku: "PHX-0001", rank: 1, productId: "p1" }],
    client: { generateContent: async () => ({}) },
    model: "fake",
    log: sink,
  };
  return { c, steps };
}

describe("F11 Demand Agent guardrail", () => {
  beforeEach(() => vi.mocked(applyDemandDecision).mockReset());

  it("a number instead of a method → rejected step, the line is not touched", async () => {
    const { c, steps } = ctx();
    const out = await applyDemandDecisions(c, [{ sku: "PHX-0001", method: 12.5, reason: "Demand is about 12.5 packs a day" }]);
    expect(out).toMatchObject({ accepted: 0, rejected: 1 });
    expect(applyDemandDecision).not.toHaveBeenCalled();
    expect(steps[0]).toMatchObject({ kind: "rejected_decision", ok: false });
  });

  it("an extra number next to a valid method is rejected too (the agent never sends numbers)", async () => {
    const { c } = ctx();
    const out = await applyDemandDecisions(c, [{ sku: "PHX-0001", method: "ml", reason: "ML error is lower", avgDailyDemand: 9 }]);
    expect(out.rejected).toBe(1);
    expect(applyDemandDecision).not.toHaveBeenCalled();
  });

  it("a SKU outside the run → rejected", async () => {
    const { c, steps } = ctx();
    await applyDemandDecisions(c, [{ sku: "PHX-9999", method: "ml", reason: "ML error is lower here" }]);
    expect((steps[0].output as { code: string }).code).toBe("SKU_NOT_IN_RUN");
    expect(applyDemandDecision).not.toHaveBeenCalled();
  });

  it("a valid decision is applied with the method only", async () => {
    vi.mocked(applyDemandDecision).mockResolvedValue({
      changed: true,
      before: { method: "baseline", avgDailyDemand: 5, qty: 50, offerId: "o", supplierCode: "SUP-01", lineTotal: "10.00", inBasket: true },
      after: { method: "ml", avgDailyDemand: 6, qty: 60, offerId: "o", supplierCode: "SUP-01", lineTotal: "12.00", inBasket: true },
    });
    const { c } = ctx();
    const out = await applyDemandDecisions(c, [{ sku: "PHX-0001", method: "ml", reason: "ML error 18% vs average 27%" }]);
    expect(applyDemandDecision).toHaveBeenCalledWith(c.planId, c.lines[0].lineId, { method: "ml", reason: "ML error 18% vs average 27%" });
    expect(out.changed).toEqual([{ sku: "PHX-0001", from: "baseline", to: "ml", qtyBefore: 50, qtyAfter: 60 }]);
  });
});

describe("F11 Supplier Agent guardrail", () => {
  beforeEach(() => {
    vi.mocked(editLine).mockReset();
    vi.mocked(analyseLine).mockReset();
  });
  const offer = "44444444-4444-4444-8444-444444444444";
  const analysed = (exclusions: string[]) =>
    ({
      line: { productId: "p1", status: "proposed", offerId: "55555555-5555-4555-8555-555555555555", qty: 10, d: null },
      analysis: { offers: [{ offerId: offer, supplierCode: "SUP-04", exclusions }] },
    }) as unknown as Awaited<ReturnType<typeof analyseLine>>;

  it("an excluded offer → rejected, the line keeps its offer (editLine never runs)", async () => {
    vi.mocked(analyseLine).mockResolvedValue(analysed(["TOO_SLOW_FOR_COVER"]));
    const { c, steps } = ctx();
    const out = await applySupplierDecisions(c, [{ sku: "PHX-0001", offerId: offer, reason: "Cheaper by 10 percent" }]);
    expect(out).toMatchObject({ accepted: 0, rejected: 1 });
    expect(editLine).not.toHaveBeenCalled();
    expect(steps[0].output).toMatchObject({ code: "OFFER_EXCLUDED", exclusions: ["TOO_SLOW_FOR_COVER"] });
  });

  it("an eligible offer goes through editLine with the agent as actor, its reason and evidence", async () => {
    vi.mocked(analyseLine).mockResolvedValue(analysed([]));
    vi.mocked(editLine).mockResolvedValue({ preview: false, before: { supplierCode: "SUP-02", qty: 10, totals: { lineTotal: "5.00" } }, after: { supplierCode: "SUP-04", qty: 10, totals: { lineTotal: "4.00" } } } as never);
    const { c } = ctx();
    const out = await applySupplierDecisions(c, [{ sku: "PHX-0001", offerId: offer, reason: "Cheaper and still before stockout" }]);
    expect(out.switched).toHaveLength(1);
    expect(editLine).toHaveBeenCalledWith(c.planId, c.lines[0].lineId, { kind: "offer", offerId: offer }, expect.objectContaining({ actor: { type: "agent", id: "supplier-agent" }, reason: "Cheaper and still before stockout" }));
  });
});
