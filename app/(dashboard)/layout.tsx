import { Suspense } from "react";
import { DataSourceBadge } from "@/components/layout/DataSourceBadge";
import { Breadcrumb } from "@/components/layout/TopBarTitle";
import { TopBar } from "@/components/layout/TopBar";

// Dashboard shell: a floating glass top bar over the ambient canvas, content centred below. Every screen carries
// the "Synthetic demo data" badge (R8) on the first row, next to the back link of detail pages.
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar demoUser={process.env.DEMO_USER ?? "demo.owner"} />
      <main className="mx-auto w-full max-w-[1520px] flex-1 px-8 pt-2 pb-12 max-lg:px-5">
        <div className="mb-3 flex min-h-6 items-center justify-between gap-3 print:hidden">
          <Suspense fallback={<span />}>
            <Breadcrumb />
          </Suspense>
          <DataSourceBadge className="ml-auto" />
        </div>
        {children}
      </main>
    </div>
  );
}
