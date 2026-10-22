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
      <Suspense fallback={<ActivitySkeleton />}>
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

/** Shaped like the log: the filter row, the header and ten rows. */
function ActivitySkeleton() {
  return (
    <section className="surface overflow-hidden" aria-hidden>
      <div className="flex gap-2 px-5 pt-5 pb-4">
        <span className="shimmer h-8 w-36 rounded-full" />
        <span className="shimmer h-8 w-32 rounded-full" />
      </div>
      <div className="h-9 border-y border-white/[0.06] bg-white/[0.025]" />
      {Array.from({ length: 10 }, (_, i) => (
        <div key={i} className="flex h-12 items-center gap-6 border-b border-border px-5 last:border-b-0">
          <span className="shimmer h-4 w-28 rounded" />
          <span className="shimmer h-4 w-36 rounded" />
          <span className="shimmer h-4 w-32 rounded" />
          <span className="shimmer h-4 flex-1 rounded" />
        </div>
      ))}
    </section>
  );
}
