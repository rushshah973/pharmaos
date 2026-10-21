import type postgres from "postgres";
import { getSql } from "@/lib/db/client";
import { resolveAsOfDate } from "./as-of";

export type ShellState = {
  scenarioId: string;
  scenarioName: string;
  /** A purchase order above this needs Owner approval before it can be sent. */
  approvalLimit: string;
  asOf: string;
};

/** What the top bar shows: active scenario, PO approval limit and the engine's as-of date. */
export async function getShellState(sql: postgres.Sql = getSql()): Promise<ShellState> {
  const [[row], asOf] = await Promise.all([
    sql<{ scenario_id: string; scenario_name: string; approval_limit: string }[]>`
      select a.active_scenario_id as scenario_id, s.name as scenario_name, a.po_approval_limit::text as approval_limit
      from app_state a join scenarios s on s.id = a.active_scenario_id
      where a.id = 1
    `,
    resolveAsOfDate(sql),
  ]);
  return {
    scenarioId: row?.scenario_id ?? "baseline",
    scenarioName: row?.scenario_name ?? "Baseline",
    approvalLimit: row?.approval_limit ?? "400000.00",
    asOf,
  };
}
