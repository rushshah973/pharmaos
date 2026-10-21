import { Suspense } from "react";
import { connection } from "next/server";
import { CalendarDays, FlaskConical, ShieldCheck } from "lucide-react";
import { formatDisplayDate } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import { getShellState } from "@/lib/services/app-state";
import { TopBarTitle } from "./TopBarTitle";

/** Sticky, blurred top bar (§10.1 Layout). The right-hand facts are read server-side. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-14 print:hidden shrink-0 items-center justify-between gap-4 border-b border-border bg-bg/80 px-8 backdrop-blur-md max-lg:px-6">
      <Suspense fallback={<span className="h-5 w-40" aria-hidden />}>
        <TopBarTitle />
      </Suspense>
      <Suspense fallback={<TopBarFactsSkeleton />}>
        <TopBarFacts />
      </Suspense>
    </header>
  );
}

async function TopBarFacts() {
  await connection();
  const state = await getShellState();
  return (
    <div className="flex shrink-0 items-center gap-2">
      {state.scenarioId !== "baseline" && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-expiry/30 bg-expiry-bg px-2.5 text-[12px] font-medium text-expiry">
          <FlaskConical className="size-3.5" strokeWidth={1.75} aria-hidden />
          Scenario: {state.scenarioName}
        </span>
      )}
      <Fact icon={<CalendarDays className="size-3.5" strokeWidth={1.75} />} label="As of">
        {formatDisplayDate(state.asOf)}
      </Fact>
      <Fact icon={<ShieldCheck className="size-3.5" strokeWidth={1.75} />} label="Approval above">
        {formatINR(state.approvalLimit, { paise: false })}
      </Fact>
    </div>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5">
      <span className="text-fg-3" aria-hidden>
        {icon}
      </span>
      <span className="text-[11px] font-medium tracking-[0.06em] text-fg-3 uppercase">{label}</span>
      <span className="num text-[12.5px] font-medium text-fg-1">{children}</span>
    </span>
  );
}

function TopBarFactsSkeleton() {
  return (
    <div className="flex shrink-0 items-center gap-2" aria-hidden>
      <span className="shimmer h-7 w-[150px] rounded-md" />
      <span className="shimmer h-7 w-[200px] rounded-md" />
    </div>
  );
}
