import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { CalendarDays, FlaskConical, ShieldCheck } from "lucide-react";
import { formatDisplayDate } from "@/lib/format/date";
import { formatINR } from "@/lib/money";
import { getShellState } from "@/lib/services/app-state";
import { Logo } from "./Logo";
import { ActiveNavPills, NavPills } from "./NavPills";

/** Floating glass top bar: logo, section pills, and the planning facts (read server-side) with the demo user. */
export function TopBar({ demoUser }: { demoUser: string }) {
  const initials = demoUser
    .split(/[.\s_-]+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
  return (
    <header className="sticky top-0 z-30 print:hidden">
      <div className="mx-auto flex h-[76px] w-full max-w-[1520px] items-center gap-4 px-8 max-lg:px-5">
        <Link href="/" prefetch={false} aria-label="PharmaOS home page" className="shrink-0 rounded-full">
          <Logo wordmarkClassName="max-[1500px]:hidden" />
        </Link>
        <div className="flex min-w-0 flex-1 justify-center">
          {/* The active pill needs the URL, which is only known at request time: stream it in (Cache Components). */}
          <Suspense fallback={<NavPills pathname={null} />}>
            <ActiveNavPills />
          </Suspense>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Suspense fallback={<span className="shimmer h-9 w-[180px] rounded-full" aria-hidden />}>
            <TopBarFacts />
          </Suspense>
          <span
            className="glass-pill flex size-9 items-center justify-center text-[11.5px] font-medium text-fg-1"
            title={`${demoUser} · Owner · demo account`}
            aria-label={`Signed in as ${demoUser}, Owner, demo account`}
            role="img"
          >
            {initials || "D"}
          </span>
        </div>
      </div>
      {/* A soft fade under the bar instead of a hard border. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[96px] bg-gradient-to-b from-bg via-bg/80 to-transparent" aria-hidden />
    </header>
  );
}

async function TopBarFacts() {
  await connection();
  let state: Awaited<ReturnType<typeof getShellState>>;
  try {
    state = await getShellState();
  } catch (err) {
    // The page's own sections show the error; the bar just leaves the facts out.
    console.error("[top bar]", err);
    return null;
  }
  return (
    <div className="flex items-center gap-2">
      {state.scenarioId !== "baseline" && (
        <Link
          href="/data"
          prefetch={false}
          title={`Scenario running: ${state.scenarioName}. Open Data & Scenarios to reset it.`}
          className="inline-flex h-9 max-w-[150px] items-center gap-1.5 rounded-full border border-expiry/30 bg-expiry-bg px-3 text-[12px] font-medium text-expiry backdrop-blur-xl hover:bg-expiry/20"
        >
          <FlaskConical className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">Scenario: </span>
          <span className="truncate">{state.scenarioName}</span>
        </Link>
      )}
      <span className="glass-pill inline-flex h-9 items-center gap-1 px-1">
        <Fact icon={<CalendarDays className="size-3.5" strokeWidth={1.6} />} label="As of">
          {formatDisplayDate(state.asOf)}
        </Fact>
        <span className="h-4 w-px bg-white/10" aria-hidden />
        <Fact icon={<ShieldCheck className="size-3.5" strokeWidth={1.6} />} label="Owner approval above">
          {formatINR(state.approvalLimit, { paise: false })}
        </Fact>
      </span>
    </div>
  );
}

function Fact({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5" title={label}>
      <span className="text-fg-3" aria-hidden>
        {icon}
      </span>
      <span className="text-[12px] text-fg-3 max-2xl:sr-only">{label}</span>
      <span className="num text-[12.5px] text-fg-1">{children}</span>
    </span>
  );
}
