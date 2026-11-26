import { Platform, Prisma, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { MarketplaceHttpError } from "@/lib/connectors/http";
import { shopeeGet } from "@/lib/connectors/shopee";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { expectedLinesFromItems, lineKeyOf } from "@/lib/returns/item-check";
import { RESTOCK_CONDITIONS } from "@/lib/stock/rules";
import { getManilaDateString } from "@/lib/time";
import { buildFinanceRecord, mapShopeeEscrow, mapTikTokOrderStatements, type FinanceFigures, type FinanceLineInput } from "./map";

/** A completed order without payout data is asked again after this long. */
export const FINANCE_RECHECK_MS = 6 * 3600_000;
/** Orders completed longer ago than this are no longer asked about. */
export const FINANCE_GIVE_UP_MS = 45 * 24 * 3600_000;
/** Orders asked about per shop per tick, and at once. */
const BATCH = 40;
const CONCURRENCY = 3;

const d2 = (n: number) => new Prisma.Decimal(n.toFixed(2));

/** Manila month, "2026-11". */
export function manilaMonth(at: Date): string {
  return getManilaDateString(at).slice(0, 7);
}

/** Which completed orders to ask about now. Pure. */
export function financeCandidateWhere(shopConnectionId: string, now: Date): Prisma.OrderWhereInput {
  return {
    shopConnectionId,
    status: "COMPLETED",
    financeSavedAt: null,
    platformUpdatedAt: { gte: new Date(now.getTime() - FINANCE_GIVE_UP_MS) },
    OR: [{ financeCheckedAt: null }, { financeCheckedAt: { lt: new Date(now.getTime() - FINANCE_RECHECK_MS) } }],
  };
}

async function fetchFigures(conn: ShopConnection, token: string, orderSn: string): Promise<FinanceFigures | null> {
  if (conn.platform === Platform.SHOPEE) {
    return mapShopeeEscrow(await shopeeGet("/api/v2/payment/get_escrow_detail", conn.shopId, token, { order_sn: orderSn }));
  }
  return mapTikTokOrderStatements(
    await tiktokRequest({
      method: "GET",
      path: `/finance/202309/orders/${encodeURIComponent(orderSn)}/statement_transactions`,
      accessToken: token,
      shopCipher: conn.shopCipher,
    })
  );
}

/**
 * Pieces per line ("listingId:variationId") that came back good on a return
 * of this order: from the item check when staff did one, else the whole
 * parcel when it was scanned as restockable.
 */
async function piecesBackGood(platform: Platform, orderSn: string): Promise<Map<string, number>> {
  const parcels = await prisma.returnParcel.findMany({
    where: { platform, orderSn, physicallyReceivedAt: { not: null } },
    select: {
      physicalCondition: true,
      itemsJson: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { itemChecks: { select: { lineKey: true, goodQty: true } } },
      },
    },
  });
  const back = new Map<string, number>();
  const add = (key: string, n: number) => back.set(key, (back.get(key) ?? 0) + n);
  for (const p of parcels) {
    const checks = p.scans[0]?.itemChecks ?? [];
    if (checks.length) {
      for (const c of checks) add(c.lineKey, c.goodQty);
    } else if (p.physicalCondition && RESTOCK_CONDITIONS.has(p.physicalCondition)) {
      for (const l of expectedLinesFromItems(p.itemsJson)) add(l.lineKey, l.quantity);
    }
  }
  return back;
}

type OrderForFinance = Prisma.OrderGetPayload<{ include: { lines: true } }>;

async function lineInputs(order: OrderForFinance, defaultCost: number): Promise<FinanceLineInput[]> {
  const listings = await prisma.listingVariant.findMany({
    where: {
      shopConnectionId: order.shopConnectionId,
      OR: order.lines.map((l) => ({ listingId: l.listingId, variationId: l.variationId })),
    },
    select: {
      listingId: true,
      variationId: true,
      garmentVariant: { select: { garment: { select: { id: true, unitCostPhp: true } } } },
    },
  });
  const byKey = new Map(listings.map((l) => [`${l.listingId}:${l.variationId}`, l.garmentVariant?.garment ?? null]));
  const back = await piecesBackGood(order.platform, order.orderSn);
  return order.lines.map((l) => {
    const key = `${l.listingId}:${l.variationId}`;
    const garment = byKey.get(key) ?? null;
    return {
      listingId: l.listingId,
      variationId: l.variationId,
      name: l.variationName ? `${l.name} (${l.variationName})` : l.name,
      imageUrl: l.imageUrl,
      quantity: l.quantity,
      unitPricePhp: Number(l.unitPricePhp),
      garmentId: garment?.id ?? null,
      unitCostPhp: garment?.unitCostPhp !== null && garment?.unitCostPhp !== undefined ? Number(garment.unitCostPhp) : defaultCost,
      piecesBackGood: back.get(lineKeyOf({ name: l.name, variationName: l.variationName, listingId: l.listingId, variationId: l.variationId })) ?? 0,
    };
  });
}

