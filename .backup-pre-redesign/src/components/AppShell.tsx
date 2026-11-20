"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  CalendarCheck2,
  QrCode,
  SlidersHorizontal,
  Upload,
} from "lucide-react";

interface AppShellProps {
  children: React.ReactNode;
  missingCount?: number;
  headerRight?: React.ReactNode;
  title?: string;
}

export function AppShell({
  children,
  missingCount = 0,
  headerRight,
  title = "Kyna Ops",
}: AppShellProps) {
  const pathname = usePathname();

  const navItems = [
    {
      href: "/",
      label: "Today",
      icon: CalendarCheck2,
      active: pathname === "/",
    },
    {
      href: "/returns?filter=missing",
      label: "Missing",
      icon: AlertTriangle,
      active: pathname === "/returns",
      badge: missingCount > 0 ? missingCount : undefined,
    },
    {
      href: "/scan",
      label: "Scan",
      icon: QrCode,
      active: pathname === "/scan",
    },
    {
      href: "/imports",
      label: "Upload",
      icon: Upload,
      active: pathname === "/imports",
      desktopOnly: true,
    },
    {
      href: "/settings",
      label: "More",
      icon: SlidersHorizontal,
      active: pathname === "/settings" || pathname === "/imports",
    },
  ];

  const mobileTabs = navItems.filter((item) => !item.desktopOnly);

  return (
    <div className="min-h-dvh bg-[#f4f7f8] text-slate-900 pb-24 md:pb-10">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-[19px] font-extrabold tracking-tight text-slate-900"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0f766e] text-sm font-extrabold text-white">
                K
              </span>
              <span>{title}</span>
            </Link>

            <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  item.href === "/settings"
                    ? pathname === "/settings"
                    : item.active;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 ${
                      isActive
                        ? "bg-teal-50 text-[#0f766e]"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2.2} />
                    <span>{item.label === "More" ? "Settings" : item.label}</span>
                    {item.badge !== undefined && (
                      <span className="tabular-nums rounded-full bg-red-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">{headerRight}</div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-4">{children}</main>

      <nav
        aria-label="Mobile navigation"
        className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white md:hidden"
      >
        <div className="mx-auto grid h-16 max-w-md grid-cols-4">
          {mobileTabs.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors duration-150 ${
                  item.active ? "text-[#0f766e]" : "text-slate-500 active:text-slate-800"
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={item.active ? 2.4 : 2} />
                  {item.badge !== undefined && (
                    <span className="tabular-nums absolute -right-3 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 py-0.5 text-center text-[10px] font-extrabold leading-none text-white">
                      {item.badge}
                    </span>
                  )}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
