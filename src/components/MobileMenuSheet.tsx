"use client";

import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  FileUp,
  PackagePlus,
  ScanBarcode,
  Search,
  Settings2,
  Shirt,
  Tag,
  TrendingUp,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { formatBadgeCount } from "@/lib/ui/format";
import { haptic } from "@/lib/ui/motion";

interface MenuRow {
  href: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
  badgeText?: string | null;
}

const QUICK_ACTIONS: Array<{ href: string; label: string; icon: LucideIcon; match: (p: string) => boolean }> = [
  { href: "/orders", label: "Find order", icon: Search, match: (p) => p === "/orders" || p.startsWith("/orders/") },
  { href: "/scan", label: "Scan parcel", icon: ScanBarcode, match: (p) => p === "/scan" || p.startsWith("/scan/") },
  { href: "/stock-in?from=owner", label: "Add delivery", icon: PackagePlus, match: (p) => p === "/stock-in" },
];

function MenuSection({
  title,
  rows,
  pathname,
  onNavigate,
}: {
  title: string;
  rows: MenuRow[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <section>
      <h3 className="px-3 pb-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-ink-3">{title}</h3>
      <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] bg-surface-subtle">
        {rows.map((row) => {
          const Icon = row.icon;
          const active = row.match(pathname);
          return (
            <li key={row.href}>
              <Link
                href={row.href}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  haptic("tap");
                  onNavigate();
                }}
                className={`pressable-row flex min-h-[56px] items-center gap-3 px-3.5 py-2.5 text-left ${
                  active
                    ? "bg-brand-soft text-brand"
                    : "text-ink hover:bg-surface-muted/70 active:bg-surface-muted"
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    active ? "bg-brand/15 text-brand" : "bg-surface text-ink-2 shadow-[var(--shadow-card)]"
                  }`}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[16px] font-semibold leading-tight ${
                      active ? "text-brand" : "text-ink"
                    }`}
                  >
                    {row.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-ink-3">{row.detail}</span>
                </span>
                {row.badgeText && (
                  <span className="tabular-nums shrink-0 rounded-full bg-brand-solid px-2 py-0.5 text-[12px] font-bold text-on-brand">
                    {row.badgeText}
                  </span>
                )}
                <ChevronRight className={`h-5 w-5 shrink-0 ${active ? "text-brand" : "text-ink-3/70"}`} />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function MobileMenuSheet({
  open,
  onClose,
  pathname,
  pendingApprovals,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  pendingApprovals: number;
}) {
  const approvalsBadge = formatBadgeCount(pendingApprovals);

  const stockRows: MenuRow[] = [
    {
      href: "/items",
      label: "Items & stock",
      detail: "Counts, links & Shopee bump",
      icon: Shirt,
      match: (p) => p === "/items" || p.startsWith("/items/"),
    },
    {
      href: "/listings",
      label: "Listings & prices",
      detail: "Compare & update shop prices",
      icon: Tag,
      match: (p) => p === "/listings" || p.startsWith("/listings/"),
    },
    {
      href: "/restock",
      label: "Restock & suppliers",
      detail: "Supplier orders & reorder list",
      icon: Truck,
      match: (p) => p === "/restock" || p.startsWith("/restock/"),
    },
  ];

  const moneyRows: MenuRow[] = [
    {
      href: "/approvals",
      label: "Approvals",
      detail: "Replies & price updates",
      icon: CheckCircle2,
      match: (p) => p === "/approvals" || p.startsWith("/approvals/"),
      badgeText: approvalsBadge,
    },
    {
      href: "/profit",
      label: "Profit",
      detail: "Monthly profit after fees & cost",
      icon: TrendingUp,
      match: (p) => p === "/profit" || p.startsWith("/profit/"),
    },
    {
      href: "/imports",
      label: "Upload a file",
      detail: "Shopee or TikTok spreadsheets",
      icon: FileUp,
      match: (p) => p === "/imports" || p.startsWith("/imports/"),
    },
  ];

  const settingsRows: MenuRow[] = [
    {
      href: "/settings",
      label: "Settings",
      detail: "Shops, printer, Telegram, theme & staff",
      icon: Settings2,
      match: (p) => p === "/settings" || p.startsWith("/settings/"),
    },
  ];

  return (
    <Sheet open={open} onClose={onClose} title="Menu">
      <div className="space-y-5 pt-1">
        <div className="grid grid-cols-3 gap-2.5">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            const active = action.match(pathname);
            return (
              <Link
                key={action.href}
                href={action.href}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  haptic("tap");
                  onClose();
                }}
                className={`pressable flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] px-2 py-3 text-center ${
                  active
                    ? "bg-brand-soft text-brand ring-1 ring-inset ring-brand/30"
                    : "bg-surface-subtle text-ink hover:bg-surface-muted active:bg-surface-muted"
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full ${
                    active ? "bg-brand/15 text-brand" : "bg-surface text-brand shadow-[var(--shadow-card)]"
                  }`}
                >
                  <Icon className="h-[19px] w-[19px]" strokeWidth={2.1} />
                </span>
                <span className="text-[13px] font-bold leading-tight">{action.label}</span>
              </Link>
            );
          })}
        </div>

        <MenuSection title="Stock & shop" rows={stockRows} pathname={pathname} onNavigate={onClose} />
        <MenuSection title="Money & queue" rows={moneyRows} pathname={pathname} onNavigate={onClose} />
        <MenuSection title="App" rows={settingsRows} pathname={pathname} onNavigate={onClose} />
      </div>
    </Sheet>
  );
}
