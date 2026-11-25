"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarCheck2,
  FileUp,
  MessageCircle,
  PackageSearch,
  Printer,
  ScanBarcode,
  Search,
  Settings2,
  Shirt,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Toaster } from "@/components/ui/Toast";
import { PullIndicator } from "@/components/ui/PullToRefresh";
import { usePullToRefresh } from "@/lib/ui/use-pull-to-refresh";
import { formatBadgeCount } from "@/lib/ui/format";
import { BOTTOM_TABS, SIDEBAR_PRIMARY_ITEMS, type NavBadge, type NavItem } from "@/lib/ui/nav";

interface AppShellProps {
  children: React.ReactNode;
  /** Large page title. Shrinks into the top bar once it scrolls away. */
  title: string;
  /** Small element beside the large title, e.g. the "Sample" pill. */
  titleAccessory?: React.ReactNode;
  headerRight?: React.ReactNode;
  /** Pass on screens that know the count; others reuse the last known value. */
  missingCount?: number;
  /** Content max-width on desktop; "wide" opens up to max-w-6xl. */
  width?: "default" | "wide";
  /** Line under the large title, e.g. the "Updated · Pull to sync" status. */
  subtitle?: React.ReactNode;
  /** Pull down from the top of the page to run this (touch only). */
  onRefresh?: () => Promise<unknown> | void;
  /** Turn the pull off for a while, e.g. while the camera is scanning. */
  pullEnabled?: boolean;
  /** Pass on screens that know the unread chat count (Chats); others poll for it. */
  chatUnread?: number;
}

interface Tab extends NavItem {
  icon: LucideIcon;
}

const ICONS: Record<string, LucideIcon> = {
  "/": CalendarCheck2,
  "/waves": Printer,
  "/returns?filter=missing": PackageSearch,
  "/items": Shirt,
  "/chats": MessageCircle,
  "/scan": ScanBarcode,
  "/orders": Search,
};

const withIcons = (items: NavItem[]): Tab[] => items.map((t) => ({ ...t, icon: ICONS[t.href] ?? Search }));

const TABS: Tab[] = withIcons(BOTTOM_TABS);
const SIDEBAR_PRIMARY: Tab[] = withIcons(SIDEBAR_PRIMARY_ITEMS);

interface BadgeView {
  text: string | null;
  changed: boolean;
  count: number;
}

/** Missing is crimson (DESIGN.md reserves it); unread chats use the brand pink. */
const BADGE_TONE: Record<NavBadge, string> = {
  missing: "bg-missing-solid text-white",
  chats: "bg-brand-solid text-on-brand",
};

/** How often other screens re-check unread chats while open. */
const CHAT_UNREAD_POLL_MS = 30_000;

const SIDEBAR_OPS: Tab[] = [
  { href: "/profit", label: "Profit", icon: TrendingUp, match: (p) => p.startsWith("/profit") },
  { href: "/items", label: "Items & stock", icon: Shirt, match: (p) => p.startsWith("/items") },
  { href: "/waves", label: "Waves & pick lists", icon: Printer, match: (p) => p.startsWith("/waves") },
  { href: "/imports", label: "Upload a file", icon: FileUp, match: (p) => p.startsWith("/imports") },
];

const SIDEBAR_FOOTER: Tab[] = [
  { href: "/settings", label: "Settings", icon: Settings2, match: (p) => p.startsWith("/settings") },
];

