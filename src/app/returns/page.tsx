"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ParcelDetailSheet } from "@/components/ParcelDetailSheet";
import { ParcelRow } from "@/components/ParcelRow";
import { Group } from "@/components/ui/Button";
import {
  RETURN_FILTERS,
  parseReturnFilter,
  returnsUrl,
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
  physicallyReceivedAt: string | null;
  physicalCondition: string | null;
  isMissingDiscrepancy: boolean;
  isOverdueRts: boolean;
  expectsPhysicalReturn: boolean;
  digitalStatus: string;
}

/** Scrolling filter chips with one highlight that slides to the selected chip. */
function FilterChips({
  value,
  onChange,
}: {
  value: ReturnFilter;
  onChange: (f: ReturnFilter) => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const el = refs.current[value];
    if (!el) return;
    setBox({ x: el.offsetLeft, w: el.offsetWidth });
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [value]);

  return (
    <div
      role="tablist"
      aria-label="Filter returns"
      className="no-scrollbar relative -mx-5 flex gap-2 overflow-x-auto px-5 py-0.5"
    >
      {box && (
        <span
          aria-hidden="true"
          data-motion="slide"
          className={`absolute top-0.5 left-0 h-10 rounded-full transition-[transform,width,background-color] duration-200 ease-[var(--ease-ios)] ${
            value === "missing" ? "bg-missing" : "bg-ink"
          }`}
          style={{ width: box.w, transform: `translateX(${box.x}px)` }}
        />
      )}
      {RETURN_FILTERS.map((f) => {
        const active = f.id === value;
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
            className={`relative z-10 h-10 shrink-0 rounded-full px-4 text-[15px] font-semibold transition-colors duration-200 ${
              active
                ? "text-white"
                : "text-ink-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] active:bg-black/[0.04]"
            }`}
          >
            {f.label}
          </button>
        );
      })}
    </div>
  );
}

function ReturnsExplorerInner() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [filter, setFilter] = useState<ReturnFilter>(() => parseReturnFilter(searchParams.get("filter")));
  const [query, setQuery] = useState("");
  const [parcels, setParcels] = useState<ReturnRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Rows stagger in on the first load only; filter changes swap in place.
  const firstLoad = useRef(true);

  useEffect(() => {
    setFilter(parseReturnFilter(searchParams.get("filter")));
  }, [searchParams]);

  const loadParcels = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ filter });
      if (query.trim()) sp.set("q", query.trim());
      const res = await fetch(`/api/returns?${sp.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setParcels(data.parcels ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [filter, query]);

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
    router.replace(returnsUrl(next), { scroll: false });
  }

  const stagger = firstLoad.current;

  return (
    <AppShell
      title="Returns"
      missingCount={filter === "missing" && parcels && !loading ? parcels.length : undefined}
    >
      <div className="sticky top-[calc(env(safe-area-inset-top)+48px)] z-20 -mx-5 space-y-3 bg-ground px-5 pb-4 md:top-16">
        <label className="relative block">
          <span className="sr-only">Search returns</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Item, tracking or order"
            enterKeyHint="search"
            className="h-11 w-full rounded-[var(--radius-control)] bg-slate-200/60 pl-10 pr-3 text-[16px] text-ink transition-colors focus:bg-white focus:shadow-[inset_0_0_0_1.5px_var(--color-brand)] focus:outline-none"
          />
        </label>
        <FilterChips value={filter} onChange={selectFilter} />
      </div>

      {parcels === null ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-[var(--radius-card)] bg-slate-200/60" />
          ))}
        </div>
      ) : parcels.length === 0 ? (
        <p className="anim-fade-in px-1 py-10 text-center text-[16px] text-ink-3">
          {query.trim() ? `No results for “${query.trim()}”` : "No parcels here"}
        </p>
      ) : (
        <Group className={`transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
          <ul>
            {parcels.map((p, i) => (
              <li
                key={p.id}
                className={stagger && i < 12 ? "anim-rise-in" : undefined}
                style={stagger && i < 12 ? { animationDelay: `${i * 30}ms` } : undefined}
              >
                <ParcelRow parcel={p} first={i === 0} onOpen={setSelectedId} />
              </li>
            ))}
          </ul>
        </Group>
      )}

      <ParcelDetailSheet parcelId={selectedId} onClose={() => setSelectedId(null)} />
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
