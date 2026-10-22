// Agent pipeline runs and their step trace (implementationplan.md §9.5): agent_runs + append-only agent_steps.
import type postgres from "postgres";
import { ServiceError, notFound } from "@/lib/api/errors";
import { getSql } from "@/lib/db/client";
import { type SqlHandle, writeAudit } from "./audit";

export type AgentName = "demand" | "supplier" | "order";
export type StepKind = "tool_call" | "decision" | "rejected_decision" | "message" | "fallback";
export type RunStatus = "running" | "succeeded" | "failed" | "fallback";

export type AgentStep = {
  id: string;
  agent: AgentName;
  seq: number;
  kind: StepKind;
  toolName: string | null;
  input: unknown;
  output: unknown;
  ok: boolean;
  ms: number | null;
  createdAt: string;
};

export type AgentRun = {
  id: string;
  planId: string;
  status: RunStatus;
  maxSkus: number;
  skus: { lineId: string; sku: string; rank: number }[];
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
};

const RUN_COLUMNS = (sql: SqlHandle) => sql`
  id, plan_id as "planId", status, max_skus as "maxSkus", skus,
  to_char(started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "startedAt",
  to_char(finished_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "finishedAt",
  summary, error
`;

/** Starts a run for an open plan; one running run per plan (409 RUN_IN_PROGRESS). Audited agent.run_started. */
export async function createRun(planId: string, maxSkus: number, sql: postgres.Sql = getSql()): Promise<string> {
  const [plan] = await sql<{ status: string }[]>`select status from purchase_plans where id = ${planId}`;
  if (!plan) throw notFound("Plan", planId);
  if (plan.status === "approved" || plan.status === "rejected") throw new ServiceError("PLAN_LOCKED", 409, `The plan is ${plan.status}; the agents cannot change it.`);
  try {
    return await sql.begin(async (tx) => {
      const [run] = await tx<{ id: string }[]>`insert into agent_runs (plan_id, max_skus) values (${planId}, ${maxSkus}) returning id`;
      await writeAudit({ actorType: "agent", actorId: "pipeline", action: "agent.run_started", entityType: "agent_run", entityId: run.id, after: { planId, maxSkus } }, tx);
      return run.id;
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new ServiceError("RUN_IN_PROGRESS", 409, "The agents are already running on this plan.");
    throw err;
  }
}

export async function getRun(runId: string, sql: SqlHandle = getSql()): Promise<AgentRun & { steps: AgentStep[] }> {
  const [[run], steps] = await Promise.all([
    sql<AgentRun[]>`select ${RUN_COLUMNS(sql)} from agent_runs where id = ${runId}`.execute(),
    sql<AgentStep[]>`
      select id::text, agent, seq, kind, tool_name as "toolName", input, output, ok, ms,
        to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt"
      from agent_steps where run_id = ${runId} order by seq
    `.execute(),
  ]);
  if (!run) throw new ServiceError("RUN_NOT_FOUND", 404, `Agent run ${runId} was not found.`);
  return { ...run, steps };
}

export async function listRuns(planId: string, sql: SqlHandle = getSql()): Promise<AgentRun[]> {
  return sql<AgentRun[]>`select ${RUN_COLUMNS(sql)} from agent_runs where plan_id = ${planId} order by started_at desc limit 20`;
}

/** The top N lines by rank that the agents may work on: proposed (not edited, deferred, rejected or on a PO), in the basket. */
export async function selectRunLines(planId: string, maxSkus: number, sql: SqlHandle = getSql()) {
  return sql<{ lineId: string; sku: string; rank: number; productId: string }[]>`
    select r.id as "lineId", p.sku, r.rank, r.product_id as "productId"
    from purchase_recommendations r join products p on p.id = r.product_id
    where r.plan_id = ${planId} and r.status = 'proposed' and r.in_basket
    order by r.rank limit ${maxSkus}
  `;
}

export async function setRunSkus(runId: string, skus: AgentRun["skus"], sql: SqlHandle = getSql()) {
  await sql`update agent_runs set skus = ${sql.json(skus)} where id = ${runId}`;
}

export async function finishRun(runId: string, status: Exclude<RunStatus, "running">, summary: string, error: string | null = null, sql: postgres.Sql = getSql()) {
  await sql.begin(async (tx) => {
    await Promise.all([
      tx`update agent_runs set status = ${status}, summary = ${summary}, error = ${error}, finished_at = now() where id = ${runId}`.execute(),
      writeAudit({ actorType: "agent", actorId: "pipeline", action: "agent.run_finished", entityType: "agent_run", entityId: runId, after: { status, summary, error } }, tx),
    ]);
  });
}

export type StepInput = { agent: AgentName; kind: StepKind; toolName?: string | null; input?: unknown; output?: unknown; ok?: boolean; ms?: number | null };
/** Where agent steps go: the database in a run (StepLog), memory in unit tests. */
export type StepSink = { add(step: StepInput): Promise<void> };

/** Append-only step log for one run; seq increases across all three agents. */
export class StepLog implements StepSink {
  private seq = 0;
  constructor(
    readonly runId: string,
    private readonly sql: SqlHandle = getSql(),
  ) {}
  async add(step: StepInput) {
    const seq = ++this.seq;
    await this.sql`
      insert into agent_steps (run_id, agent, seq, kind, tool_name, input, output, ok, ms)
      values (${this.runId}, ${step.agent}, ${seq}, ${step.kind}, ${step.toolName ?? null},
        ${step.input === undefined ? null : this.sql.json(step.input as postgres.JSONValue)},
        ${step.output === undefined ? null : this.sql.json(step.output as postgres.JSONValue)},
        ${step.ok ?? true}, ${step.ms ?? null})
    `;
  }
}