/** Saves one order's finance (exported for checks against a test database). */
export async function saveFinance(conn: ShopConnection, order: OrderForFinance, figures: FinanceFigures, defaultCost: number) {
  // Shopee's escrow detail has no release time; the wallet credit for the order does.
  let settledAt = figures.settledAt;
  if (!settledAt) {
    const credit = await prisma.walletTransaction.findFirst({
      where: { platform: conn.platform, orderSn: order.orderSn, kind: "CREDIT" },
      orderBy: { occurredAt: "asc" },
      select: { occurredAt: true },
    });
    settledAt = credit?.occurredAt ?? order.platformUpdatedAt;
  }
  const record = buildFinanceRecord(figures, Number(order.totalPhp), await lineInputs(order, defaultCost));
  const month = manilaMonth(settledAt);
  const data = {
    settledAt,
    month,
    pieces: record.pieces,
    piecesBackGood: record.piecesBackGood,
    buyerPaidPhp: d2(record.buyerPaidPhp),
    netPayoutPhp: d2(record.netPayoutPhp),
    commissionPhp: d2(record.commissionPhp),
    serviceFeePhp: d2(record.serviceFeePhp),
    transactionFeePhp: d2(record.transactionFeePhp),
    affiliatePhp: d2(record.affiliatePhp),
    shippingPhp: d2(record.shippingPhp),
    withholdingTaxPhp: d2(record.withholdingTaxPhp),
    otherPhp: d2(record.otherPhp),
    costPhp: d2(record.costPhp),
    profitPhp: d2(record.profitPhp),
    breakdown: figures.breakdown as Prisma.InputJsonValue,
  };
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const fin = await tx.orderFinance.upsert({
      where: { platform_orderSn: { platform: conn.platform, orderSn: order.orderSn } },
      create: { shopConnectionId: conn.id, platform: conn.platform, orderSn: order.orderSn, ...data },
      update: data,
      select: { id: true },
    });
    await tx.orderFinanceLine.deleteMany({ where: { financeId: fin.id } });
    await tx.orderFinanceLine.createMany({
      data: record.lines.map((l) => ({
        financeId: fin.id,
        month,
        itemKey: l.itemKey,
        garmentId: l.garmentId,
        name: l.name.slice(0, 200),
        imageUrl: l.imageUrl,
        pieces: l.pieces,
        netPayoutPhp: d2(l.netPayoutPhp),
        costPhp: d2(l.costPhp),
      })),
    });
    await tx.order.update({ where: { id: order.id }, data: { financeCheckedAt: now, financeSavedAt: now } });
  });
}

/** Too many requests: stop asking this shop for the rest of the tick. */
export function isRateLimited(err: unknown): boolean {
  if (err instanceof MarketplaceHttpError && err.status === 429) return true;
  const m = err instanceof Error ? err.message : String(err);
  return /too many|rate limit|frequen|throttl|429/i.test(m);
}

/**
 * Asks the shop for fees and payout of completed orders, a batch per tick.
 * Read-only on the shop's side. Orders not settled yet are asked again later.
 */
export async function syncOrderFinance(
  conn: ShopConnection,
  token: string,
  deadline: number,
  now: Date = new Date()
): Promise<{ saved: number; waiting: number }> {
  const [orders, settings] = await Promise.all([
    prisma.order.findMany({
      where: financeCandidateWhere(conn.id, now),
      include: { lines: true },
      orderBy: { platformUpdatedAt: "asc" },
      take: BATCH,
    }),
    prisma.appSettings.findUnique({ where: { id: "default" }, select: { defaultUnitCostPhp: true } }),
  ]);
  const defaultCost = Number(settings?.defaultUnitCostPhp ?? 82);
  let saved = 0;
  let waiting = 0;
  let stop = false;
  let next = 0;

  async function worker() {
    while (!stop && next < orders.length && Date.now() < deadline) {
      const order = orders[next++];
      try {
        const figures = await fetchFigures(conn, token, order.orderSn);
        if (figures) {
          await saveFinance(conn, order, figures, defaultCost);
          saved++;
        } else {
          waiting++;
          await prisma.order.update({ where: { id: order.id }, data: { financeCheckedAt: new Date() } });
        }
      } catch (err) {
        if (isRateLimited(err)) stop = true;
        console.error(`[finance] ${conn.shopName} ${order.orderSn}`, err instanceof Error ? err.message : err);
        await prisma.order
          .update({ where: { id: order.id }, data: { financeCheckedAt: new Date() } })
          .catch(() => undefined);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, orders.length) }, worker));
  return { saved, waiting };
}
