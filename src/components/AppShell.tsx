"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck2, PackageSearch, ScanBarcode, Settings2, type LucideIcon } from "lucide-react";
import { Toaster } from "@/components/ui/Toast";
import { formatBadgeCount } from "@/lib/ui/format";

interface AppShellProps {
  children: React.ReactNode;
  /** Large page title. Shrinks into the top bar once it scrolls away. */
  title: string;
  /** Small element beside the large title, e.g. the "Sample" pill. */
  titleAccessory?: React.ReactNode;
  headerRight?: React.ReactNode;
  /** Pass on screens that know the count; others reuse the last known value. */
  missingCount?: number;
}

interface Tab {
  href: string;
  label: string;
  desktopLabel?: string;
  icon: LucideIcon;
  match: (path: string) => boolean;
  badge?: boolean;
}

const TABS: Tab[] = [
  { href: "/", label: "Today", icon: CalendarCheck2, match: (p) => p === "/" },
  {
    href: "/returns?filter=missing",
    label: "Missing",
    desktopLabel: "Returns",
    icon: PackageSearch,
    match: (p) => p.startsWith("/returns"),
    badge: true,
  },
  { href: "/scan", label: "Scan", icon: ScanBarcode, match: (p) => p.startsWith("/scan") },
  {
    href: "/settings",
    label: "More",
    desktopLabel: "Settings",
    icon: Settings2,
    match: (p) => p.startsWith("/settings") || p.startsWith("/imports"),
  },
];

// Every page mounts its own shell. These survive client navigation so the
// tab indicator can slide from the old tab and the badge doesn't pop again.
let lastTabIndex = -1;
let lastMissing = 0;

export function AppShell({
  children,
  title,
  titleAccessory,
  headerRight,
  missingCount,
}: AppShellProps) {
  const pathname = usePathname();
  const activeIndex = TABS.findIndex((t) => t.match(pathname));

  const [indicatorIndex, setIndicatorIndex] = useState(
    lastTabIndex >= 0 ? lastTabIndex : activeIndex
  );
  useEffect(() => {
    const id = requestAnimationFrame(() => setIndicatorIndex(activeIndex));
    lastTabIndex = activeIndex;
    return () => cancelAnimationFrame(id);
  }, [activeIndex]);

  const missing = missingCount ?? lastMissing;
  const badgeChanged = missing !== lastMissing;
  useEffect(() => {
    lastMissing = missing;
  }, [missing]);
  const badge = formatBadgeCount(missing);

  // Large title → compact title once it scrolls under the bar.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCollapsed(!entry.isIntersecting), {
      rootMargin: "-56px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="min-h-dvh pb-[calc(max(12px,env(safe-area-inset-bottom))+100px)] md:pb-16">
      <header
        className={`safe-top sticky top-0 z-30 transition-[background-color,border-color,backdrop-filter] duration-200 ${
          collapsed
            ? "border-b border-hairline bg-white/80 backdrop-blur-xl backdrop-saturate-150"
            : "border-b border-transparent bg-ground"
        }`}
      >
        <div className="relative mx-auto flex h-12 max-w-3xl items-center justify-between px-5 md:h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="hidden text-[17px] font-extrabold tracking-tight text-ink md:block">
              Kyna Ops
            </Link>
            <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
              {TABS.map((tab, i) => {
                const active = i === activeIndex;
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={`pressable inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-semibold ${
                      active ? "bg-white text-ink shadow-[var(--shadow-card)]" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    {tab.desktopLabel ?? tab.label}
                    {tab.badge && badge && (
                      <span className="tabular-nums rounded-full bg-missing px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Compact title (mobile), fades in when the large title is gone */}
          <p
            aria-hidden={!collapsed}
            className={`pointer-events-none absolute inset-x-20 text-center text-[17px] font-bold text-ink transition-[opacity,translate] duration-200 ease-[var(--ease-ios)] md:hidden ${
              collapsed ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
          >
            {title}
          </p>

          <div className="ml-auto flex items-center gap-1">{headerRight}</div>
        </div>
      </header>

      <main className="anim-page-in mx-auto max-w-3xl px-5">
        <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 pb-6 pt-1 md:pt-4">
          <h1
            ref={titleRef}
            className="text-[34px] font-extrabold leading-[1.1] tracking-[-0.025em] text-ink"
          >
            {title}
          </h1>
          {titleAccessory}
        </div>
        {children}
      </main>

      {/* Floating pill tab bar. Sits above the home indicator, not flush with the edge. */}
      <nav
        aria-label="Tabs"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden"
      >
        <div className="pointer-events-auto relative mx-auto grid h-16 max-w-sm grid-cols-4 rounded-full bg-white/80 p-1.5 shadow-[0_10px_30px_-8px_rgb(15_23_42/0.25),0_0_0_1px_rgb(15_23_42/0.06)] backdrop-blur-xl backdrop-saturate-150">
          {indicatorIndex >= 0 && (
            <span
              aria-hidden="true"
              data-motion="slide"
              className="absolute inset-y-1.5 left-1.5 rounded-full bg-brand/10 transition-transform duration-300 ease-[var(--ease-ios)]"
              style={{
                width: "calc((100% - 12px) / 4)",
                transform: `translateX(${indicatorIndex * 100}%)`,
              }}
            />
          )}
          {TABS.map((tab, i) => {
            const Icon = tab.icon;
            const active = i === activeIndex;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`pressable relative flex flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-semibold transition-colors duration-150 ${
                  active ? "text-brand" : "text-ink-3 active:text-ink"
                }`}
              >
                <span className="relative flex h-6 items-center">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.3 : 1.9} />
                  {tab.badge && badge && (
                    <span
                      key={badgeChanged ? `b-${missing}` : "b"}
                      className={`tabular-nums absolute -right-3.5 -top-1 min-w-[18px] rounded-full bg-missing px-1 py-[3px] text-center text-[10px] font-bold leading-none text-white ring-2 ring-white ${
                        badgeChanged ? "anim-pop" : ""
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </span>
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <Toaster />
    </div>
  );
}

/** Round icon button for the top bar. */
export function BarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="pressable flex h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-black/[0.04] disabled:text-ink-3"
    >
      {children}
    </button>
  );
}
