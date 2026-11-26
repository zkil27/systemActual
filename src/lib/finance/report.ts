import { Platform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FINANCE_GIVE_UP_MS, manilaMonth } from "./sync";

/** Per-order rows are kept this long; months older than that live only in FinanceMonth. */
export const FINANCE_DETAIL_RETENTION_DAYS = 120;
/** Raw marketplace field snapshots are pruned sooner to save free-tier Postgres space. */
export const FINANCE_BREAKDOWN_RETENTION_DAYS = 14;
const ROLLUP_LOCK_ID = "finance-rollup-last";
const ROLLUP_EVERY_MS = 30 * 60_000;

export const MONEY_FIELDS = [
  "buyerPaidPhp",
  "netPayoutPhp",
  "commissionPhp",
  "serviceFeePhp",
  "transactionFeePhp",
  "affiliatePhp",
  "shippingPhp",
  "withholdingTaxPhp",
  "otherPhp",
  "costPhp",
  "profitPhp",
] as const;
export type MoneyField = (typeof MONEY_FIELDS)[number];

export type MonthTotals = { orders: number; pieces: number; piecesBackGood: number } & Record<MoneyField, number>;

export interface ShopMonth extends MonthTotals {
  shopConnectionId: string;
  platform: Platform;
}

export interface ItemMonth {
  itemKey: string;
  garmentId: string | null;
  name: string;
  imageUrl: string | null;
  pieces: number;
  netPayoutPhp: number;
  costPhp: number;
  profitPhp: number;
}

