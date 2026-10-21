// Temporary plain shell. Replaced by the real sidebar + top bar in stage 3 (P12).
export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b px-6 py-4">
        <span className="text-lg font-semibold">PharmaOS</span>
      </header>
      <main className="flex-1 px-6 py-6">{children}</main>
    </div>
  );
}
