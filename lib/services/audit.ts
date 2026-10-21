import type postgres from "postgres";
import { getSql } from "@/lib/db/client";

// The ONLY module that inserts into audit_logs (architecture.md §3.2).
// The table is append-only: a DB trigger rejects update and delete.

export type ActorType = "user" | "system" | "agent" | "tool";

/** The shared pool, or the handle inside `sql.begin(tx => …)`, so audit rows commit with the change. */
export type SqlHandle = postgres.Sql | postgres.TransactionSql;

export type AuditEntry = {
  actorType: ActorType;
  actorId: string;
  action: string; // catalogue in implementationplan.md §13, e.g. "plan.created"
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
};

export type AuditRow = {
  id: string; // bigserial arrives as a string
  created_at: Date;
  actor_type: ActorType;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_json: unknown;
  after_json: unknown;
  reason: string | null;
};

function toJson(sql: SqlHandle, value: unknown) {
  return value === undefined || value === null ? null : sql.json(value as postgres.JSONValue);
}

export async function writeAudit(entry: AuditEntry, sql: SqlHandle = getSql()): Promise<void> {
  await sql`
    insert into audit_logs (actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, reason)
    values (
      ${entry.actorType},
      ${entry.actorId},
      ${entry.action},
      ${entry.entityType},
      ${entry.entityId ?? null},
      ${toJson(sql, entry.before)},
      ${toJson(sql, entry.after)},
      ${entry.reason ?? null}
    )
  `;
}

/**
 * Newest first. `before` = an audit id; returns rows older than it (for "Load more").
 * `action` filters by exact action or a prefix ending in "." (e.g. "po."); `entity` by entity_type.
 */
export async function listAudit(
  { limit = 50, before, action, entity }: { limit?: number; before?: string; action?: string; entity?: string } = {},
  sql: SqlHandle = getSql(),
): Promise<AuditRow[]> {
  const size = Math.min(Math.max(Math.trunc(limit), 1), 200);
  const conds = [
    before ? sql`id < ${before}` : sql`true`,
    action ? (action.endsWith(".") ? sql`action like ${action + "%"}` : sql`action = ${action}`) : sql`true`,
    entity ? sql`entity_type = ${entity}` : sql`true`,
  ];
  return sql<AuditRow[]>`
    select id::text, created_at, actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, reason
    from audit_logs
    where ${conds[0]} and ${conds[1]} and ${conds[2]}
    order by audit_logs.id desc -- the numeric column, not the text alias
    limit ${size}
  `;
}
