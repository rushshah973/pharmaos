"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useSyncExternalStore } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DataSourceBadge } from "./DataSourceBadge";
import { Logo } from "./Logo";
import { NAV_ITEMS, isActive } from "./nav";

// Collapsed state: the user's toggle (remembered per browser) or a viewport below 1024 px.
// Width is driven by CSS (data attribute + max-lg), so there is no layout shift on load;
// JS only decides whether the icon-rail tooltips are enabled.
const STORAGE_KEY = "pharmaos.sidebar.collapsed";
const NARROW = "(max-width: 1023px)";
const listeners = new Set<() => void>();

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(value: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // Storage blocked: the toggle still works for this page view.
  }
  listeners.forEach((l) => l());
}

function subscribeCollapsed(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(NARROW);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function Sidebar({ demoUser }: { demoUser: string }) {
  const userCollapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const narrow = useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
  const railMode = userCollapsed || narrow;
  const initials = demoUser
    .split(/[.\s_-]+/)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);

  return (
    <aside
      data-collapsed={userCollapsed}
      className="group/sb sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface-1 transition-[width] duration-200 ease-out data-[collapsed=true]:w-16 max-lg:w-16"
    >
      <div className="flex h-14 items-center justify-between border-b border-border px-4 group-data-[collapsed=true]/sb:justify-center group-data-[collapsed=true]/sb:px-0 max-lg:justify-center max-lg:px-0">
        <Link href="/" aria-label="PharmaOS home" className="rounded-md">
          <Logo wordmarkClassName="group-data-[collapsed=true]/sb:hidden max-lg:hidden" />
        </Link>
        <button
          type="button"
          onClick={() => writeCollapsed(true)}
          className="group-data-[collapsed=true]/sb:hidden max-lg:hidden flex size-7 items-center justify-center rounded-md text-fg-3 transition-colors duration-150 hover:bg-surface-2 hover:text-fg-1"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="size-4" strokeWidth={1.75} />
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4 group-data-[collapsed=true]/sb:px-2.5 max-lg:px-2.5" aria-label="Main">
        <p className="micro-label mb-2 px-2.5 group-data-[collapsed=true]/sb:hidden max-lg:hidden">Workspace</p>
        {/* The active link needs the URL, which is only known at request time: stream it in (Cache Components). */}
        <Suspense fallback={<NavLinks pathname={null} railMode={railMode} />}>
          <ActiveNavLinks railMode={railMode} />
        </Suspense>
      </nav>

      <div className="space-y-3 border-t border-border p-3 group-data-[collapsed=true]/sb:flex group-data-[collapsed=true]/sb:flex-col group-data-[collapsed=true]/sb:items-center max-lg:flex max-lg:flex-col max-lg:items-center">
        <DataSourceBadge className="group-data-[collapsed=true]/sb:hidden max-lg:hidden" />
        <DataSourceBadge compact className="hidden group-data-[collapsed=true]/sb:inline-flex max-lg:inline-flex" />
        <div className="flex items-center gap-2.5 rounded-lg px-1 group-data-[collapsed=true]/sb:px-0 max-lg:px-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11.5px] font-semibold text-fg-1 ring-1 ring-border-strong">
            {initials || "D"}
          </span>
          <span className="min-w-0 leading-tight group-data-[collapsed=true]/sb:hidden max-lg:hidden">
            <span className="block truncate font-mono text-[12.5px] text-fg-1">{demoUser}</span>
            <span className="block text-[11.5px] text-fg-3">Owner · demo account</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => writeCollapsed(false)}
          className="hidden group-data-[collapsed=true]/sb:flex max-lg:hidden! size-7 items-center justify-center rounded-md text-fg-3 transition-colors duration-150 hover:bg-surface-2 hover:text-fg-1"
          aria-label="Expand sidebar"
        >
          <PanelLeftOpen className="size-4" strokeWidth={1.75} />
        </button>
      </div>
    </aside>
  );
}

function ActiveNavLinks({ railMode }: { railMode: boolean }) {
  return <NavLinks pathname={usePathname()} railMode={railMode} />;
}

function NavLinks({ pathname, railMode }: { pathname: string | null; railMode: boolean }) {
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = pathname !== null && isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Tooltip key={item.href} disabled={!railMode}>
            <TooltipTrigger
              render={
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors duration-150",
                    "group-data-[collapsed=true]/sb:justify-center group-data-[collapsed=true]/sb:px-0 max-lg:justify-center max-lg:px-0",
                    active ? "bg-surface-3 text-fg-1" : "text-fg-2 hover:bg-surface-2 hover:text-fg-1",
                  )}
                />
              }
            >
              {active && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-brand" aria-hidden />}
              <Icon className={cn("size-4 shrink-0", active && "text-brand")} strokeWidth={1.75} aria-hidden />
              <span className="truncate group-data-[collapsed=true]/sb:sr-only max-lg:sr-only">{item.label}</span>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={10}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </>
  );
}
