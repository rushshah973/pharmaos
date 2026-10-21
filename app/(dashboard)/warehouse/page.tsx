import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { ErrorState } from "@/components/layout/ErrorState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { WarehouseView } from "@/components/warehouse3d/WarehouseView";
import { getHeatmaps, getLatestOpenPlan, getLayout } from "@/lib/services/warehouse";

export const metadata: Metadata = { title: "3D Warehouse" };

export default function WarehousePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Warehouse"
        description="Every bin in WH-01, coloured by the same engine statuses as the purchase plan. Pick a mode, find a SKU, click a bin for its stock."
      />
      <Suspense fallback={<WarehouseSkeleton />}>
        <WarehouseData />
      </Suspense>
    </div>
  );
}

async function WarehouseData() {
  await connection();
  let data;
  try {
    const [layout, heatmaps, plan] = await Promise.all([getLayout(), getHeatmaps(["stockout", "expiry", "excess", "normal"]), getLatestOpenPlan()]);
    data = { layout, heatmaps, plan };
  } catch (err) {
    console.error("[warehouse]", err);
    return <ErrorState title="The warehouse could not load" description="The database did not answer in time. Check the connection, then retry." />;
  }
  // WarehouseView reads the URL (?mode, ?sku, ?bin), so it renders inside this Suspense boundary.
  return <WarehouseView layout={data.layout} initial={data.heatmaps} planId={data.plan?.id ?? null} />;
}

function WarehouseSkeleton() {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading the warehouse">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {[112, 96, 104, 72, 172].map((w) => (
            <Skeleton key={w} className="h-8 rounded-full" style={{ width: w }} />
          ))}
        </div>
        <Skeleton className="h-8 w-[380px]" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="surface space-y-5 p-5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-4 w-full max-w-[560px]" />
          {[0, 1, 2, 3, 4].map((a) => (
            <div key={a} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <div className="grid grid-cols-12 gap-1">
                {Array.from({ length: 48 }, (_, i) => (
                  <Skeleton key={i} className="h-7 rounded-[5px]" />
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="surface h-[280px] p-5">
          <Skeleton className="mx-auto mt-8 size-10 rounded-full" />
          <Skeleton className="mx-auto mt-4 h-4 w-28" />
          <Skeleton className="mx-auto mt-2 h-4 w-52" />
        </div>
      </div>
    </div>
  );
}
