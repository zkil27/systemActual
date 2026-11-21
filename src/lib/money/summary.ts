import { MoneyKind, Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface MoneySummary {
  /** The owner's main number: order income credited in the range. */
  creditedPhp: number;
  creditedShopeePhp: number;
  creditedTikTokPhp: number;
  /** Ads charges and refunds (negative = money out). */
  adsPhp: number;
  /** Platform adjustments (negative = money out). */
  adjustmentsPhp: number;
  /** Shown muted: what buyers ordered, not money received. */
  ordersPlacedCount: number;
  ordersPlacedPhp: number;
  /** Oldest money sync across live shops, or null if none synced yet. */
  updatedAt: string | null;
}

interface KindSum {
  platform: Platform;
  kind: MoneyKind;
  amount: number;
}

export function summarizeMoney(
  sums: KindSum[],
  orders: { count: number; totalPhp: number },
  updatedAt: Date | null
): MoneySummary {
  const total = (pred: (s: KindSum) => boolean) =>
    Math.round(sums.filter(pred).reduce((n, s) => n + s.amount, 0) * 100) / 100;
  return {
    creditedPhp: total((s) => s.kind === MoneyKind.CREDIT),
    creditedShopeePhp: total((s) => s.kind === MoneyKind.CREDIT && s.platform === Platform.SHOPEE),
    creditedTikTokPhp: total((s) => s.kind === MoneyKind.CREDIT && s.platform === Platform.TIKTOK),
    adsPhp: total((s) => s.kind === MoneyKind.ADS),
    adjustmentsPhp: total((s) => s.kind === MoneyKind.ADJUSTMENT),
    ordersPlacedCount: orders.count,
    ordersPlacedPhp: Math.round(orders.totalPhp * 100) / 100,
    updatedAt: updatedAt?.toISOString() ?? null,
  };
}

export async function getMoneySummary(start: Date, end: Date): Promise<MoneySummary> {
  const [grouped, orders, shops] = await Promise.all([
    prisma.walletTransaction.groupBy({
      by: ["platform", "kind"],
      where: { occurredAt: { gte: start, lt: end } },
      _sum: { amountPhp: true },
    }),
    prisma.order.aggregate({
      where: { platformCreatedAt: { gte: start, lt: end }, status: { not: "UNPAID" } },
      _count: { _all: true },
      _sum: { totalPhp: true },
    }),
    prisma.shopConnection.findMany({
      where: { isDemo: false, accessToken: { not: null } },
      select: { walletCheckedAt: true },
    }),
  ]);

  const checked = shops.map((s) => s.walletCheckedAt);
  const updatedAt =
    checked.length && checked.every(Boolean)
      ? new Date(Math.min(...checked.map((d) => d!.getTime())))
      : null;

  return summarizeMoney(
    grouped.map((g) => ({ platform: g.platform, kind: g.kind, amount: Number(g._sum.amountPhp ?? 0) })),
    { count: orders._count._all, totalPhp: Number(orders._sum.totalPhp ?? 0) },
    updatedAt
  );
}
