"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, PackageSearch, Search, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ParcelDetailPanel, ParcelDetailSheet } from "@/components/ParcelDetailSheet";
import { ParcelRow } from "@/components/ParcelRow";
import { Button, Group } from "@/components/ui/Button";
import { ScrollChips } from "@/components/ui/ScrollChips";
import { toast } from "@/components/ui/Toast";
import { manilaDayLabel } from "@/lib/ui/format";
import { stepSelection } from "@/lib/ui/returns-nav";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/ui/use-media-query";
import { useLiveRefresh } from "@/lib/ui/use-live-refresh";
import {
  EMPTY_DATE_FILTER,
  RETURN_DATE_PRESETS,
  RETURN_FILTERS,
  hasActiveDateFilter,
  parseReturnDateFilter,
  parseReturnFilter,
  returnsUrl,
  type ReturnDateFilter,
  type ReturnDatePreset,
  type ReturnFilter,
} from "@/lib/ui/returns-filter";

interface ReturnRow {
  id: string;
  courier: string;
  category: "FAILED_DELIVERY" | "RETURN_REFUND";
  itemSummary: string;
  variationName: string | null;
  quantity: number;
  itemImageUrl: string | null;
  courierReturnedToSellerAt: string | null;
  physicallyReceivedAt: string | null;
  physicalCondition: string | null;
  isMissingDiscrepancy: boolean;
  isOverdueRts: boolean;
  expectsPhysicalReturn: boolean;
  digitalStatus: string;
  disputeStatus?: string;
  disputeDeadlineAt?: string | null;
  isUrgentDeadline?: boolean;
  resolvedAt?: string | null;
}

/** Scrolling filter chips with one highlight that slides to the selected chip. */
function FilterChips({
  value,
  count,
  onChange,
}: {
  value: ReturnFilter;
  /** Rows in the selected filter; shown on its chip once known. */
  count: number | null;
  onChange: (f: ReturnFilter) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current[value];
    if (!el) return;
    setBox({ x: el.offsetLeft, w: el.offsetWidth });
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value, count]);

  return (
    <ScrollChips role="tablist" label="Filters" className="-mx-5 lg:mr-0" rowClassName="gap-2 px-5 py-0.5 lg:pr-0">
      {box && (
        <span
          aria-hidden="true"
          data-motion="slide"
          className={`absolute top-0.5 left-0 h-10 rounded-full transition-[transform,width,background-color] duration-200 ease-[var(--ease-ios)] ${
            value === "missing"
              ? "bg-missing-solid"
              : value === "returned"
                ? "bg-brand-solid"
                : value === "arrived"
                  ? "bg-arrived-solid"
                  : "bg-ink"
          }`}
          style={{ width: box.w, transform: `translateX(${box.x}px)` }}
        />
      )}
      {RETURN_FILTERS.map((f) => {
        const active = f.id === value;
        const activeText =
          f.id === "returned"
            ? "text-on-brand"
            : f.id === "missing" || f.id === "arrived"
              ? "text-white"
              : "text-ink-inverse";
        return (
          <button
            key={f.id}
            ref={(el) => {
              refs.current[f.id] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(f.id)}
            className={`pressable relative z-10 h-10 shrink-0 rounded-full px-4 text-[15px] font-semibold ${
              active
                ? activeText
                : "text-ink-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] active:bg-ink/[0.05]"
            }`}
          >
            {f.label}
            {active && f.id !== "all" && count !== null && (
              <span className="ml-1.5 tabular-nums opacity-80">{count}</span>
            )}
          </button>
        );
      })}
    </ScrollChips>
  );
}

function customDateSummary(df: ReturnDateFilter): string | null {
  if (df.date) return manilaDayLabel(df.date);
  if (df.from && df.to) {
    return df.from === df.to
      ? manilaDayLabel(df.from)
      : `${manilaDayLabel(df.from)} – ${manilaDayLabel(df.to)}`;
  }
  if (df.from) return `From ${manilaDayLabel(df.from)}`;
  if (df.to) return `Until ${manilaDayLabel(df.to)}`;
  return null;
}

function ReturnsExplorerInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [filter, setFilter] = useState<ReturnFilter>(() => parseReturnFilter(searchParams.get("filter")));
  const [dateFilter, setDateFilter] = useState<ReturnDateFilter>(() =>
    parseReturnDateFilter(searchParams)
  );
  const [customOpen, setCustomOpen] = useState(() =>
    Boolean(searchParams.get("date") || searchParams.get("from") || searchParams.get("to"))
  );
  const [query, setQuery] = useState("");
  const [parcels, setParcels] = useState<ReturnRow[] | null>(null);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const searchRef = useRef<HTMLInputElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  // Rows stagger in on the first load only; filter changes swap in place.
  const firstLoad = useRef(true);

  useEffect(() => {
    setFilter(parseReturnFilter(searchParams.get("filter")));
    const nextDate = parseReturnDateFilter(searchParams);
    setDateFilter(nextDate);
    if (nextDate.date || nextDate.from || nextDate.to) setCustomOpen(true);
  }, [searchParams]);

  const buildQueryParams = useCallback(
    (offset = 0) => {
      const sp = new URLSearchParams({ filter, limit: "50", offset: String(offset) });
      if (query.trim()) sp.set("q", query.trim());
      if (dateFilter.date) {
        sp.set("date", dateFilter.date);
      } else if (dateFilter.from || dateFilter.to) {
        if (dateFilter.from) sp.set("from", dateFilter.from);
        if (dateFilter.to) sp.set("to", dateFilter.to);
      } else if (dateFilter.range !== "all") {
        sp.set("range", dateFilter.range);
      }
      return sp;
    },
    [filter, query, dateFilter]
  );

  const loadParcels = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      try {
        const sp = buildQueryParams(0);
        const res = await fetch(`/api/returns?${sp.toString()}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const rows: ReturnRow[] = data.parcels ?? [];
          setParcels(rows);
          setTotalCount(typeof data.totalCount === "number" ? data.totalCount : rows.length);
          setLoadError(false);
        } else {
          setLoadError(true);
        }
      } catch {
        setLoadError(true);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [buildQueryParams]
  );

  useLiveRefresh({
    onRefresh: () => loadParcels({ silent: true }),
  });

  async function syncAndReload() {
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) toast("Couldn't reach your stores", "error");
    } catch {
      toast("No connection", "error");
    }
    await loadParcels({ silent: true });
  }

  async function loadMore() {
    if (!parcels || loadingMore) return;
    setLoadingMore(true);
    try {
      const sp = buildQueryParams(parcels.length);
      const res = await fetch(`/api/returns?${sp.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const rows: ReturnRow[] = data.parcels ?? [];
        setParcels((prev) => {
          if (!prev) return rows;
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...rows.filter((r) => !seen.has(r.id))];
        });
        if (typeof data.totalCount === "number") setTotalCount(data.totalCount);
      }
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(loadParcels, 180);
    return () => clearTimeout(t);
  }, [loadParcels]);

  useEffect(() => {
    if (parcels !== null) {
      const t = setTimeout(() => (firstLoad.current = false), 600);
      return () => clearTimeout(t);
    }
  }, [parcels]);

  function selectFilter(next: ReturnFilter) {
    setFilter(next);
    router.replace(returnsUrl(next, dateFilter), { scroll: false });
  }

  function applyDateFilter(next: ReturnDateFilter) {
    setDateFilter(next);
    router.replace(returnsUrl(filter, next), { scroll: false });
  }

  function selectDatePreset(preset: ReturnDatePreset) {
    setCustomOpen(false);
    applyDateFilter({ ...EMPTY_DATE_FILTER, range: preset });
  }

  function updateCustomBound(field: "from" | "to", value: string) {
    const baseFrom = dateFilter.date || dateFilter.from;
    const baseTo = dateFilter.date || dateFilter.to;
    applyDateFilter({
      range: "all",
      date: "",
      from: field === "from" ? value : baseFrom,
      to: field === "to" ? value : baseTo,
    });
  }

  const stagger = firstLoad.current;
  const dateActive = hasActiveDateFilter(dateFilter);
  const customLabel = customDateSummary(dateFilter);
  const isCustomActive = Boolean(customLabel);

  useEffect(() => {
    asideRef.current?.scrollTo({ top: 0 });
  }, [selectedId]);

  useEffect(() => {
    if (!isDesktop) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        Boolean(target?.isContentEditable);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        requestAnimationFrame(() => searchRef.current?.focus());
        return;
      }
      if (typing || !parcels || parcels.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const next = stepSelection(
          parcels.map((p) => p.id),
          selectedId,
          e.key === "ArrowDown" ? 1 : -1
        );
        if (!next) return;
        e.preventDefault();
        setSelectedId(next);
        requestAnimationFrame(() => {
          const escaped = typeof CSS !== "undefined" ? CSS.escape(next) : next;
          const el = document.querySelector<HTMLElement>(`[data-parcel-id="${escaped}"]`);
          el?.focus({ preventScroll: true });
          el?.scrollIntoView({ block: "nearest" });
        });
      } else if (e.key === "Escape" && selectedId) {
        setSelectedId(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDesktop, parcels, selectedId]);

  return (
    <AppShell
      title="Returns"
      width="wide"
      onRefresh={syncAndReload}
      missingCount={
        filter === "missing" && !dateActive && totalCount !== null && !loading
          ? totalCount
          : undefined
      }
      headerRight={
        <button
          type="button"
          aria-label="Filter by date range"
          title="Filter by date range"
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((o) => !o)}
          className={`pressable relative hidden h-11 w-11 items-center justify-center rounded-full hover:bg-ink/[0.05] lg:flex ${
            customOpen || isCustomActive ? "text-brand" : "text-ink-2"
          }`}
        >
          <CalendarDays className="h-[22px] w-[22px]" />
          {isCustomActive && (
            <span
              aria-hidden="true"
              className="anim-pop absolute right-2 top-2 h-2 w-2 rounded-full bg-brand ring-2 ring-ground"
            />
          )}
        </button>
      }
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
        <div className="min-w-0">
          <div className="sticky top-[calc(env(safe-area-inset-top)+48px)] z-20 -mx-5 space-y-2.5 bg-ground px-5 pb-3.5 lg:top-16 lg:mr-0 lg:pr-0">
            <label className="relative block">
              <span className="sr-only">Search returns</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Item, tracking or order"
                enterKeyHint="search"
                className="h-11 w-full rounded-[var(--radius-control)] bg-surface-track/60 pl-10 pr-3 text-[16px] text-ink transition-colors focus:bg-surface focus:shadow-[inset_0_0_0_1.5px_var(--color-brand)] focus:outline-none"
              />
            </label>

            <FilterChips value={filter} count={loading ? null : totalCount} onChange={selectFilter} />

            <ScrollChips label="Dates" className="-mx-5 lg:mr-0" rowClassName="items-center gap-1.5 px-5 pt-0.5 lg:pr-0">
              {RETURN_DATE_PRESETS.map((preset) => {
                const active = !isCustomActive && dateFilter.range === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => selectDatePreset(preset.id)}
                    className={`pressable h-9 shrink-0 rounded-full px-3.5 text-[14px] font-semibold ${
                      active
                        ? "bg-brand/12 text-brand ring-1 ring-inset ring-brand/35"
                        : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] hover:text-ink active:bg-surface-muted"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <button
                type="button"
                aria-pressed={isCustomActive || customOpen}
                onClick={() => setCustomOpen((o) => !o)}
                className={`pressable inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold ${
                  isCustomActive || customOpen
                    ? "bg-brand/12 text-brand ring-1 ring-inset ring-brand/35"
                    : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] hover:text-ink active:bg-surface-muted"
                }`}
              >
                <CalendarDays className="h-3.5 w-3.5" />
                <span>{customLabel ?? "Custom"}</span>
              </button>
            </ScrollChips>

            {customOpen && (
              <div className="anim-disclosure-in flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] bg-surface p-2.5 shadow-[var(--shadow-card)]">
                <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium text-ink-3">
                  <span className="shrink-0">From</span>
                  <input
                    type="date"
                    aria-label="From date"
                    value={dateFilter.date || dateFilter.from}
                    onChange={(e) => updateCustomBound("from", e.target.value)}
                    className="h-11 min-w-0 flex-1 rounded-lg bg-surface-muted px-2.5 text-[16px] text-ink tabular-nums focus:shadow-[0_0_0_1.5px_var(--color-brand)] focus:outline-none"
                  />
                </label>
                <label className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-medium text-ink-3">
                  <span className="shrink-0">To</span>
                  <input
                    type="date"
                    aria-label="To date"
                    value={dateFilter.date || dateFilter.to}
                    onChange={(e) => updateCustomBound("to", e.target.value)}
                    className="h-11 min-w-0 flex-1 rounded-lg bg-surface-muted px-2.5 text-[16px] text-ink tabular-nums focus:shadow-[0_0_0_1.5px_var(--color-brand)] focus:outline-none"
                  />
                </label>
                {dateActive && (
                  <button
                    type="button"
                    onClick={() => selectDatePreset("all")}
                    aria-label="Clear date filter"
                    className="pressable inline-flex h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-semibold text-ink-2 hover:bg-surface-muted hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {parcels !== null && totalCount !== null && (
            <p className="mb-2 px-1 text-[13px] font-medium text-ink-3 tabular-nums">
              {totalCount > parcels.length
                ? `Showing ${parcels.length} of ${totalCount} parcels`
                : `${totalCount} ${totalCount === 1 ? "parcel" : "parcels"}`}
              {customLabel ? ` · ${customLabel}` : ""}
              {dateActive && (filter === "returned" || filter === "missing")
                ? " · by returned-to-seller date"
                : dateActive && filter === "arrived"
                  ? " · by scan date"
                  : ""}
            </p>
          )}

          {parcels === null && loadError ? (
            <div className="space-y-3 py-10 text-center">
              <p className="text-[16px] text-ink-2">Couldn&apos;t load returns.</p>
              <button
                type="button"
                onClick={() => void loadParcels()}
                className="pressable inline-flex h-12 items-center rounded-[var(--radius-control)] bg-surface-muted px-5 text-[16px] font-bold text-ink hover:bg-surface-track"
              >
                Try again
              </button>
            </div>
          ) : parcels === null ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[76px] animate-pulse rounded-[var(--radius-card)] bg-surface-track/60" />
              ))}
            </div>
          ) : parcels.length === 0 ? (
            <p className="anim-fade-in px-1 py-10 text-center text-[16px] text-ink-3">
              {query.trim()
                ? `No results for “${query.trim()}”`
                : dateActive
                  ? "No parcels in this date range"
                  : "No parcels here"}
            </p>
          ) : (
            <div className="space-y-3">
              <Group className={`transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
                <ul>
                  {parcels.map((p, i) => (
                    <li
                      key={p.id}
                      className={`[content-visibility:auto] [contain-intrinsic-size:auto_76px]${stagger && i < 12 ? " anim-rise-in" : ""}`}
                      style={stagger && i < 12 ? { animationDelay: `${i * 30}ms` } : undefined}
                    >
                      <ParcelRow
                        parcel={p}
                        first={i === 0}
                        selected={isDesktop && p.id === selectedId}
                        onOpen={setSelectedId}
                      />
                    </li>
                  ))}
                </ul>
              </Group>
              {totalCount !== null && parcels.length < totalCount && (
                <Button variant="secondary" full onClick={loadMore} disabled={loadingMore}>
                  {loadingMore
                    ? "Loading…"
                    : `Load more (${totalCount - parcels.length} remaining)`}
                </Button>
              )}
            </div>
          )}
        </div>

        <aside
          ref={asideRef}
          aria-label="Parcel details"
          className="hidden overscroll-contain rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] lg:sticky lg:top-20 lg:block lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
        >
          {isDesktop &&
            (selectedId ? (
              <ParcelDetailPanel
                parcelId={selectedId}
                onClose={() => setSelectedId(null)}
                onChanged={() => loadParcels({ silent: true })}
              />
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center gap-2 px-8 py-12 text-center">
                <PackageSearch className="h-10 w-10 text-ink-3" strokeWidth={1.6} />
                <p className="text-[17px] font-bold text-ink">Pick a parcel</p>
                <p className="text-[15px] text-ink-3">
                  Its photo, timeline and dispute message show here.
                </p>
                <p className="mt-2 text-[13px] text-ink-3">
                  Use the ↑ and ↓ keys to go through the list.
                </p>
              </div>
            ))}
        </aside>
      </div>

      <ParcelDetailSheet
        parcelId={isDesktop ? null : selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => loadParcels({ silent: true })}
      />
    </AppShell>
  );
}

export default function ReturnsPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-ground" />}>
      <ReturnsExplorerInner />
    </Suspense>
  );
}
