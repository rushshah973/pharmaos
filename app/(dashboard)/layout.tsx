import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";

// Dashboard shell (implementationplan.md §10.2): sidebar, sticky top bar, centred content.
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen">
      <Sidebar demoUser={process.env.DEMO_USER ?? "demo.owner"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-8 py-8 max-lg:px-6 max-lg:py-6">{children}</main>
      </div>
    </div>
  );
}