function SidebarList({
  items,
  pathname,
  badges,
  className = "",
}: {
  items: Tab[];
  pathname: string;
  badges: Record<NavBadge, BadgeView>;
  className?: string;
}) {
  return (
    <ul className={`space-y-1 ${className}`}>
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        const b = item.badge ? badges[item.badge] : null;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`pressable flex h-11 items-center gap-3 rounded-[var(--radius-control)] px-3 text-[15px] font-semibold ${
                active
                  ? "bg-surface text-ink shadow-[var(--shadow-card)]"
                  : "text-ink-2 hover:bg-ink/[0.05] hover:text-ink"
              }`}
            >
              <Icon
                className={`h-5 w-5 shrink-0 transition-transform duration-200 ease-[var(--ease-ios)] ${
                  active ? "scale-[1.06] text-brand" : "text-ink-3"
                }`}
                strokeWidth={active ? 2.3 : 1.9}
              />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.badge && b?.text && (
                <span
                  key={b.changed ? `sb-${b.count}` : "sb"}
                  aria-label={item.badge === "chats" ? `${b.text} unread` : `${b.text} missing`}
                  className={`tabular-nums rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none ${
                    BADGE_TONE[item.badge]
                  } ${b.changed ? "anim-pop" : ""}`}
                >
                  {b.text}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// Every page mounts its own shell. These survive client navigation so the
// tab indicator can slide from the old tab and the badge doesn't pop again.
let lastTabIndex = -1;
let lastMissing = 0;
/** Whether any screen has told us the Missing count this session. */
let missingKnown = false;
let lastChatUnread = 0;
let chatUnreadFetchedAt = 0;

export function AppShell({
  children,
  title,
  titleAccessory,
  headerRight,
  missingCount,
  width = "default",
  subtitle,
  onRefresh,
  pullEnabled = true,
  chatUnread,
}: AppShellProps) {
  const pull = usePullToRefresh(onRefresh, pullEnabled);
  const pathname = usePathname();
  const activeIndex = TABS.findIndex((t) => t.match(pathname));
  const maxW = width === "wide" ? "max-w-6xl" : "max-w-3xl";

  const [indicatorIndex, setIndicatorIndex] = useState(
    lastTabIndex >= 0 ? lastTabIndex : activeIndex
  );
  useEffect(() => {
    const id = requestAnimationFrame(() => setIndicatorIndex(activeIndex));
    lastTabIndex = activeIndex;
    return () => cancelAnimationFrame(id);
  }, [activeIndex]);

  // Screens other than Home don't know the Missing count. On a cold load there
  // (e.g. a deep link to /items) ask once, so the Returns badge isn't blank.
  const [fetchedMissing, setFetchedMissing] = useState<number | null>(null);
  useEffect(() => {
    if (missingCount !== undefined || missingKnown) return;
    missingKnown = true;
    let active = true;
    fetch("/api/returns?filter=missing&limit=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d && typeof d.totalCount === "number") setFetchedMissing(d.totalCount);
      })
      .catch(() => {
        missingKnown = false;
      });
    return () => {
      active = false;
    };
  }, [missingCount]);

  const missing = missingCount ?? fetchedMissing ?? lastMissing;
  const badgeChanged = missing !== lastMissing;
  useEffect(() => {
    lastMissing = missing;
    if (missingCount !== undefined) missingKnown = true;
  }, [missing, missingCount]);
  const badge = formatBadgeCount(missing);

  // Unread chats: screens other than Chats check now and then while visible.
  const [fetchedChatUnread, setFetchedChatUnread] = useState<number | null>(null);
  useEffect(() => {
    if (chatUnread !== undefined) return;
    let active = true;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - chatUnreadFetchedAt < CHAT_UNREAD_POLL_MS - 1000) return;
      chatUnreadFetchedAt = Date.now();
      fetch("/api/chats/unread", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (active && d && typeof d.total === "number") setFetchedChatUnread(d.total);
        })
        .catch(() => {
          chatUnreadFetchedAt = 0;
        });
    };
    load();
    const id = setInterval(load, CHAT_UNREAD_POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      active = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", load);
    };
  }, [chatUnread]);

  const chats = chatUnread ?? fetchedChatUnread ?? lastChatUnread;
  const chatChanged = chats !== lastChatUnread;
  useEffect(() => {
    lastChatUnread = chats;
    if (chatUnread !== undefined) chatUnreadFetchedAt = Date.now();
  }, [chats, chatUnread]);

  const badges: Record<NavBadge, BadgeView> = {
    missing: { text: badge, changed: badgeChanged, count: missing },
    chats: { text: formatBadgeCount(chats), changed: chatChanged, count: chats },
  };

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
    <div className="min-h-dvh pb-[calc(max(12px,env(safe-area-inset-bottom))+100px)] lg:pb-16 lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-hairline bg-ground px-3 pb-4 lg:flex">
        <Link
          href="/"
          className="flex h-16 shrink-0 items-center px-3 text-[17px] font-extrabold tracking-tight text-ink"
        >
          Kyna Ops
        </Link>
        <nav aria-label="Primary" className="flex min-h-0 flex-1 flex-col">
          <SidebarList items={SIDEBAR_PRIMARY} pathname={pathname} badges={badges} />
          <hr className="mx-3 my-3 border-hairline" />
          <SidebarList items={SIDEBAR_OPS} pathname={pathname} badges={badges} />
          <SidebarList items={SIDEBAR_FOOTER} pathname={pathname} badges={badges} className="mt-auto" />
        </nav>
      </aside>

      <header
        className={`safe-top sticky top-0 z-30 transition-[background-color,border-color,backdrop-filter] duration-200 ${
          collapsed
            ? "border-b border-hairline bg-surface/80 backdrop-blur-xl backdrop-saturate-150"
            : "border-b border-transparent bg-ground"
        }`}
      >
        <div className={`relative mx-auto flex h-12 items-center justify-between px-5 lg:h-16 lg:px-8 ${maxW}`}>
          {/* Compact title, fades in when the large title scrolls under the bar */}
          <p
            aria-hidden={!collapsed}
            className={`pointer-events-none absolute left-20 right-20 text-center text-[17px] font-bold text-ink transition-[opacity,translate] duration-200 ease-[var(--ease-ios)] lg:left-8 lg:right-auto lg:text-left ${
              collapsed ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
          >
            {title}
          </p>

          <div className="ml-auto flex items-center gap-1">
            {headerRight}
            {/* Scan left the tab bar for Chats; it stays one tap away on every phone screen. */}
            <Link
              href="/scan"
              aria-label="Scan"
              title="Scan"
              className="pressable flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-ink/[0.05] lg:hidden"
            >
              <ScanBarcode className="h-[22px] w-[22px]" />
            </Link>
            {pathname !== "/settings" && (
              <Link
                href="/settings"
                aria-label="Settings"
                title="Settings"
                className="pressable flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-ink/[0.05] lg:hidden"
              >
                <Settings2 className="h-[22px] w-[22px]" />
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className={`anim-page-in mx-auto px-5 lg:px-8 ${maxW}`}>
        <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 pb-6 pt-1 lg:pt-2">
          <h1
            ref={titleRef}
            className="text-[34px] font-extrabold leading-[1.1] tracking-[-0.025em] text-ink"
          >
            {title}
          </h1>
          {titleAccessory}
          {subtitle && <div className="basis-full">{subtitle}</div>}
        </div>
        {children}
      </main>

      {/* Floating pill tab bar. Sits above the home indicator, not flush with the edge. */}
      <nav
        aria-label="Tabs"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(12px,env(safe-area-inset-bottom))] lg:hidden"
      >
        <div className="pointer-events-auto relative mx-auto grid h-16 max-w-md grid-cols-5 rounded-full bg-surface/85 p-1.5 shadow-[var(--shadow-tab-bar)] backdrop-blur-xl backdrop-saturate-150">
          {indicatorIndex >= 0 && (
            <span
              aria-hidden="true"
              data-motion="slide"
              className="absolute inset-y-1.5 left-1.5 rounded-full bg-brand/12 transition-transform duration-300 ease-[var(--ease-ios)]"
              style={{
                width: "calc((100% - 12px) / 5)",
                transform: `translateX(${indicatorIndex * 100}%)`,
              }}
            />
          )}
          {TABS.map((tab, i) => {
            const Icon = tab.icon;
            const active = i === activeIndex;
            const b = tab.badge ? badges[tab.badge] : null;
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
                  <Icon
                    className={`h-[22px] w-[22px] transition-transform duration-200 ease-[var(--ease-ios)] ${
                      active ? "scale-[1.06]" : ""
                    }`}
                    strokeWidth={active ? 2.3 : 1.9}
                  />
                  {tab.badge && b?.text && (
                    <span
                      key={b.changed ? `b-${b.count}` : "b"}
                      aria-label={tab.badge === "chats" ? `${b.text} unread` : `${b.text} missing`}
                      className={`tabular-nums absolute -right-3.5 -top-1 min-w-[18px] rounded-full px-1 py-[3px] text-center text-[10px] font-bold leading-none ring-2 ring-surface ${
                        BADGE_TONE[tab.badge]
                      } ${b.changed ? "anim-pop" : ""}`}
                    >
                      {b.text}
                    </span>
                  )}
                </span>
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {onRefresh && <PullIndicator {...pull} />}

      <Toaster className="lg:pl-60" />
    </div>
  );
}

/** Round icon button for the top bar. */
export function BarButton({
  label,
  onClick,
  disabled,
  className = "flex",
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Display utilities, e.g. "hidden lg:flex" for desktop-only buttons. */
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`pressable ${className} h-11 w-11 items-center justify-center rounded-full text-brand hover:bg-ink/[0.05] disabled:text-ink-3`}
    >
      {children}
    </button>
  );
}
