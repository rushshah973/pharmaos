import {
  Activity,
  Boxes,
  ClipboardList,
  Database,
  FileText,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon };

// The six dashboard sections (implementationplan.md §10.2).
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Command Center", icon: LayoutDashboard },
  { href: "/procurement", label: "Plans", icon: ClipboardList },
  { href: "/warehouse", label: "Warehouse", icon: Boxes },
  { href: "/purchase-orders", label: "Orders", icon: FileText },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/data", label: "Data & AI", icon: Database },
];

export function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function navItemFor(pathname: string): NavItem {
  return NAV_ITEMS.find((item) => item.href !== "/" && isActive(pathname, item.href)) ?? NAV_ITEMS[0];
}
