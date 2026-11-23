"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import type { MoneyBreakdown, MoneyRow } from "@/lib/money/breakdown";
import { formatPeso, formatSignedPeso, manilaDateTime, manilaDayLabel } from "@/lib/ui/format";

export type MoneyRange = "today" | "yesterday" | "7days" | "30days";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7days", label: "7 Days" },
  { id: "30days", label: "30 Days" },
] as const;

const KIND_ROWS: Array<{ id: keyof MoneyBreakdown["byKind"]; label: string }> = [
  { id: "CREDIT", label: "Order income credited" },
  { id: "ADS", label: "Ads" },
  { id: "ADJUSTMENT", label: "Adjustments" },
  { id: "WITHDRAWAL", label: "Withdrawn to bank" },
  { id: "OTHER", label: "Other" },
];

const KIND_LABEL: Record<string, string> = {
  CREDIT: "Credited",
  ADS: "Ads",
  ADJUSTMENT: "Adjustment",
  WITHDRAWAL: "Withdrawal",
  OTHER: "Other",
};

type KindFilter = "all" | MoneyRow["kind"];

const KIND_FILTERS = [
  { id: "all", label: "All" },
  { id: "CREDIT", label: "Credited" },
  { id: "ADS", label: "Ads" },
  { id: "ADJUSTMENT", label: "Adjust" },
  { id: "WITHDRAWAL", label: "Withdraw" },
] as const;

