"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format/date";
import { type AuditView, changeSummary } from "@/lib/format/audit";

const ACTIONS = [
  { id: "", label: "All actions" },
  { id: "plan.", label: "Plans" },
  { id: "line.", label: "Line edits" },
  { id: "po.", label: "Purchase orders" },
  { id: "agent.", label: "Agents" },
  { id: "model.", label: "Demand model" },
  { id: "seed.", label: "Seed" },
];
const ENTITIES = [
  { id: "", label: "All entities" },
  { id: "plan", label: "Plan" },
  { id: "recommendation", label: "Plan line" },
  { id: "purchase_order", label: "Purchase order" },
  { id: "forecast_model", label: "Demand model" },
];
const ACTOR_TONE: Record<string, string> = {
  user: "bg-brand-glow text-brand",
  agent: "bg-excess-bg text-excess",
  system: "bg-neutral-bg text-neutral",
  tool: "bg-neutral-bg text-neutral",
};

type Row = AuditView & { entityLabel?: string };

function entityLink(r: Row): string | null {
  if (!r.entityId) return null;
  if (r.entityType === "plan") return `/procurement/${r.entityId}`;
  if (r.entityType === "purchase_order") return `/purchase-orders/${r.entityId}`;
  return null;
}

/** Activity & audit (§10.3): newest first, filter by action group and entity, Load more. Read-only. */
export function AuditTable({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [loading, setLoading] = useState(false);
  const [end, setEnd] = useState(initial.length < 50);

  async function load(next: { action: string; entity: string }, before?: string) {
    setLoading(true);
    try {
      const q = new URLSearchParams({ limit: "50" });
      if (next.action) q.set("action", next.action);
      if (next.entity) q.set("entity", next.entity);
      if (before) q.set("before", before);
      const res = await fetch(`/api/audit?${q}`);
      const { rows: got } = (await res.json()) as { rows: Record<string, unknown>[] };
      const mapped = got.map(toView);
      setRows((r) => (before ? [...r, ...mapped] : mapped));
      setEnd(mapped.length < 50);
    } finally {
      setLoading(false);
    }
  }

  const change = (next: { action: string; entity: string }) => {
    setAction(next.action);
    setEntity(next.entity);
    void load(next);
  };

  return (
    <section className="surface overflow-hidden" aria-label="Activity log">
      <header className="flex flex-wrap items-center gap-2 px-5 pt-5 pb-4">
        <Select value={action} options={ACTIONS} onChange={(v) => change({ action: v, entity })} label="Action" />
        <Select value={entity} options={ENTITIES} onChange={(v) => change({ action, entity: v })} label="Entity" />
        {loading && <Loader2 className="size-4 animate-spin text-fg-3" aria-label="Loading" />}
        <span className="ml-auto text-[12px] text-fg-3">Append-only: rows can never be edited or deleted</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-[12.5px]">
          <thead>
            <tr className="border-y border-border bg-surface-2">
              {["Time", "Actor", "Action", "Entity", "Change", "Reason"].map((h) => (
                <th key={h} className="micro-label h-9 px-4 text-left font-medium first:pl-5 last:pr-5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-fg-2">
                  No activity matches these filters.
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const href = entityLink(r);
              const summary = changeSummary(r.before, r.after);
              return (
                <tr key={r.id} className="border-b border-border align-top transition-colors duration-150 last:border-b-0 hover:bg-surface-3">
                  <td className="py-2.5 pr-4 pl-5 whitespace-nowrap text-fg-2">{formatDateTime(r.createdAt)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase", ACTOR_TONE[r.actorType] ?? ACTOR_TONE.system)}>{r.actorType}</span>
                    <span className="ml-2 font-mono text-fg-1">{r.actorId}</span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <span className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[11.5px] text-fg-1">{r.action}</span>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-fg-2">
                    {r.entityType.replaceAll("_", " ")}
                    {r.entityId &&
                      (href ? (
                        <Link href={href} className="ml-1.5 font-mono text-brand hover:underline">
                          {r.entityId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="ml-1.5 font-mono text-fg-3">{r.entityId.slice(0, 8)}</span>
                      ))}
                  </td>
                  <td className="px-4 py-2.5 text-fg-1">{summary.length ? summary.join(" · ") : <span className="text-fg-3">—</span>}</td>
                  <td className="max-w-[260px] px-4 py-2.5 pr-5 text-fg-2">{r.reason ?? <span className="text-fg-3">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <footer className="flex items-center justify-between border-t border-border px-5 py-3">
        <span className="text-[12px] text-fg-3">{rows.length} rows shown</span>
        <Button variant="outline" className="h-8 border-border-strong bg-surface-2 px-3" disabled={end || loading} onClick={() => load({ action, entity }, rows[rows.length - 1]?.id)}>
          {end ? "No more activity" : "Load more"}
        </Button>
      </footer>
    </section>
  );
}

function Select({ value, options, onChange, label }: { value: string; options: { id: string; label: string }[]; onChange: (v: string) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-border-strong bg-surface-2 px-2 text-[12.5px] text-fg-1"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function toView(r: Record<string, unknown>): Row {
  return {
    id: String(r.id),
    createdAt: new Date(r.created_at as string).toISOString(),
    actorType: String(r.actor_type),
    actorId: String(r.actor_id),
    action: String(r.action),
    entityType: String(r.entity_type),
    entityId: (r.entity_id as string | null) ?? null,
    before: r.before_json,
    after: r.after_json,
    reason: (r.reason as string | null) ?? null,
  };
}
