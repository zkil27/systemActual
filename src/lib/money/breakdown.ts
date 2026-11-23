import { MoneyKind, Platform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hasRealConnectedShop } from "@/lib/shops";
import { getManilaDateString, getManilaDayBounds, shiftManilaDateString } from "@/lib/time";

export interface MoneyRow {
  id: string;
  platform: Platform;
  kind: MoneyKind;
  rawType: string;
  amountPhp: number;
  occurredAt: string;
  orderSn: string | null;
  shopName: string;
}

export interface MoneyBreakdown {
  start: string;
  end: string;
  /** Sum per kind in the range (CREDIT, ADS, ADJUSTMENT, WITHDRAWAL, OTHER). */
  byKind: Record<MoneyKind, number>;
  byPlatform: Record<Platform, number>;
  /** Order income credited, trailing windows ending today (Manila). */
  credited7dPhp: number;
  credited30dPhp: number;
  /** Credited per Manila day for the last 14 days, oldest first. */
  dailyCredited: Array<{ date: string; amountPhp: number }>;
  rows: MoneyRow[];
  totalRows: number;
  hasMore: boolean;
}

const KINDS = Object.values(MoneyKind);

const round2 = (n: number) => Math.round(n * 100) / 100;

export function emptyByKind(): Record<MoneyKind, number> {
  return Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<MoneyKind, number>;
}

/** Fill a day-by-day series (missing days are 0) from per-row Manila dates. */
export function buildDailySeries(
  rows: Array<{ occurredAt: Date; amount: number }>,
  todayStr: string,
  days: number
): Array<{ date: string; amountPhp: number }> {
  const sums = new Map<string, number>();
  for (const r of rows) {
    const d = getManilaDateString(r.occurredAt);
    sums.set(d, (sums.get(d) ?? 0) + r.amount);
  }
  const out: Array<{ date: string; amountPhp: number }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftManilaDateString(todayStr, -i);
    out.push({ date, amountPhp: round2(sums.get(date) ?? 0) });
  }
  return out;
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Quote anything with separators; neutralise spreadsheet formulas.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function moneyRowsToCsv(rows: MoneyRow[]): string {
  const header = ["Date (Manila)", "Store", "Shop", "Kind", "Type", "Order", "Amount (PHP)"];
  const lines = rows.map((r) => {
    const d = new Date(r.occurredAt);
    const manila = new Date(d.getTime() + 8 * 3600_000).toISOString().replace("T", " ").slice(0, 16);
    return [
      manila,
      r.platform === Platform.SHOPEE ? "Shopee" : "TikTok Shop",
      r.shopName,
      r.kind,
      r.rawType,
      r.orderSn ?? "",
      r.amountPhp.toFixed(2),
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}

export async function getMoneyBreakdown(opts: {
  start: Date;
  end: Date;
  kind?: MoneyKind | null;
  platform?: Platform | null;
  limit?: number;
  offset?: number;
  now?: Date;
}): Promise<MoneyBreakdown> {
  const now = opts.now ?? new Date();
  const limit = Math.min(5000, Math.max(1, opts.limit ?? 100));
  const offset = Math.max(0, opts.offset ?? 0);
  const realShop: Prisma.WalletTransactionWhereInput = (await hasRealConnectedShop())
    ? { shopConnection: { isDemo: false } }
    : {};
  const rangeWhere: Prisma.WalletTransactionWhereInput = {
    ...realShop,
    occurredAt: { gte: opts.start, lt: opts.end },
  };
  const rowWhere: Prisma.WalletTransactionWhereInput = {
    ...rangeWhere,
    ...(opts.kind ? { kind: opts.kind } : {}),
    ...(opts.platform ? { platform: opts.platform } : {}),
  };

  const todayStr = getManilaDateString(now);
  const todayEnd = getManilaDayBounds(todayStr).end;
  const start7 = getManilaDayBounds(shiftManilaDateString(todayStr, -6)).start;
  const start30 = getManilaDayBounds(shiftManilaDateString(todayStr, -29)).start;
  const start14 = getManilaDayBounds(shiftManilaDateString(todayStr, -13)).start;

  const [grouped, credited7, credited30, daily, totalRows, rows] = await Promise.all([
    prisma.walletTransaction.groupBy({
      by: ["platform", "kind"],
      where: rangeWhere,
      _sum: { amountPhp: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { ...realShop, kind: MoneyKind.CREDIT, occurredAt: { gte: start7, lt: todayEnd } },
      _sum: { amountPhp: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { ...realShop, kind: MoneyKind.CREDIT, occurredAt: { gte: start30, lt: todayEnd } },
      _sum: { amountPhp: true },
    }),
    prisma.walletTransaction.findMany({
      where: { ...realShop, kind: MoneyKind.CREDIT, occurredAt: { gte: start14, lt: todayEnd } },
      select: { occurredAt: true, amountPhp: true },
    }),
    prisma.walletTransaction.count({ where: rowWhere }),
    prisma.walletTransaction.findMany({
      where: rowWhere,
      orderBy: { occurredAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        platform: true,
        kind: true,
        rawType: true,
        amountPhp: true,
        occurredAt: true,
        orderSn: true,
        shopConnection: { select: { shopName: true } },
      },
    }),
  ]);

  const byKind = emptyByKind();
  const byPlatform: Record<Platform, number> = { SHOPEE: 0, TIKTOK: 0 };
  for (const g of grouped) {
    const amt = Number(g._sum.amountPhp ?? 0);
    byKind[g.kind] = round2(byKind[g.kind] + amt);
    if (g.kind === MoneyKind.CREDIT) byPlatform[g.platform] = round2(byPlatform[g.platform] + amt);
  }

  return {
    start: opts.start.toISOString(),
    end: opts.end.toISOString(),
    byKind,
    byPlatform,
    credited7dPhp: round2(Number(credited7._sum.amountPhp ?? 0)),
    credited30dPhp: round2(Number(credited30._sum.amountPhp ?? 0)),
    dailyCredited: buildDailySeries(
      daily.map((d) => ({ occurredAt: d.occurredAt, amount: Number(d.amountPhp) })),
      todayStr,
      14
    ),
    rows: rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      kind: r.kind,
      rawType: r.rawType,
      amountPhp: Number(r.amountPhp),
      occurredAt: r.occurredAt.toISOString(),
      orderSn: r.orderSn,
      shopName: r.shopConnection.shopName,
    })),
    totalRows,
    hasMore: offset + rows.length < totalRows,
  };
}
