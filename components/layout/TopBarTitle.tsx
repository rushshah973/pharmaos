"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { navItemFor } from "./nav";

const DETAIL_LABEL: Record<string, string> = {
  "/procurement": "Plan",
  "/purchase-orders": "Purchase order",
};

/** Breadcrumb from the URL: section, plus a detail crumb on /procurement/[id] and /purchase-orders/[id]. */
export function TopBarTitle() {
  const pathname = usePathname();
  const item = navItemFor(pathname);
  const detail = item.href !== "/" && pathname !== item.href ? DETAIL_LABEL[item.href] : undefined;

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[13.5px]">
      {detail ? (
        <>
          <Link href={item.href} className="truncate text-fg-2 transition-colors duration-150 hover:text-fg-1">
            {item.label}
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-fg-3" aria-hidden />
          <span className="truncate font-medium text-fg-1">{detail}</span>
        </>
      ) : (
        <span className="truncate font-medium text-fg-1">{item.label}</span>
      )}
    </div>
  );
}
