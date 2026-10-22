"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NAV_ITEMS, isActive } from "./nav";

/** The section pills in the top bar. Below 1280 px only the active pill keeps its label (the rest show tooltips). */
export function NavPills({ pathname }: { pathname: string | null }) {
  return (
    <nav aria-label="Main" className="glass-pill flex items-center gap-0.5 p-1">
      {NAV_ITEMS.map((item) => {
        const active = pathname !== null && isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Tooltip key={item.href}>
            <TooltipTrigger
              render={
                <Link
                  href={item.href}
                  // Every page reads the remote database; prefetching all six fills the connection pool.
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-9 items-center gap-2 rounded-full px-3.5 text-[13.5px] transition-all duration-200",
                    active
                      ? "bg-white/[0.11] text-fg-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_6px_20px_-8px_rgba(0,0,0,0.8)]"
                      : "text-fg-2 hover:bg-white/[0.05] hover:text-fg-1 max-xl:px-2.5",
                  )}
                />
              }
            >
              <Icon className={cn("size-4 shrink-0", active ? "text-brand" : "opacity-80")} strokeWidth={1.6} aria-hidden />
              <span className={cn("whitespace-nowrap", !active && "max-xl:sr-only")}>{item.label}</span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={10} className={cn(active && "hidden")}>
              {item.label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

export function ActiveNavPills() {
  return <NavPills pathname={usePathname()} />;
}
