"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Package, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ParcelDetailSheet } from "@/components/ParcelDetailSheet";

interface ReturnRow {
  id: string;
  platform: "SHOPEE" | "TIKTOK";
  orderSn: string;
  forwardTrackingNumber: string | null;
  rtsTrackingNumber: string | null;
  courier: string;
  category: "FAILED_DELIVERY" | "RETURN_REFUND";
  itemSummary: string;
  variationName: string | null;
  quantity: number;
  itemImageUrl: string | null;
  estimatedUnitCostPhp: number;
  digitalReturnTaggedAt: string | null;
  courierReturnedToSellerAt: string | null;
  physicallyReceivedAt: string | null;
  physicalCondition: string | null;
  isMissingDiscrepancy: boolean;
  isOverdueRts: boolean;
  isUrgentDeadline: boolean;
  scannedByName: string | null;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "missing", label: "Missing" },
  { id: "failed", label: "Failed Delivery" },
  { id: "refund", label: "Buyer Return" },
  { id: "issues", label: "Damaged / Swapped" },
  { id: "overdue", label: "Overdue" },
];

function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function ReturnsExplorerInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialFilter = searchParams.get("filter") || "all";

  const [filter, setFilter] = useState(initialFilter);
  const [query, setQuery] = useState("");
  const [parcels, setParcels] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    const f = searchParams.get("filter") || "all";
    setFilter(f);
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

  function selectFilter(next: string) {
    setFilter(next);
    router.replace(next === "all" ? "/returns" : `/returns?filter=${next}`);
  }

  const missingCount = parcels.filter((p) => p.isMissingDiscrepancy).length;

  return (
    <AppShell missingCount={filter === "missing" ? missingCount : 0}>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900">
            All Returns
          </h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Tap any parcel to see driver times, scan proof photos, or copy a dispute message.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-3.5 h-5 w-5 text-slate-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tracking number, order ID, or item..."
            className="h-12 w-full rounded-xl border border-slate-300 bg-white pl-11 pr-4 text-base text-slate-900 placeholder:text-slate-400 focus:border-[#0f766e] focus:outline-none"
          />
        </div>

        {/* Scrollable Filter Chips */}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => selectFilter(f.id)}
                className={`h-10 shrink-0 rounded-full px-4 text-sm font-bold transition-colors ${
                  active
                    ? f.id === "missing"
                      ? "bg-red-600 text-white"
                      : "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Parcel List */}
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          {loading ? (
            <div className="space-y-2 p-4">
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : parcels.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-bold text-slate-800">No matching parcels</p>
              <p className="mt-1 text-xs text-slate-500">
                Try another filter or clear your search box.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {parcels.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                  >
                    {p.itemImageUrl ? (
                      <img
                        src={p.itemImageUrl}
                        alt={p.itemSummary}
                        className="h-13 w-13 shrink-0 rounded-xl border border-slate-200 object-cover"
                      />
                    ) : (
                      <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                        <Package className="h-5 w-5" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-bold text-slate-900">
                          {p.quantity > 1 ? `${p.quantity}× ` : ""}
                          {p.itemSummary}
                        </p>
                        {p.isMissingDiscrepancy ? (
                          <span className="shrink-0 rounded-md bg-red-100 px-2 py-0.5 text-xs font-extrabold text-red-700">
                            Missing
                          </span>
                        ) : p.physicalCondition === "WRONG_OR_SWAPPED_ITEM" ||
                          p.physicalCondition === "DAMAGED_ITEM" ||
                          p.physicalCondition === "MISSING_PIECE" ? (
                          <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-800">
                            Issue
                          </span>
                        ) : p.physicallyReceivedAt ? (
                          <span className="shrink-0 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-extrabold text-emerald-800">
                            Arrived
                          </span>
                        ) : p.isOverdueRts ? (
                          <span className="shrink-0 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-extrabold text-amber-800">
                            Overdue
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                            On the Way
                          </span>
                        )}
                      </div>

                      {p.variationName && (
                        <p className="text-xs font-semibold text-slate-600">{p.variationName}</p>
                      )}

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
                        <span
                          className={`font-bold ${
                            p.category === "FAILED_DELIVERY"
                              ? "text-amber-800"
                              : "text-blue-700"
                          }`}
                        >
                          {p.category === "FAILED_DELIVERY"
                            ? "Failed Delivery"
                            : "Buyer Return"}
                        </span>
                        <span>•</span>
                        <span>{p.platform === "SHOPEE" ? "Shopee" : "TikTok"}</span>
                        <span>•</span>
                        <span>{p.courier.replace(" Express", "")}</span>
                        <span>•</span>
                        <span className="tabular-nums font-medium text-slate-700">
                          {p.rtsTrackingNumber || p.forwardTrackingNumber || p.orderSn}
                        </span>
                      </div>

                      <p className="mt-1 text-[11px] font-medium text-slate-500">
                        Tagged: {fmtShort(p.digitalReturnTaggedAt)}
                        {p.courierReturnedToSellerAt
                          ? ` • Driver back: ${fmtShort(p.courierReturnedToSellerAt)}`
                          : ""}
                        {p.physicallyReceivedAt
                          ? ` • Scanned: ${fmtShort(p.physicallyReceivedAt)}`
                          : ""}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ParcelDetailSheet parcelId={selectedId} onClose={() => setSelectedId(null)} />
    </AppShell>
  );
}

export default function ReturnsPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-[#f4f7f8]" />}>
      <ReturnsExplorerInner />
    </Suspense>
  );
}