/** 14 days of credited money. One series, brand colour, per-bar tooltip; numbers repeated in text. */
function DailyBars({ days }: { days: MoneyBreakdown["dailyCredited"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.amountPhp));
  const shown = hover !== null ? days[hover] : days[days.length - 1];
  return (
    <figure className="space-y-2">
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-semibold text-ink-3">Credited per day · 14 days</span>
        {shown && (
          <span className="tabular-nums text-[14px] text-ink-2">
            {manilaDayLabel(shown.date)} · <span className="font-semibold text-ink">{formatPeso(shown.amountPhp)}</span>
          </span>
        )}
      </figcaption>
      <div
        role="img"
        aria-label={`Credited per day: ${days.map((d) => `${d.date} ${formatPeso(d.amountPhp)}`).join(", ")}`}
        className="flex h-24 items-end gap-[2px] border-b border-hairline"
        onMouseLeave={() => setHover(null)}
      >
        {days.map((d, i) => {
          const h = d.amountPhp > 0 ? Math.max(3, (d.amountPhp / max) * 100) : 0;
          return (
            <div
              key={d.date}
              className="flex h-full min-w-0 flex-1 cursor-default items-end"
              onMouseEnter={() => setHover(i)}
              onTouchStart={() => setHover(i)}
              title={`${manilaDayLabel(d.date)}: ${formatPeso(d.amountPhp)}`}
            >
              <div
                className={`w-full rounded-t-[4px] transition-opacity ${
                  hover === null || hover === i ? "opacity-100" : "opacity-45"
                } ${i === days.length - 1 ? "bg-brand-solid" : "bg-brand"}`}
                style={{ height: `${h}%` }}
              />
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function Body({ initialRange, open }: { initialRange: MoneyRange; open: boolean }) {
  const [range, setRange] = useState<MoneyRange>(initialRange);
  const [kind, setKind] = useState<KindFilter>("all");
  const [data, setData] = useState<MoneyBreakdown | null>(null);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const req = useRef(0);

  useEffect(() => {
    if (open) setRange(initialRange);
  }, [open, initialRange]);

  const query = useCallback(
    (offset = 0, format?: "csv") => {
      const sp = new URLSearchParams({ range });
      if (kind !== "all") sp.set("kind", kind);
      if (offset) sp.set("offset", String(offset));
      if (format) sp.set("format", format);
      return `/api/money?${sp.toString()}`;
    },
    [range, kind]
  );

  useEffect(() => {
    if (!open) return;
    const id = ++req.current;
    setError(false);
    fetch(query(), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as MoneyBreakdown;
      })
      .then((d) => {
        if (id === req.current) setData(d);
      })
      .catch(() => {
        if (id === req.current) setError(true);
      });
  }, [open, query, retry]);

  async function loadMore() {
    if (!data || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(query(data.rows.length), { cache: "no-store" });
      if (r.ok) {
        const more = (await r.json()) as MoneyBreakdown;
        setData((prev) => (prev ? { ...prev, rows: [...prev.rows, ...more.rows], hasMore: more.hasMore } : more));
      }
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="space-y-6 pt-2">
      <SegmentedControl label="Money range" options={RANGES} value={range} onChange={(id) => setRange(id)} className="w-full" />

      {error && !data ? (
        <div className="space-y-3 py-6 text-center">
          <p className="text-[16px] text-ink-2">Couldn&apos;t load money details.</p>
          <Button variant="secondary" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <div className="space-y-3" aria-busy="true">
          <div className="h-20 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
          <div className="h-40 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[var(--radius-control)] bg-surface-subtle p-4">
              <span className="block text-[13px] font-semibold text-ink-3">Credited · 7 days</span>
              <span className="tabular-nums mt-1 block text-[22px] font-extrabold text-ink">
                {formatPeso(data.credited7dPhp)}
              </span>
            </div>
            <div className="rounded-[var(--radius-control)] bg-surface-subtle p-4">
              <span className="block text-[13px] font-semibold text-ink-3">Credited · 30 days</span>
              <span className="tabular-nums mt-1 block text-[22px] font-extrabold text-ink">
                {formatPeso(data.credited30dPhp)}
              </span>
            </div>
          </div>

          <DailyBars days={data.dailyCredited} />

          <div>
            <p className="mb-1 text-[14px] font-semibold text-ink-3">In this range</p>
            <dl className="divide-y divide-hairline border-t border-hairline">
              {KIND_ROWS.filter((k) => k.id === "CREDIT" || data.byKind[k.id] !== 0).map((k) => (
                <div key={k.id} className="flex min-h-12 items-center justify-between gap-4 py-3">
                  <dt className="text-[16px] text-ink">
                    {k.label}
                    {k.id === "CREDIT" && (
                      <span className="block text-[14px] text-ink-3 tabular-nums">
                        Shopee {formatPeso(data.byPlatform.SHOPEE)} · TikTok {formatPeso(data.byPlatform.TIKTOK)}
                      </span>
                    )}
                  </dt>
                  <dd className="tabular-nums text-[16px] font-semibold text-ink">
                    {k.id === "CREDIT" ? formatPeso(data.byKind[k.id]) : formatSignedPeso(data.byKind[k.id])}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[14px] font-semibold text-ink-3">
                Transactions <span className="tabular-nums">({data.totalRows})</span>
              </p>
              <a
                href={query(0, "csv")}
                className="pressable -mr-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[15px] font-semibold text-brand hover:bg-brand/10"
              >
                <Download className="h-4 w-4" /> CSV
              </a>
            </div>
            <SegmentedControl
              label="Transaction kind"
              options={KIND_FILTERS}
              value={kind}
              onChange={(id) => setKind(id as KindFilter)}
              className="w-full"
            />
            {data.rows.length === 0 ? (
              <p className="py-5 text-center text-[16px] text-ink-3">No transactions in this range</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {data.rows.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-ink">
                        {KIND_LABEL[r.kind] ?? r.kind}
                        {r.orderSn ? <span className="font-normal text-ink-3"> · {r.orderSn}</span> : null}
                      </span>
                      <span className="block truncate text-[13px] text-ink-3">
                        {r.platform === "SHOPEE" ? "Shopee" : "TikTok"} · {manilaDateTime(r.occurredAt)} ·{" "}
                        {r.rawType.replace(/_/g, " ").toLowerCase()}
                      </span>
                    </span>
                    <span
                      className={`tabular-nums shrink-0 text-[16px] font-bold ${
                        r.amountPhp < 0 ? "text-ink-2" : "text-ink"
                      }`}
                    >
                      {formatSignedPeso(r.amountPhp)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.hasMore && (
              <Button variant="secondary" full onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function MoneyBreakdownSheet({
  open,
  onClose,
  initialRange,
}: {
  open: boolean;
  onClose: () => void;
  initialRange: MoneyRange;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Money">
      <Body open={open} initialRange={initialRange} />
    </Sheet>
  );
}
