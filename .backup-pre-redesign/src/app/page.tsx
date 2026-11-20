"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Package,
  RefreshCw,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ParcelDetailSheet } from "@/components/ParcelDetailSheet";
import type { CategoryDailyTruth, DailyTruthReport } from "@/lib/analytics/daily-returns";

function formatShortTime(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function ReturnCategoryCard({
  title,
  badgeText,
  badgeClass,
  stage1Label,
  stats,
  extraFooter,
  href,
}: {
  title: string;
  badgeText: string;
  badgeClass: string;
  stage1Label: string;
  stats: CategoryDailyTruth;
  extraFooter?: React.ReactNode;
  href: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-base font-extrabold text-slate-900">{title}</h2>
          <span
            className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeClass}`}
          >
            {badgeText}
          </span>
        </div>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-0.5 text-xs font-bold text-[#0f766e] hover:underline"
        >
          List
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* 3 Connected Daily Truth Stages */}
      <div className="grid grid-cols-3 divide-x divide-slate-100">
        <div className="px-3 py-4 text-center">
          <p className="tabular-nums text-3xl font-extrabold tracking-tight text-slate-900">
            {stats.taggedCount}
          </p>
          <p className="mt-1 text-xs font-semibold leading-snug text-slate-600">
            {stage1Label}
          </p>
        </div>

        <div className="px-3 py-4 text-center">
          <p className="tabular-nums text-3xl font-extrabold tracking-tight text-slate-900">
            {stats.courierReturnedCount}
          </p>
          <p className="mt-1 text-xs font-semibold leading-snug text-slate-600">
            Driver Says Back
          </p>
        </div>

        <div className="bg-emerald-50/60 px-3 py-4 text-center">
          <p className="tabular-nums text-3xl font-extrabold tracking-tight text-emerald-700">
            {stats.physicallyArrivedCount}
          </p>
          <p className="mt-1 text-xs font-bold leading-snug text-emerald-800">
            Arrived Today
          </p>
        </div>
      </div>

      {/* Footer breakdown */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 text-xs font-semibold text-slate-600">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {stats.byCourier.length > 0 ? (
            stats.byCourier.map((c) => (
              <span key={c.courier} className="tabular-nums">
                {c.courier.replace(" Express", "")}: <strong className="text-slate-800">{c.tagged}</strong>
                {c.missing > 0 && (
                  <span className="ml-1 text-red-700">({c.missing} missing)</span>
                )}
              </span>
            ))
          ) : (
            <span>No parcels in this range</span>
          )}
        </div>
        <div className="tabular-nums flex items-center gap-3">
          {extraFooter}
          <span className="text-slate-700">
            Est. Cost:{" "}
            <strong className="text-slate-900">
              ₱{stats.taggedEstCostPhp.toLocaleString("en-PH")}
            </strong>
          </span>
        </div>
      </div>
    </section>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState<"today" | "yesterday" | "7days">("today");
  const [customDate, setCustomDate] = useState("");
  const [report, setReport] = useState<DailyTruthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState("");
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ range });
      if (customDate) params.set("date", customDate);
      const res = await fetch(`/api/dashboard?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReport(data);
      }
    } finally {
      setLoading(false);
    }
  }, [range, customDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function handleSync() {
    setSyncing(true);
    setSyncNotice("");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setSyncNotice(
          data.totalSynced > 0
            ? `Synced ${data.totalSynced} updates from your stores.`
            : "Store status checked just now."
        );
        await loadReport();
      }
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncNotice(""), 3500);
    }
  }

  const missingCount = report?.combined.missingNowCount ?? 0;
  const isDemoOnly =
    report && report.shops.length > 0 && report.shops.every((s) => s.isDemo);

  return (
    <AppShell
      missingCount={missingCount}
      headerRight={
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#0f766e] px-3.5 text-sm font-bold text-white transition-colors hover:bg-[#115e59] disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
          <span>{syncing ? "Syncing" : "Sync"}</span>
        </button>
      }
    >
      <div className="space-y-4">
        {/* Manila Date Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: "today", label: "Today" },
                { id: "yesterday", label: "Yesterday" },
                { id: "7days", label: "7 Days" },
              ] as const
            ).map((tab) => {
              const active = !customDate && range === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setCustomDate("");
                    setRange(tab.id);
                  }}
                  className={`h-11 rounded-full px-4 text-sm font-bold transition-colors ${
                    active
                      ? "bg-slate-900 text-white"
                      : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <input
            type="date"
            aria-label="Pick a Manila date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
          />
        </div>

        {syncNotice && (
          <div className="rounded-xl border border-teal-200 bg-teal-50 px-3.5 py-2.5 text-sm font-semibold text-teal-900">
            {syncNotice}
          </div>
        )}

        {isDemoOnly && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-600">
            <span>
              Showing <strong className="text-slate-900">sample store data</strong> while Shopee
              &amp; TikTok API review finishes.
            </span>
            <Link
              href="/imports"
              className="inline-flex items-center gap-1 font-bold text-[#0f766e] hover:underline"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Real File
            </Link>
          </div>
        )}

        {loading || !report ? (
          <div className="space-y-4">
            <div className="h-20 animate-pulse rounded-2xl bg-slate-200/70" />
            <div className="h-44 animate-pulse rounded-2xl bg-slate-200/70" />
            <div className="h-44 animate-pulse rounded-2xl bg-slate-200/70" />
          </div>
        ) : (
          <>
            {/* Top Triage Alert Banner */}
            {report.combined.missingNowCount > 0 ? (
              <Link
                href="/returns?filter=missing"
                className="flex items-center justify-between gap-3 rounded-2xl bg-red-600 px-4 py-4 text-white shadow-sm transition-colors hover:bg-red-700"
              >
                <div className="flex items-center gap-3.5">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15">
                    <span className="tabular-nums text-2xl font-extrabold leading-none">
                      {report.combined.missingNowCount}
                    </span>
                  </div>
                  <div>
                    <h1 className="text-base font-extrabold leading-tight">
                      Missing Parcels
                    </h1>
                    <p className="mt-0.5 text-xs font-medium text-red-100">
                      Driver marked returned, not scanned at warehouse yet (est. ₱
                      {report.combined.missingNowCostPhp.toLocaleString("en-PH")})
                    </p>
                  </div>
                </div>
                <span className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl bg-white px-3.5 text-xs font-extrabold text-red-700">
                  Check
                  <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-emerald-950">
                <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                <div>
                  <h1 className="text-base font-extrabold">All Clear — 0 Missing</h1>
                  <p className="text-xs font-medium text-emerald-800">
                    Every parcel drivers marked returned has been scanned at your warehouse.
                  </p>
                </div>
              </div>
            )}

            {/* Quick Manila Date Heading + Secondary Alerts */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs font-semibold text-slate-600">
              <span>{report.rangeLabel} (Manila Time)</span>
              <div className="flex items-center gap-3">
                {report.combined.overdueRtsCount > 0 && (
                  <Link
                    href="/returns?filter=overdue"
                    className="inline-flex items-center gap-1 font-bold text-amber-800 hover:underline"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    {report.combined.overdueRtsCount} Overdue (&gt;{report.overdueRtsDays}d)
                  </Link>
                )}
                {report.combined.urgentDeadlineCount > 0 && (
                  <Link
                    href="/returns?filter=refund"
                    className="inline-flex items-center gap-1 font-bold text-red-700 hover:underline"
                  >
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {report.combined.urgentDeadlineCount} Dispute &lt;24h
                  </Link>
                )}
              </div>
            </div>

            {/* Strictly Separated Failed Delivery vs Buyer Return Cards */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ReturnCategoryCard
                title="Failed Delivery"
                badgeText="COD / RTS"
                badgeClass="bg-amber-100 text-amber-800"
                stage1Label="Driver Tagged"
                stats={report.failedDelivery}
                href="/returns?filter=failed"
              />

              <ReturnCategoryCard
                title="Buyer Return / Refund"
                badgeText="Buyer Claim"
                badgeClass="bg-blue-100 text-blue-800"
                stage1Label="Buyer Requested"
                stats={report.returnRefund}
                href="/returns?filter=refund"
                extraFooter={
                  <span>
                    Shopee {report.returnRefund.shopeeTaggedCount} • TikTok{" "}
                    {report.returnRefund.tiktokTaggedCount}
                  </span>
                }
              />
            </div>

            {/* Needs Attention Photo List */}
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
                <h2 className="text-base font-extrabold text-slate-900">
                  Parcels to Check
                </h2>
                <Link
                  href="/returns"
                  className="inline-flex items-center gap-1 text-xs font-bold text-[#0f766e] hover:underline"
                >
                  See All
                  <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              {report.attentionParcels.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-slate-700">
                    No return activity for {report.rangeLabel}.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Tap Sync or upload a Shopee / TikTok export file to check new returns.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {report.attentionParcels.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedParcelId(p.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                      >
                        {p.itemImageUrl ? (
                          <img
                            src={p.itemImageUrl}
                            alt={p.itemSummary}
                            className="h-12 w-12 shrink-0 rounded-xl border border-slate-200 object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                            <Package className="h-5 w-5" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-slate-900">
                            {p.quantity > 1 ? `${p.quantity}× ` : ""}
                            {p.itemSummary}
                            {p.variationName ? ` • ${p.variationName}` : ""}
                          </p>
                          <p className="mt-0.5 truncate text-xs font-medium text-slate-500">
                            {p.courier.replace(" Express", "")} •{" "}
                            {p.category === "FAILED_DELIVERY"
                              ? "Failed Delivery"
                              : "Buyer Return"}
                            {p.physicallyReceivedAt
                              ? ` • Scanned ${formatShortTime(p.physicallyReceivedAt)}${
                                  p.scannedByName ? ` (${p.scannedByName})` : ""
                                }`
                              : p.courierReturnedToSellerAt
                              ? ` • Driver marked back ${formatShortTime(
                                  p.courierReturnedToSellerAt
                                )}`
                              : ` • Tagged ${formatShortTime(p.digitalReturnTaggedAt)}`}
                          </p>
                        </div>

                        <div className="shrink-0">
                          {p.isMissingDiscrepancy ? (
                            <span className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-extrabold text-red-700">
                              Missing
                            </span>
                          ) : p.physicalCondition === "WRONG_OR_SWAPPED_ITEM" ||
                            p.physicalCondition === "DAMAGED_ITEM" ||
                            p.physicalCondition === "MISSING_PIECE" ? (
                            <span className="rounded-lg bg-amber-100 px-2.5 py-1 text-xs font-extrabold text-amber-800">
                              Issue
                            </span>
                          ) : p.physicallyReceivedAt ? (
                            <span className="rounded-lg bg-emerald-100 px-2.5 py-1 text-xs font-extrabold text-emerald-800">
                              Arrived
                            </span>
                          ) : (
                            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                              On the Way
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Top Returned Clothes (Zero-SKU Photo View) */}
            {report.topItems.length > 0 && (
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <div className="border-b border-slate-100 px-4 py-3.5">
                  <h2 className="text-base font-extrabold text-slate-900">
                    Most Returned Clothes
                  </h2>
                </div>
                <ul className="divide-y divide-slate-100">
                  {report.topItems.map((item) => (
                    <li
                      key={`${item.itemSummary}-${item.variationName}`}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      {item.itemImageUrl ? (
                        <img
                          src={item.itemImageUrl}
                          alt={item.itemSummary}
                          className="h-11 w-11 shrink-0 rounded-lg border border-slate-200 object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                          <Package className="h-5 w-5" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-slate-900">
                          {item.itemSummary}
                        </p>
                        {item.variationName && (
                          <p className="text-xs font-medium text-slate-500">
                            {item.variationName}
                          </p>
                        )}
                      </div>
                      <div className="tabular-nums text-right text-xs font-bold">
                        <p className="text-sm font-extrabold text-slate-900">
                          {item.totalCount} total
                        </p>
                        <p className="text-slate-500">
                          {item.failedCount} failed • {item.returnCount} return
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <ParcelDetailSheet
        parcelId={selectedParcelId}
        onClose={() => setSelectedParcelId(null)}
      />
    </AppShell>
  );
}