export interface ProfitReport {
  month: string;
  months: string[];
  /** True while the month's per-order rows still exist (numbers are live). */
  live: boolean;
  totals: MonthTotals;
  byShop: ShopMonth[];
  /** Highest profit first. */
  bestItems: ItemMonth[];
  /** Lowest margin first (items with at least 3 pieces). */
  weakItems: ItemMonth[];
  /** Completed orders the shops haven't given payout data for yet. */
  waitingCount: number;
  /** 1% on half of the payouts (RR 16-2023), shown only as an estimate when the shops' data has no tax line. */
  taxEstimatePhp: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function emptyTotals(): MonthTotals {
  const t = { orders: 0, pieces: 0, piecesBackGood: 0 } as MonthTotals;
  for (const f of MONEY_FIELDS) t[f] = 0;
  return t;
}

/** Adds shop months into one total. Pure. */
export function sumTotals(rows: MonthTotals[]): MonthTotals {
  const t = emptyTotals();
  for (const r of rows) {
    t.orders += r.orders;
    t.pieces += r.pieces;
    t.piecesBackGood += r.piecesBackGood;
    for (const f of MONEY_FIELDS) t[f] = round2(t[f] + r[f]);
  }
  return t;
}

/** Best by profit; weakest by margin among items that sold a few pieces. Pure. */
export function pickItems(items: ItemMonth[], n = 5): { best: ItemMonth[]; weak: ItemMonth[] } {
  const best = [...items].sort((a, b) => b.profitPhp - a.profitPhp).slice(0, n);
  const margin = (i: ItemMonth) => (i.netPayoutPhp > 0 ? i.profitPhp / i.netPayoutPhp : -1);
  const weak = items
    .filter((i) => i.pieces >= 3)
    .sort((a, b) => margin(a) - margin(b))
    .slice(0, n);
  return { best, weak };
}

/** Withholding under RR 16-2023 is 1% of half the gross remittance: 0.5% of payouts. Pure. */
export function estimateWithholding(netPayoutPhp: number): number {
  return round2(Math.max(0, netPayoutPhp) * 0.005);
}

/** This month and the two before it (Manila): their per-order rows are all still kept. */
export function recomputableMonths(now: Date = new Date()): string[] {
  const current = manilaMonth(now);
  const [y, m] = current.split("-").map(Number);
  const back = (k: number) => {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return [current, back(1), back(2)];
}

const toNum = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** One month, live from the per-order rows. */
export async function aggregateMonth(month: string): Promise<{ byShop: ShopMonth[]; items: ItemMonth[] }> {
  const sumSelect = Object.fromEntries(MONEY_FIELDS.map((f) => [f, true])) as Record<MoneyField, true>;
  const [shops, lines, names, garments] = await Promise.all([
    prisma.orderFinance.groupBy({
      by: ["shopConnectionId", "platform"],
      where: { month },
      _count: { _all: true },
      _sum: { ...sumSelect, pieces: true, piecesBackGood: true },
    }),
    prisma.orderFinanceLine.groupBy({
      by: ["itemKey"],
      where: { month },
      _sum: { pieces: true, netPayoutPhp: true, costPhp: true },
    }),
    prisma.orderFinanceLine.findMany({
      where: { month },
      distinct: ["itemKey"],
      select: { itemKey: true, garmentId: true, name: true, imageUrl: true },
    }),
    prisma.garment.findMany({ select: { id: true, name: true, imageUrl: true } }),
  ]);
  const byShop: ShopMonth[] = shops.map((s) => {
    const row = {
      shopConnectionId: s.shopConnectionId,
      platform: s.platform,
      orders: s._count._all,
      pieces: s._sum.pieces ?? 0,
      piecesBackGood: s._sum.piecesBackGood ?? 0,
    } as ShopMonth;
    for (const f of MONEY_FIELDS) row[f] = round2(toNum(s._sum[f]));
    return row;
  });
  const nameOf = new Map(names.map((n) => [n.itemKey, n]));
  const garmentOf = new Map(garments.map((g) => [g.id, g]));
  const items: ItemMonth[] = lines.map((l) => {
    const n = nameOf.get(l.itemKey);
    const g = n?.garmentId ? garmentOf.get(n.garmentId) : undefined;
    const net = round2(toNum(l._sum.netPayoutPhp));
    const cost = round2(toNum(l._sum.costPhp));
    return {
      itemKey: l.itemKey,
      garmentId: n?.garmentId ?? null,
      // The item's current name and photo when it's linked; the listing's otherwise.
      name: g?.name ?? n?.name ?? "Item",
      imageUrl: g?.imageUrl ?? n?.imageUrl ?? null,
      pieces: l._sum.pieces ?? 0,
      netPayoutPhp: net,
      costPhp: cost,
      profitPhp: round2(net - cost),
    };
  });
  return { byShop, items };
}

const dec = (n: number) => new Prisma.Decimal(n.toFixed(2));

/** Saves recent months into the kept-forever tables, replacing what was there. */
export async function rollUpFinanceMonths(months: string[]): Promise<void> {
  for (const month of months) {
    const { byShop, items } = await aggregateMonth(month);
    await prisma.$transaction([
      prisma.financeMonth.deleteMany({ where: { month } }),
      prisma.financeMonth.createMany({
        data: byShop.map((s) => ({
          month,
          shopConnectionId: s.shopConnectionId,
          platform: s.platform,
          orders: s.orders,
          pieces: s.pieces,
          piecesBackGood: s.piecesBackGood,
          ...Object.fromEntries(MONEY_FIELDS.map((f) => [f, dec(s[f])])),
        })) as Prisma.FinanceMonthCreateManyInput[],
      }),
      prisma.itemProfitMonth.deleteMany({ where: { month } }),
      prisma.itemProfitMonth.createMany({
        data: items.map((i) => ({
          month,
          itemKey: i.itemKey,
          garmentId: i.garmentId,
          name: i.name.slice(0, 200),
          imageUrl: i.imageUrl,
          pieces: i.pieces,
          netPayoutPhp: dec(i.netPayoutPhp),
          costPhp: dec(i.costPhp),
          profitPhp: dec(i.profitPhp),
        })),
      }),
    ]);
  }
}

/** Worker tick: keep the monthly totals current, at most every 30 minutes. */
export async function maybeRollUpFinance(now: Date = new Date()): Promise<boolean> {
  const row = await prisma.workerLock.findUnique({ where: { id: ROLLUP_LOCK_ID } });
  if (row && now.getTime() - row.lockedUntil.getTime() < ROLLUP_EVERY_MS) return false;
  await rollUpFinanceMonths(recomputableMonths(now));
  await prisma.workerLock.upsert({
    where: { id: ROLLUP_LOCK_ID },
    create: { id: ROLLUP_LOCK_ID, lockedUntil: now },
    update: { lockedUntil: now },
  });
  return true;
}

export async function pruneOrderFinance(now: Date = new Date()): Promise<number> {
  const breakdownCutoff = new Date(now.getTime() - FINANCE_BREAKDOWN_RETENTION_DAYS * 24 * 3600_000);
  await prisma.orderFinance.updateMany({
    where: {
      settledAt: { lt: breakdownCutoff },
      breakdown: { not: Prisma.JsonNull },
    },
    data: { breakdown: Prisma.JsonNull },
  });
  const res = await prisma.orderFinance.deleteMany({
    where: { settledAt: { lt: new Date(now.getTime() - FINANCE_DETAIL_RETENTION_DAYS * 24 * 3600_000) } },
  });
  return res.count;
}

async function storedMonth(month: string): Promise<{ byShop: ShopMonth[]; items: ItemMonth[] }> {
  const [shops, items] = await Promise.all([
    prisma.financeMonth.findMany({ where: { month } }),
    prisma.itemProfitMonth.findMany({ where: { month } }),
  ]);
  return {
    byShop: shops.map((s) => {
      const row = {
        shopConnectionId: s.shopConnectionId,
        platform: s.platform,
        orders: s.orders,
        pieces: s.pieces,
        piecesBackGood: s.piecesBackGood,
      } as ShopMonth;
      for (const f of MONEY_FIELDS) row[f] = toNum(s[f]);
      return row;
    }),
    items: items.map((i) => ({
      itemKey: i.itemKey,
      garmentId: i.garmentId,
      name: i.name,
      imageUrl: i.imageUrl,
      pieces: i.pieces,
      netPayoutPhp: toNum(i.netPayoutPhp),
      costPhp: toNum(i.costPhp),
      profitPhp: toNum(i.profitPhp),
    })),
  };
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function parseMonth(value: string | null | undefined, now: Date = new Date()): string {
  return value && MONTH_RE.test(value) ? value : manilaMonth(now);
}

export async function getProfitReport(monthParam?: string | null, now: Date = new Date()): Promise<ProfitReport> {
  const month = parseMonth(monthParam, now);
  const recent = recomputableMonths(now);
  const live = recent.includes(month);
  const realShops = await prisma.shopConnection.findMany({ where: { isDemo: false }, select: { id: true } });
  const realIds = new Set(realShops.map((s) => s.id));

  const [data, stored, waitingCount] = await Promise.all([
    live ? aggregateMonth(month) : storedMonth(month),
    prisma.financeMonth.findMany({ distinct: ["month"], select: { month: true }, orderBy: { month: "desc" } }),
    prisma.order.count({
      where: {
        status: "COMPLETED",
        financeSavedAt: null,
        platformUpdatedAt: { gte: new Date(now.getTime() - FINANCE_GIVE_UP_MS) },
        ...(realIds.size ? { shopConnectionId: { in: [...realIds] } } : {}),
      },
    }),
  ]);
  // Demo shops never mix with real money once a real shop exists.
  const byShop = realIds.size ? data.byShop.filter((s) => realIds.has(s.shopConnectionId)) : data.byShop;
  const totals = sumTotals(byShop);
  const { best, weak } = pickItems(data.items);
  const months = [...new Set([...recent, ...stored.map((s) => s.month)])].sort().reverse();
  return {
    month,
    months,
    live,
    totals,
    byShop,
    bestItems: best,
    weakItems: weak,
    waitingCount,
    taxEstimatePhp: estimateWithholding(totals.netPayoutPhp),
  };
}
