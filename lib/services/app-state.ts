import type postgres from "postgres";
import { getSql } from "@/lib/db/client";
import { resolveAsOfDate } from "./as-of";

export type ShellState = {
  scenarioId: string;
  scenarioName: string;
  defaultBudget: string;
  asOf: string;
};

/** What the top bar shows: active scenario, default budget and the engine's as-of date. */
export async function getShellState(sql: postgres.Sql = getSql()): Promise<ShellState> {
  const [[row], asOf] = await Promise.all([
    sql<{ scenario_id: string; scenario_name: string; default_budget: string }[]>`
      select a.active_scenario_id as scenario_id, s.name as scenario_name, a.default_budget::text as default_budget
      from app_state a join scenarios s on s.id = a.active_scenario_id
      where a.id = 1
    `,
    resolveAsOfDate(sql),
  ]);
  return {
    scenarioId: row?.scenario_id ?? "baseline",
    scenarioName: row?.scenario_name ?? "Baseline",
    defaultBudget: row?.default_budget ?? "200000.00",
    asOf,
  };
}
