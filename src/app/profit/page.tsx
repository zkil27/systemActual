"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Info } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Group, SectionHeader } from "@/components/ui/Button";
import { Disclosure } from "@/components/ui/Disclosure";
import { ItemThumb } from "@/components/ui/ItemThumb";
import { ScrollChips } from "@/components/ui/ScrollChips";
import { formatPeso } from "@/lib/ui/format";

interface Totals {
  orders: number;
  pieces: number;
  piecesBackGood: number;
  buyerPaidPhp: number;
  netPayoutPhp: number;
  commissionPhp: number;
  serviceFeePhp: number;
  transactionFeePhp: number;
  affiliatePhp: number;
  shippingPhp: number;
  withholdingTaxPhp: number;
  otherPhp: number;
  costPhp: number;
  profitPhp: number;
}

interface ShopRow extends Totals {
  shopConnectionId: string;
  platform: "SHOPEE" | "TIKTOK";
  shopName: string;
}

interface ItemRow {
  itemKey: string;
  name: string;
  imageUrl: string | null;
  pieces: number;
  netPayoutPhp: number;
  costPhp: number;
  profitPhp: number;
}

interface Report {
  month: string;
  months: string[];
  live: boolean;
  totals: Totals;
  byShop: ShopRow[];
  bestItems: ItemRow[];
  weakItems: ItemRow[];
  waitingCount: number;
  taxEstimatePhp: number;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-PH", { month: "long", year: "numeric", timeZone: "UTC" });
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "bad" | "good" }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2.5">
      <span className={`text-[16px] ${strong ? "font-bold text-ink" : "text-ink-2"}`}>{label}</span>
      <span
        className={`tabular-nums text-[16px] ${strong ? "font-bold" : "font-semibold"} ${
          tone === "bad" ? "text-missing-ink" : tone === "good" ? "text-arrived" : "text-ink"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function ShopTook({ t }: { t: Totals }) {
  const took = Math.max(0, t.buyerPaidPhp - t.netPayoutPhp);
  const parts: Array<[string, number]> = [
    ["Commission", t.commissionPhp],
    ["Service fees", t.serviceFeePhp],
    ["Transaction fees", t.transactionFeePhp],
    ["Affiliate", t.affiliatePhp],
    ["Shipping", t.shippingPhp],
    ["Tax held by the shop", t.withholdingTaxPhp],
    ["Vouchers, rebates & other", t.otherPhp],
  ];
  return (
    <Disclosure
      label={
        <span className="flex w-full items-baseline justify-between gap-3">
          <span className="text-[16px] text-ink-2">Shops took</span>
          <span className="tabular-nums text-[16px] font-semibold text-missing-ink">
            −{formatPeso(took)} <span className="font-normal text-ink-3">({pct(took, t.buyerPaidPhp)})</span>
          </span>
        </span>
      }
      summaryClassName="py-2.5"
    >
      <div className="mb-2 rounded-[var(--radius-control)] bg-surface-subtle px-3">
        {parts
          .filter(([, v]) => Math.round(v) !== 0)
          .map(([label, v]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 py-2 text-[15px]">
              <span className="text-ink-2">{label}</span>
              <span className="tabular-nums text-ink">{v < 0 ? `+${formatPeso(-v)}` : `−${formatPeso(v)}`}</span>
            </div>
          ))}
      </div>
    </Disclosure>
  );
}

function ItemList({ items, empty }: { items: ItemRow[]; empty: string }) {
  if (!items.length) return <p className="px-5 py-5 text-[16px] text-ink-3">{empty}</p>;
  return (
    <ul className="divide-y divide-hairline">
      {items.map((i) => (
        <li key={i.itemKey} className="flex items-center gap-3.5 px-4 py-3">
          <ItemThumb src={i.imageUrl} alt={i.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold text-ink">{i.name}</p>
            <p className="text-[14px] tabular-nums text-ink-3">
              {i.pieces} pcs · paid {formatPeso(i.netPayoutPhp)} · cost {formatPeso(i.costPhp)}
            </p>
          </div>
          <div className="text-right">
            <p className={`tabular-nums text-[16px] font-bold ${i.profitPhp < 0 ? "text-missing-ink" : "text-ink"}`}>
              {formatPeso(i.profitPhp)}
            </p>
            <p className="tabular-nums text-[13px] text-ink-3">{pct(i.profitPhp, i.netPayoutPhp)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ProfitPage() {
  const [month, setMonth] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async (m: string | null) => {
    setError(false);
    try {
      const res = await fetch(`/api/profit${m ? `?month=${m}` : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setReport(await res.json());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  const t = report?.totals;
  const noData = t && t.orders === 0;

  return (
    <AppShell
      title="Profit"
      subtitle={report ? `${monthLabel(report.month)} · by payout date` : undefined}
      onRefresh={() => load(month)}
    >
      <div className="space-y-8">
        {report && (
          <ScrollChips label="Month">
            {report.months.map((m) => {
              const active = m === report.month;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setLoading(true);
                    setMonth(m);
                  }}
                  className={`pressable h-10 shrink-0 rounded-full px-4 text-[15px] font-semibold ${
                    active
                      ? "bg-ink text-ink-inverse"
                      : "text-ink-2 shadow-[inset_0_0_0_1px_var(--color-hairline-strong)] active:bg-ink/[0.05]"
                  }`}
                >
                  {monthLabel(m)}
                </button>
              );
            })}
          </ScrollChips>
        )}

        {error && !report ? (
          <p className="py-10 text-center text-[17px] font-semibold text-ink">Couldn&apos;t load profit. Pull to try again.</p>
        ) : loading || !report || !t ? (
          <div className="h-64 animate-pulse rounded-[var(--radius-card)] bg-surface-muted" />
        ) : (
          <>
            <section className="rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--shadow-card)]">
              <p className="text-[15px] font-bold text-ink-2">Profit</p>
              <p
                className={`mt-2 text-[40px] font-extrabold leading-none tracking-[-0.02em] tabular-nums ${
                  t.profitPhp < 0 ? "text-missing-ink" : "text-ink"
                }`}
              >
                {formatPeso(t.profitPhp)}
              </p>
              <p className="mt-2 text-[15px] tabular-nums text-ink-3">
                {t.orders.toLocaleString("en-PH")} paid orders · {t.pieces.toLocaleString("en-PH")} pcs · margin{" "}
                {pct(t.profitPhp, t.netPayoutPhp)}
              </p>
              {noData && (
                <p className="mt-3 text-[15px] text-ink-2">
                  No paid orders yet this month. Profit shows once Shopee or TikTok pays out a completed order.
                </p>
              )}

              <div className="mt-4 divide-y divide-hairline border-t border-hairline">
                <Line label="Buyers paid" value={formatPeso(t.buyerPaidPhp)} />
                <ShopTook t={t} />
                <Line label="Paid to you" value={formatPeso(t.netPayoutPhp)} strong />
                <Line label="Cost of goods (puhunan)" value={`−${formatPeso(t.costPhp)}`} />
                <Line label="Profit" value={formatPeso(t.profitPhp)} strong tone={t.profitPhp < 0 ? "bad" : "good"} />
              </div>
              {t.piecesBackGood > 0 && (
                <p className="mt-2 text-[14px] text-ink-3">
                  {t.piecesBackGood} returned {t.piecesBackGood === 1 ? "piece is" : "pieces are"} back on the shelf, so not counted as cost.
                </p>
              )}
              {report.waitingCount > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-[14px] text-ink-3">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  {report.waitingCount.toLocaleString("en-PH")} completed {report.waitingCount === 1 ? "order is" : "orders are"} waiting for the shop&apos;s payout details.
                </p>
              )}
            </section>

            {report.byShop.length > 1 && (
              <section>
                <SectionHeader title="By shop" />
                <Group>
                  <ul className="divide-y divide-hairline">
                    {report.byShop.map((s) => (
                      <li key={s.shopConnectionId} className="flex items-baseline justify-between gap-3 px-4 py-3">
                        <span className="min-w-0">
                          <span className="block truncate text-[16px] font-semibold text-ink">{s.shopName}</span>
                          <span className="block text-[14px] tabular-nums text-ink-3">
                            {s.orders} orders · shop took {pct(Math.max(0, s.buyerPaidPhp - s.netPayoutPhp), s.buyerPaidPhp)}
                          </span>
                        </span>
                        <span className="tabular-nums text-[16px] font-bold text-ink">{formatPeso(s.profitPhp)}</span>
                      </li>
                    ))}
                  </ul>
                </Group>
              </section>
            )}

            <section>
              <SectionHeader title="Earns the most" />
              <Group>
                <ItemList items={report.bestItems} empty="Nothing paid out yet" />
              </Group>
            </section>

            {report.weakItems.length > 0 && (
              <section>
                <SectionHeader title="Earns the least" />
                <Group>
                  <ItemList items={report.weakItems} empty="" />
                </Group>
                <p className="mt-2 px-1 text-[14px] text-ink-3">Lowest margin among items with 3 or more pieces sold. Worth a price check.</p>
              </section>
            )}

            <section>
              <SectionHeader title="Tax" />
              <Group>
                <div className="space-y-1.5 px-4 py-3.5">
                  {t.withholdingTaxPhp > 0 ? (
                    <p className="text-[16px] text-ink">
                      Held by the shops: <span className="font-bold tabular-nums">{formatPeso(t.withholdingTaxPhp)}</span>
                    </p>
                  ) : (
                    <p className="text-[16px] text-ink">
                      The shops&apos; data shows no tax held. If they withhold the 1% (on half of what they pay you), it
                      would be about <span className="font-bold tabular-nums">{formatPeso(report.taxEstimatePhp)}</span>.
                    </p>
                  )}
                  <p className="text-[14px] text-ink-3">
                    Check BIR Form 2307 from Shopee and TikTok Shop for the exact amount. This is not tax advice.
                  </p>
                </div>
              </Group>
            </section>

            <a
              href={`/api/profit?month=${report.month}&format=csv`}
              className="pressable flex h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-surface-muted text-[16px] font-bold text-ink hover:bg-surface-track"
            >
              <Download className="h-5 w-5" />
              Download for bookkeeper (Excel)
            </a>
            <p className="-mt-5 px-1 text-[14px] text-ink-3">
              {report.live
                ? "One line per paid order."
                : "One line per shop. Order-by-order details are kept for 4 months."}{" "}
              Money taken back after a payout (late refunds, adjustments) shows under Money on Today.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
