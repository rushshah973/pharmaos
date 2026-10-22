"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { navItemFor } from "./nav";

/** On a detail page (/procurement/[id], /purchase-orders/[id]): a quiet "back to section" crumb. */
export function Breadcrumb() {
  const pathname = usePathname();
  const item = navItemFor(pathname);
  if (item.href === "/" || pathname === item.href) return null;
  return (
    <Link href={item.href} className="mb-4 inline-flex items-center gap-1 text-[12.5px] text-fg-3 transition-colors duration-150 hover:text-fg-1 print:hidden">
      <ChevronLeft className="size-3.5" aria-hidden />
      {item.label}
    </Link>
  );
}
