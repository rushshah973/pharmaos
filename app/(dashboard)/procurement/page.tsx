import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/components/layout/EmptyState";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreatePlanDialog } from "@/components/procurement/CreatePlanDialog";
import { PlansTable, PlansTableSkeleton } from "@/components/procurement/PlansTable";
import { type PlanListItem, listPlans } from "@/lib/services/plans";

export const metadata: Metadata = { title: "Procurement" };

export default function ProcurementPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Procurement"
        description="Explainable purchase plans, ranked by loss prevented per rupee. Open one to review, edit and approve its lines."
        action={<CreatePlanDialog />}
      />
      <Suspense fallback={<PlansTableSkeleton />}>
        <Plans />
      </Suspense>
    </div>
  );
}

async function Plans() {
  await connection();
  let plans: PlanListItem[];
  try {
    plans = await listPlans();
  } catch (err) {
    console.error("[procurement]", err);
    return <ErrorState title="Plans could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  if (plans.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No plans yet"
        description="Create a purchase plan to see every SKU that needs stock, ranked and explained, with its supplier purchase orders."
        action={<CreatePlanDialog variant="outline" />}
      />
    );
  }
  return <PlansTable plans={plans} />;
}
