import { Suspense } from "react";
import { Breadcrumb } from "@/components/layout/TopBarTitle";
import { TopBar } from "@/components/layout/TopBar";

// Dashboard shell: a floating glass top bar over the ambient canvas, content centred below.
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col">
      <TopBar demoUser={process.env.DEMO_USER ?? "demo.owner"} />
      <main className="mx-auto w-full max-w-[1520px] flex-1 px-8 pt-4 pb-12 max-lg:px-5">
        <Suspense fallback={null}>
          <Breadcrumb />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
