// Phase D2: write the validated dataset to Postgres in one transaction, plus CSV
// snapshots for inspection (implementationplan.md §5.8).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type postgres from "postgres";
import { writeAudit } from "@/lib/services/audit";
import type { SyntheticDataset } from "./generate-synthetic";

export type SourceEntry = {
  id: string;
  name: string;
  url?: string;
  source_type: string;
  used_for: string;
  licence_note?: string;
  retrieved_at?: string;
};

/** Data tables cleared before every seed (scenarios kept; app_state reset). Child tables first. */
const DATA_TABLES = [
  "purchase_order_lines",
  "approvals",
  "purchase_orders",
  "purchase_recommendations",
  "purchase_plans",
  "warehouse_movements",
  "inventory_balances",
  "batches",
  "inventory_locations",
  "sales_history",
  "supplier_offers",
  "suppliers",
  "products",
  "data_sources",
  "audit_logs",
] as const;

const BATCH_SIZE = 1000;

async function insertRows(tx: postgres.TransactionSql, table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE) as Record<string, postgres.ParameterOrJSON<never>>[];
    await tx`insert into ${tx(table)} ${tx(chunk)}`;
  }
}

export async function writeDataset(
  sql: postgres.Sql,
  data: SyntheticDataset,
  sources: SourceEntry[],
): Promise<Record<string, number>> {
  const dataSources = sources.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url ?? null,
    source_type: s.source_type,
    used_for: s.used_for,
    licence_note: s.licence_note ?? null,
    retrieved_at: s.retrieved_at ?? null,
    notes: null,
  }));

  // FK order (plan §5.8).
  const inserts: [string, object[]][] = [
    ["data_sources", dataSources],
    ["suppliers", data.suppliers],
    ["products", data.products],
    ["supplier_offers", data.supplierOffers],
    ["sales_history", data.salesHistory],
    ["inventory_locations", data.inventoryLocations],
    ["batches", data.batches],
    ["inventory_balances", data.inventoryBalances],
    ["purchase_orders", data.purchaseOrders],
    ["purchase_order_lines", data.purchaseOrderLines],
  ];

  await sql.begin(async (tx) => {
    await tx.unsafe(`truncate table ${DATA_TABLES.join(", ")} restart identity cascade`);
    await tx`
      update app_state set
        active_scenario_id = 'baseline',
        po_approval_limit = 400000,
        as_of_date = null,
        synthetic_seed = ${data.meta.seed},
        seeded_at = now(),
        updated_at = now()
      where id = 1
    `;
    for (const [table, rows] of inserts) await insertRows(tx, table, rows);
    await writeAudit(
      {
        actorType: "system",
        actorId: "seed",
        action: "seed.completed",
        entityType: "database",
        after: { asOf: data.meta.asOf, seed: data.meta.seed, rows: Object.fromEntries(inserts.map(([t, r]) => [t, r.length])) },
      },
      tx,
    );
  });

  const counts: Record<string, number> = {};
  for (const [table] of inserts) {
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from ${sql(table)}`;
    counts[table] = row.n;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// CSV snapshots (git-ignored) for inspection
// ---------------------------------------------------------------------------

function csvValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeSnapshots(dir: string, data: SyntheticDataset): void {
  mkdirSync(dir, { recursive: true });
  const tables: Record<string, object[]> = {
    products: data.products,
    suppliers: data.suppliers,
    supplier_offers: data.supplierOffers,
    sales_history: data.salesHistory,
    inventory_locations: data.inventoryLocations,
    batches: data.batches,
    inventory_balances: data.inventoryBalances,
    purchase_orders: data.purchaseOrders,
    purchase_order_lines: data.purchaseOrderLines,
  };
  for (const [name, rows] of Object.entries(tables)) {
    if (rows.length === 0) continue;
    const cols = Object.keys(rows[0]);
    const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => csvValue((r as Record<string, unknown>)[c])).join(","))];
    writeFileSync(path.join(dir, `${name}.csv`), lines.join("\n") + "\n");
  }
}
