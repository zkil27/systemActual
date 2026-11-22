"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarDays, Check, CheckCircle2, ChevronRight, RefreshCw } from "lucide-react";
import { AppShell, BarButton } from "@/components/AppShell";
import { CATEGORY_META, CategorySheet, type CategoryKey } from "@/components/CategorySheet";
import { ParcelDetailSheet } from "@/components/ParcelDetailSheet";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Group, SectionHeader } from "@/components/ui/Button";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { ParcelRow } from "@/components/ParcelRow";
import { toast } from "@/components/ui/Toast";
import type { CategoryDailyTruth, DailyTruthReport } from "@/lib/analytics/daily-returns";
import { formatPeso, formatSignedPeso, manilaDayLabel, manilaTime } from "@/lib/ui/format";
import type { MoneySummary } from "@/lib/money/summary";
import { haptic } from "@/lib/ui/motion";
import { returnsUrl } from "@/lib/ui/returns-filter";
import { useLiveRefresh } from "@/lib/ui/use-live-refresh";

type Range = "today" | "yesterday" | "7days";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7days", label: "7 Days" },
] as const;

const RANGE_TITLES: Record<Range, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7days": "Last 7 days",
};

/** Three numbers, one word each. Everything else is in the sheet. */
function CategoryCard({
  kind,
  stats,
  onOpen,
}: {
  kind: CategoryKey;
  stats: CategoryDailyTruth;
  onOpen: () => void;
}) {
  const meta = CATEGORY_META[kind];
  const stages = [
    { label: meta.firstStage, value: stats.taggedCount, className: "text-ink" },
    { label: "Returned to seller", value: stats.courierReturnedCount, className: "text-ink" },
    { label: "Arrived", value: stats.physicallyArrivedCount, className: "text-arrived" },
  ];
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${meta.title}: ${stages.map((s) => `${s.value} ${s.label}`).join(", ")}. Show details`}
      className="pressable block w-full rounded-[var(--radius-card)] bg-white p-5 text-left shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-float)]"
    >
      <span className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[17px] font-bold text-ink">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
          {meta.title}
        </span>
        <ChevronRight className="h-5 w-5 text-ink-3" />
      </span>
      <span className="mt-5 grid grid-cols-3 gap-2">
        {stages.map((s) => (
          <span key={s.label} className="block">
            <AnimatedNumber
              value={s.value}
              className={`block text-[34px] font-extrabold leading-none tracking-[-0.02em] ${s.className}`}
            />
            <span className="mt-2 block text-[13px] font-medium leading-tight text-ink-3">{s.label}</span>
          </span>
        ))}
      </span>
    </button>
  );
}

/**
 * The owner's main number: money actually credited (Shopee wallet / TikTok
 * statement paid). Orders placed sit underneath, muted, because they aren't money yet.
 */
function MoneyCard({ money }: { money: MoneySummary }) {
  const extras = [
    money.adsPhp ? `Ads ${formatSignedPeso(money.adsPhp)}` : null,
    money.adjustmentsPhp ? `Adjustments ${formatSignedPeso(money.adjustmentsPhp)}` : null,
  ].filter(Boolean);
  return (
    <section
      aria-label={`Money credited ${formatPeso(money.creditedPhp)}`}
      className="rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] lg:h-full"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[17px] font-bold text-ink">Money credited</span>
        {money.updatedAt && (
          <span className="text-[13px] text-ink-3">as of {manilaTime(money.updatedAt)}</span>
        )}
      </span>
      <span className="mt-3 block text-[40px] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">
        {formatPeso(money.creditedPhp)}
      </span>
      <span className="mt-2 block text-[15px] text-ink-2 tabular-nums">
        Shopee {formatPeso(money.creditedShopeePhp)} · TikTok {formatPeso(money.creditedTikTokPhp)}
      </span>
      {extras.length > 0 && (
        <span className="mt-1 block text-[15px] text-ink-3 tabular-nums">{extras.join(" · ")}</span>
      )}
      <span className="mt-4 block border-t border-hairline pt-3 text-[14px] text-ink-3 tabular-nums">
        {money.ordersPlacedCount} orders placed · {formatPeso(money.ordersPlacedPhp)}, not money yet
      </span>
    </section>
  );
}

function ReturnTruthCards({
  report,
  range,
  customDate,
}: {
  report: DailyTruthReport;
  range: Range;
  customDate: string;
}) {
  const dateFilter = customDate ? { date: customDate } : { range };
  const returnedHref = returnsUrl("returned", dateFilter);
  const arrivedHref = returnsUrl("arrived", dateFilter);

  return (
    <div className="grid grid-cols-2 gap-3">
      <Link
        href={returnedHref}
        className="pressable block rounded-[var(--radius-card)] bg-white p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-float)] sm:p-5"
      >
        <span className="flex items-center justify-between gap-1.5">
          <span className="truncate text-[15px] font-bold text-ink sm:text-[17px]">Returned to seller</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 sm:h-5 sm:w-5" />
        </span>
        <span className="mt-3 block">
          <AnimatedNumber
            value={report.combined.courierReturnedCount}
            className="text-[32px] font-extrabold leading-none tracking-[-0.02em] text-ink sm:text-[36px]"
          />
        </span>
        <span className="mt-2 block truncate text-[13px] text-ink-3 tabular-nums sm:text-[14px]">
          Failed {report.failedDelivery.courierReturnedCount} · Buyer {report.returnRefund.courierReturnedCount}
        </span>
      </Link>

      <Link
        href={arrivedHref}
        className="pressable block rounded-[var(--radius-card)] bg-white p-4 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-float)] sm:p-5"
      >
        <span className="flex items-center justify-between gap-1.5">
          <span className="truncate text-[15px] font-bold text-ink sm:text-[17px]">Arrived</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-3 sm:h-5 sm:w-5" />
        </span>
        <span className="mt-3 block">
          <AnimatedNumber
            value={report.combined.physicallyArrivedCount}
            className="text-[32px] font-extrabold leading-none tracking-[-0.02em] text-arrived sm:text-[36px]"
          />
        </span>
        <span className="mt-2 block truncate text-[13px] text-ink-3 sm:text-[14px]">
          Scanned by staff
        </span>
      </Link>
    </div>
  );
}

function MissingStatus({
  report,
  range,
  customDate,
}: {
  report: DailyTruthReport;
  range: Range;
  customDate: string;
}) {
  const missing = report.combined.missingNowCount;
  const { overdueRtsCount, urgentDeadlineCount } = report.combined;

  return (
    <div className="flex flex-col gap-3 lg:h-full">
      {missing > 0 ? (
        <Link
          key="missing"
          href="/returns?filter=missing"
          className="anim-fade-in pressable flex items-center gap-4 rounded-[var(--radius-card)] bg-missing px-5 py-4 text-white shadow-[0_8px_24px_-10px_rgb(220_38_38/0.6)] lg:flex-1 lg:px-6"
        >
          <AnimatedNumber
            value={missing}
            className="text-[44px] font-extrabold leading-none tracking-[-0.03em] lg:text-[56px]"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-bold leading-tight">Missing</span>
            <span className="block text-[15px] font-medium text-white">Returned to seller, not scanned</span>
          </span>
          <ChevronRight className="h-6 w-6 text-white/80" />
        </Link>
      ) : (
        <div
          key="clear"
          className="anim-fade-in flex items-center gap-2.5 px-1 py-1 lg:rounded-[var(--radius-card)] lg:bg-white lg:px-6 lg:py-4 lg:shadow-[var(--shadow-card)]"
        >
          <CheckCircle2 className="h-6 w-6 text-arrived" />
          <span className="text-[17px] font-bold text-ink">All clear</span>
          <span className="text-[16px] text-ink-3">Nothing missing</span>
        </div>
      )}

      <ReturnTruthCards report={report} range={range} customDate={customDate} />

      {(overdueRtsCount > 0 || urgentDeadlineCount > 0) && (
        <div className="flex flex-wrap gap-2">
          {overdueRtsCount > 0 && (
            <Link
              href="/returns?filter=overdue"
              className="pressable inline-flex h-10 items-center gap-1.5 rounded-full bg-failed-soft px-3.5 text-[14px] font-bold text-amber-900"
            >
              <span className="tabular-nums">{overdueRtsCount}</span> overdue
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
          {urgentDeadlineCount > 0 && (
            <Link
              href="/returns?filter=refund"
              className="pressable inline-flex h-10 items-center gap-1.5 rounded-full bg-missing-soft px-3.5 text-[14px] font-bold text-missing-ink"
            >
              <span className="tabular-nums">{urgentDeadlineCount}</span> dispute
              {urgentDeadlineCount > 1 ? "s" : ""} due today
              <ChevronRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function OperationsStrip({ ops }: { ops: DailyTruthReport["operations"] }) {
  const stockHeadline =
    ops.outOfStockCount > 0
      ? `${ops.outOfStockCount} out`
      : ops.lowStockCount > 0
        ? `${ops.lowStockCount} low`
        : "All stocked";

  const stockSub = [
    ops.outOfStockCount > 0 && ops.lowStockCount > 0 ? `${ops.lowStockCount} low` : null,
    ops.unlinkedCount > 0 ? `${ops.unlinkedCount} unlinked` : null,
    ops.stockPushFailedCount > 0 ? `${ops.stockPushFailedCount} not updated` : null,
    ops.shopeeBumpEnabled ? `Auto-bump ${ops.shopeeBoostedCount}/5` : "Auto-bump off",
  ]
    .filter(Boolean)
    .join(" · ");

  const shipSub = [
    `Shopee ${ops.readyShopeeCount} · TikTok ${ops.readyTikTokCount}`,
    ops.coolingOffCount > 0 ? `${ops.coolingOffCount} <1h` : null,
    `${ops.printedTodayCount} printed`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-12 lg:gap-6">
      <Link
        href="/waves"
        className="pressable block rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-float)]"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="text-[17px] font-bold text-ink">Ship orders</span>
          <span className="flex items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-[12px] font-bold ${
                ops.printerOnline ? "bg-arrived-soft text-arrived" : "bg-slate-100 text-ink-3"
              }`}
            >
              {ops.printerOnline ? "Printer on" : "Printer off"}
            </span>
            <ChevronRight className="h-5 w-5 text-ink-3" />
          </span>
        </span>
        <span className="mt-3 flex items-baseline gap-2.5">
          <AnimatedNumber
            value={ops.readyToShipCount}
            className="text-[34px] font-extrabold leading-none tracking-[-0.02em] text-ink"
          />
          <span className="text-[15px] font-medium text-ink-3">ready to ship</span>
        </span>
        <span className="mt-2 block text-[14px] text-ink-3 tabular-nums">{shipSub}</span>
        {(ops.waveNeedAttentionCount > 0 || ops.runningWaveCount > 0 || ops.wavesAutoEnabled) && (
          <span className="mt-2.5 flex flex-wrap gap-2 text-[13px] font-semibold">
            {ops.runningWaveCount > 0 && <span className="text-brand">Shipping wave now</span>}
            {ops.waveNeedAttentionCount > 0 && (
              <span className="text-missing-ink">{ops.waveNeedAttentionCount} need attention</span>
            )}
            {ops.wavesAutoEnabled && (
              <span className="text-arrived">
                {ops.continuousAutoShip ? "Auto-ship every 15m" : "Auto wave times on"}
              </span>
            )}
          </span>
        )}
      </Link>

      <Link
        href="/items"
        className="pressable block rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-float)]"
      >
        <span className="flex items-center justify-between gap-3">
          <span className="text-[17px] font-bold text-ink">Stock &amp; Shopee bump</span>
          <ChevronRight className="h-5 w-5 text-ink-3" />
        </span>
        <span className="mt-3 flex items-baseline justify-between gap-3">
          <span
            className={`text-[28px] font-extrabold leading-none tracking-[-0.02em] tabular-nums ${
              ops.outOfStockCount > 0 ? "text-missing-ink" : ops.lowStockCount > 0 ? "text-amber-800" : "text-arrived"
            }`}
          >
            {stockHeadline}
          </span>
          <span
            className={`rounded-full px-2.5 py-1 text-[13px] font-bold tabular-nums ${
              ops.shopeeBumpEnabled ? "bg-brand-soft text-brand" : "bg-slate-100 text-ink-3"
            }`}
          >
            Bump {ops.shopeeBoostedCount}/5
          </span>
        </span>
        <span className="mt-2.5 block text-[14px] text-ink-3 tabular-nums">{stockSub}</span>
      </Link>
    </div>
  );
}

