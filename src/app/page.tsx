"use client";

import { useCallback, useEffect, useState } from "react";
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
    { label: "Sent back", value: stats.courierReturnedCount, className: "text-ink" },
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
            <span className="mt-2 block text-[14px] font-medium text-ink-3">{s.label}</span>
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
      className="rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)]"
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

function MissingStatus({ report }: { report: DailyTruthReport }) {
  const missing = report.combined.missingNowCount;
  const { overdueRtsCount, urgentDeadlineCount } = report.combined;

  return (
    <div className="space-y-3">
      {missing > 0 ? (
        <Link
          key="missing"
          href="/returns?filter=missing"
          className="anim-fade-in pressable flex items-center gap-4 rounded-[var(--radius-card)] bg-missing px-5 py-4 text-white shadow-[0_8px_24px_-10px_rgb(220_38_38/0.6)]"
        >
          <AnimatedNumber value={missing} className="text-[44px] font-extrabold leading-none tracking-[-0.03em]" />
          <span className="min-w-0 flex-1">
            <span className="block text-[18px] font-bold leading-tight">Missing</span>
            <span className="block text-[15px] font-medium text-white">Sent back, not scanned</span>
          </span>
          <ChevronRight className="h-6 w-6 text-white/80" />
        </Link>
      ) : (
        <div key="clear" className="anim-fade-in flex items-center gap-2.5 px-1 py-1">
          <CheckCircle2 className="h-6 w-6 text-arrived" />
          <span className="text-[17px] font-bold text-ink">All clear</span>
          <span className="text-[16px] text-ink-3">Nothing missing</span>
        </div>
      )}

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

function HomeSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-[76px] animate-pulse rounded-[var(--radius-card)] bg-slate-200/60" />
      <div className="h-[148px] animate-pulse rounded-[var(--radius-card)] bg-slate-200/60" />
      <div className="h-[148px] animate-pulse rounded-[var(--radius-card)] bg-slate-200/60" />
    </div>
  );
}

export default function DashboardPage() {
  const [range, setRange] = useState<Range>("today");
  const [customDate, setCustomDate] = useState("");
  const [report, setReport] = useState<DailyTruthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "done">("idle");
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [openCategory, setOpenCategory] = useState<CategoryKey | null>(null);
  const [topOpen, setTopOpen] = useState(false);

  const loadReport = useCallback(async () => {
    try {
      const params = new URLSearchParams({ range });
      if (customDate) params.set("date", customDate);
      const res = await fetch(`/api/dashboard?${params.toString()}`);
      if (res.ok) setReport(await res.json());
    } finally {
      setLoading(false);
    }
  }, [range, customDate]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

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
      await loadReport();
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
  const toCheck = report?.attentionParcels.slice(0, 3) ?? [];

  return (
    <AppShell
      title={title}
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
                className={`h-[22px] w-[22px] ${syncState === "syncing" ? "anim-spin" : ""}`}
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
        />

        {loading || !report ? (
          <HomeSkeleton />
        ) : (
          <div className="anim-fade-in space-y-8">
            <MoneyCard money={report.money} />

            <MissingStatus report={report} />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <CategoryCard kind="failed" stats={report.failedDelivery} onOpen={() => setOpenCategory("failed")} />
              <CategoryCard kind="refund" stats={report.returnRefund} onOpen={() => setOpenCategory("refund")} />
            </div>

            <section>
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
                      <li key={p.id}>
                        <ParcelRow parcel={p} first={i === 0} onOpen={setSelectedParcelId} />
                      </li>
                    ))}
                  </ul>
                )}
              </Group>
            </section>

            {report.topItems.length > 0 && (
              <Group>
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
        onClose={() => setOpenCategory(null)}
      />

      <Sheet open={topOpen} onClose={() => setTopOpen(false)} title="Most returned">
        <ul className="divide-y divide-hairline pt-1">
          {report?.topItems.map((item) => (
            <li key={`${item.itemSummary}-${item.variationName}`} className="flex items-center gap-3.5 py-3">
              <ItemThumb src={item.itemImageUrl} alt={item.itemSummary} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold text-ink">{item.itemSummary}</span>
                <span className="block truncate text-[15px] text-ink-3">
                  {[item.variationName, `${item.failedCount} failed · ${item.returnCount} returned`]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="tabular-nums text-[22px] font-extrabold text-ink">{item.totalCount}</span>
            </li>
          ))}
        </ul>
      </Sheet>

      <ParcelDetailSheet parcelId={selectedParcelId} onClose={() => setSelectedParcelId(null)} />
    </AppShell>
  );
}
