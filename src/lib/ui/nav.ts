/** Owner navigation. Icons are added in AppShell; this stays testable in node. */

export type NavBadge = "missing" | "chats";

export interface NavItem {
  href: string;
  label: string;
  match: (path: string) => boolean;
  badge?: NavBadge;
}

export const BOTTOM_TABS: NavItem[] = [
  { href: "/", label: "Today", match: (p) => p === "/" },
  { href: "/waves", label: "Ship", match: (p) => p.startsWith("/waves") },
  {
    href: "/returns?filter=missing",
    label: "Returns",
    match: (p) => p.startsWith("/returns"),
    badge: "missing",
  },
  { href: "/items", label: "Stock", match: (p) => p.startsWith("/items") },
  // Chats took Scan's slot: the owner checks chats all day. Scan is in the top bar.
  { href: "/chats", label: "Chats", match: (p) => p === "/chats" || p.startsWith("/chats/"), badge: "chats" },
];

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
  return tabs.findIndex((t) => t.match(path));
}
