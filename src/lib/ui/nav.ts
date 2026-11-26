/** Owner navigation. Icons are added in AppShell; this stays testable in node. */

export type NavBadge = "missing" | "chats" | "approvals";

export interface NavItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
  badge?: NavBadge;
}

/** Four direct thumb-zone tabs; the 5th slot opens the Menu bottom sheet. */
export const BOTTOM_TABS: NavItem[] = [
  { href: "/", label: "Today", match: (p) => p === "/" },
  { href: "/waves", label: "Ship", match: (p) => p.startsWith("/waves") },
  {
    href: "/returns?filter=missing",
    label: "Returns",
    match: (p) => p.startsWith("/returns"),
    badge: "missing",
  },
  {
    href: "/chats",
    label: "Chats",
    match: (p) => p === "/chats" || p.startsWith("/chats/"),
    badge: "chats",
  },
];

export const MENU_ROUTE_PREFIXES = [
  "/items",
  "/listings",
  "/restock",
  "/approvals",
  "/profit",
  "/orders",
  "/imports",
  "/settings",
] as const;

export function isMenuRoute(path: string): boolean {
  return MENU_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export const SIDEBAR_PRIMARY_ITEMS: NavItem[] = [
  { href: "/", label: "Today", match: (p) => p === "/" },
  {
    href: "/returns?filter=missing",
    label: "Returns",
    match: (p) => p.startsWith("/returns"),
    badge: "missing",
  },
  { href: "/chats", label: "Chats", match: (p) => p === "/chats" || p.startsWith("/chats/"), badge: "chats" },
  { href: "/scan", label: "Scan", match: (p) => p.startsWith("/scan") },
  { href: "/orders", label: "Find an order", match: (p) => p.startsWith("/orders") },
];

export function activeTabIndex(path: string, tabs: NavItem[] = BOTTOM_TABS): number {
  const direct = tabs.findIndex((t) => t.match(path));
  if (direct >= 0) return direct;
  if (tabs === BOTTOM_TABS && isMenuRoute(path)) return BOTTOM_TABS.length;
  return -1;
}
