import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { AuditTable } from "@/components/audit/AuditTable";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import type { AuditView } from "@/lib/format/audit";
import { listAudit } from "@/lib/services/audit";

export const metadata: Metadata = { title: "Activity Log" };

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Activity log" description="Every plan, edit, approval, Owner decision, simulated send and model run — who did it, what changed and why." />
      <Suspense fallback={<div className="surface shimmer h-[560px]" aria-hidden />}>
        <Activity />
      </Suspense>
    </div>
  );
}

async function Activity() {
  await connection();
  let rows: AuditView[];
  try {
    rows = (await listAudit({ limit: 50 })).map((r) => ({
      id: String(r.id),
      createdAt: new Date(r.created_at).toISOString(),
      actorType: r.actor_type,
      actorId: r.actor_id,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      before: r.before_json,
      after: r.after_json,
      reason: r.reason,
    }));
  } catch (err) {
    console.error("[activity]", err);
    return <ErrorState title="The activity log could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  return <AuditTable initial={rows} />;
}