function TopItemRow({
  item,
  compact = false,
}: {
  item: DailyTruthReport["topItems"][number];
  compact?: boolean;
}) {
  const detail = [item.variationName, `${item.failedCount} failed · ${item.returnCount} returned`]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={`flex items-center gap-3.5 ${compact ? "px-4 py-3" : "py-3"}`}>
      <ItemThumb src={item.itemImageUrl} alt={item.itemSummary} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-semibold text-ink ${compact ? "text-[15px]" : "text-[16px]"}`}>
          {item.itemSummary}
        </span>
        <span className={`block truncate text-ink-3 ${compact ? "text-[14px]" : "text-[15px]"}`}>
          {detail}
        </span>
      </span>
      <span className={`tabular-nums font-extrabold text-ink ${compact ? "text-[20px]" : "text-[22px]"}`}>
        {item.totalCount}
      </span>
    </li>
  );
}

function HomeSkeleton() {
  return (
    <div className="space-y-4 lg:grid lg:grid-cols-12 lg:gap-6 lg:space-y-0" aria-busy="true" aria-label="Loading">
      <div className="h-[76px] animate-pulse rounded-[var(--radius-card)] bg-slate-200/60 lg:col-span-5 lg:h-[148px]" />
      <div className="h-[148px] animate-pulse rounded-[var(--radius-card)] bg-slate-200/60 lg:col-span-7" />
      <div className="h-[148px] animate-pulse rounded-[var(--radius-card)] bg-slate-200/60 lg:col-span-6" />
      <div className="hidden h-[148px] animate-pulse rounded-[var(--radius-card)] bg-slate-200/60 lg:col-span-6 lg:block" />
    </div>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState<Range>("today");
  const [customDate, setCustomDate] = useState("");
  const [report, setReport] = useState<DailyTruthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done">("idle");
  const [bgSyncHint, setBgSyncHint] = useState(false);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [openCategory, setOpenCategory] = useState<CategoryKey | null>(null);
  const [topOpen, setTopOpen] = useState(false);
  const cacheRef = useRef<Map<string, { report: DailyTruthReport; fetchedAt: number }>>(new Map());

  const loadReport = useCallback(
    async (opts?: { force?: boolean; silent?: boolean }) => {
      const cacheKey = `${range}:${customDate}`;
      const cached = cacheRef.current.get(cacheKey);
      if (!opts?.force && cached) {
        setReport(cached.report);
        setLoading(false);
        if (Date.now() - cached.fetchedAt < 15_000) return;
      }
      try {
        const params = new URLSearchParams({ range });
        if (customDate) params.set("date", customDate);
        const res = await fetch(`/api/dashboard?${params.toString()}`, { cache: "no-store" });
        if (res.ok) {
          const data: DailyTruthReport & { syncing?: boolean } = await res.json();
          cacheRef.current.set(cacheKey, { report: data, fetchedAt: Date.now() });
          setReport(data);
          setBgSyncHint(Boolean(data.syncing));
        }
      } catch {
        if (!opts?.silent) toast("No connection", "error");
      } finally {
        setLoading(false);
      }
    },
    [range, customDate]
  );

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const { isSyncing: liveSyncing } = useLiveRefresh({
    activeHint: bgSyncHint,
    onRefresh: async () => {
      cacheRef.current.clear();
      await loadReport({ force: true, silent: true });
    },
  });

  async function handleSync() {
    if (syncState === "syncing") return;
    setSyncState("syncing");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSyncState("idle");
        toast("Couldn't reach your stores", "error");
        return;
      }
      cacheRef.current.clear();
      await loadReport({ force: true });
      haptic(8);
      setSyncState("done");
      toast(data.totalSynced > 0 ? `${data.totalSynced} updates` : "Up to date");
      setTimeout(() => setSyncState("idle"), 1400);
    } catch {
      setSyncState("idle");
      toast("No connection", "error");
    }
  }

  const title = customDate ? manilaDayLabel(customDate) : RANGE_TITLES[range];
  const isDemoOnly = Boolean(report && report.shops.length > 0 && report.shops.every((s) => s.isDemo));
  const toCheck = report?.attentionParcels.slice(0, 8) ?? [];

  return (
    <AppShell
      title={title}
      width="wide"
      missingCount={report?.combined.missingNowCount}
      titleAccessory={
        isDemoOnly ? (
          <Link
            href="/imports"
            className="rounded-full bg-slate-200/70 px-2.5 py-1 text-[13px] font-bold text-ink-2 hover:bg-slate-200"
          >
            Sample data
          </Link>
        ) : undefined
      }
      headerRight={
        <>
          <label
            title="Pick a date"
            className="pressable relative flex h-11 w-11 cursor-pointer items-center justify-center rounded-full text-brand hover:bg-black/[0.04]"
          >
            <CalendarDays className="h-[22px] w-[22px]" />
            <input
              type="date"
              aria-label="Pick a date"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <BarButton label="Sync stores" onClick={handleSync} disabled={syncState === "syncing"}>
            {syncState === "done" ? (
              <Check key="done" className="anim-pop h-[22px] w-[22px] text-arrived" strokeWidth={2.8} />
            ) : (
              <RefreshCw
                key="sync"
                className={`h-[22px] w-[22px] ${syncState === "syncing" || liveSyncing ? "anim-spin" : ""}`}
              />
            )}
          </BarButton>
        </>
      }
    >
      <div className="space-y-8">
        <SegmentedControl
          label="Date range"
          options={RANGES}
          value={customDate ? null : range}
          onChange={(id) => {
            setCustomDate("");
            setRange(id);
          }}
          className="lg:max-w-md"
        />

        {loading || !report ? (
          <HomeSkeleton />
        ) : (
          <div className="anim-fade-in grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-6">
            <div className="lg:col-span-5">
              <MoneyCard money={report.money} />
            </div>

            <div className="lg:col-span-7">
              <MissingStatus report={report} range={range} customDate={customDate} />
            </div>

            {report.operations && <OperationsStrip ops={report.operations} />}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-12 lg:gap-6">
              <CategoryCard kind="failed" stats={report.failedDelivery} onOpen={() => setOpenCategory("failed")} />
              <CategoryCard kind="refund" stats={report.returnRefund} onOpen={() => setOpenCategory("refund")} />
            </div>

            <section className={report.topItems.length > 0 ? "lg:col-span-7" : "lg:col-span-12"}>
              <SectionHeader
                title="To check"
                action={
                  toCheck.length > 0 ? (
                    <Link href="/returns" className="text-[16px] font-semibold text-brand hover:underline">
                      See all
                    </Link>
                  ) : undefined
                }
              />
              <Group>
                {toCheck.length === 0 ? (
                  <p className="px-5 py-5 text-[16px] text-ink-3">Nothing to check</p>
                ) : (
                  <ul>
                    {toCheck.map((p, i) => (
                      <li key={p.id} className={i >= 3 ? "hidden lg:block" : undefined}>
                        <ParcelRow parcel={p} first={i === 0} onOpen={setSelectedParcelId} />
                      </li>
                    ))}
                  </ul>
                )}
              </Group>
            </section>

            {report.topItems.length > 0 && (
              <div className="lg:col-span-5">
                <Group className="lg:hidden">
                  <button
                    type="button"
                    onClick={() => setTopOpen(true)}
                    className="flex min-h-14 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100"
                  >
                    <span className="shrink-0 whitespace-nowrap text-[17px] font-semibold text-ink">
                      Most returned
                    </span>
                    <span className="flex min-w-0 items-center gap-1 text-[16px] text-ink-3">
                      <span className="truncate">{report.topItems[0].itemSummary}</span>
                      <ChevronRight className="h-5 w-5 shrink-0" />
                    </span>
                  </button>
                </Group>

                <section className="hidden lg:block">
                  <SectionHeader
                    title="Most returned"
                    action={
                      report.topItems.length > 5 ? (
                        <button
                          type="button"
                          onClick={() => setTopOpen(true)}
                          className="text-[16px] font-semibold text-brand hover:underline"
                        >
                          See all
                        </button>
                      ) : undefined
                    }
                  />
                  <Group>
                    <ul className="divide-y divide-hairline">
                      {report.topItems.slice(0, 5).map((item) => (
                        <TopItemRow
                          key={`${item.itemSummary}-${item.variationName}`}
                          item={item}
                          compact
                        />
                      ))}
                    </ul>
                  </Group>
                </section>
              </div>
            )}
          </div>
        )}
      </div>

      <CategorySheet
        category={openCategory}
        stats={
          openCategory === "refund"
            ? (report?.returnRefund ?? null)
            : openCategory === "failed"
              ? (report?.failedDelivery ?? null)
              : null
        }
        dateFilter={customDate ? { date: customDate } : { range }}
        onClose={() => setOpenCategory(null)}
      />

      <Sheet open={topOpen} onClose={() => setTopOpen(false)} title="Most returned">
        <ul className="divide-y divide-hairline pt-1">
          {report?.topItems.map((item) => (
            <TopItemRow key={`${item.itemSummary}-${item.variationName}`} item={item} />
          ))}
        </ul>
      </Sheet>

      <ParcelDetailSheet parcelId={selectedParcelId} onClose={() => setSelectedParcelId(null)} />
    </AppShell>
  );
}
