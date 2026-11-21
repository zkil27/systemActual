import crypto from "crypto";
import { Prisma, StockReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { committedUnitsByListing } from "@/lib/catalog/garments";
import { COMMITTED_ORDER_STATUSES } from "@/lib/catalog/variants";
import { hasLeftWarehouse, RESTOCK_CONDITIONS, shipMovements } from "./rules";

/** Pieces on the shelf per garment variant (only variants with a starting count). */
export async function onShelfByVariant(variantIds?: string[]): Promise<Map<string, number>> {
  const rows = await prisma.stockMovement.groupBy({
    by: ["garmentVariantId"],
    where: variantIds ? { garmentVariantId: { in: variantIds } } : undefined,
    _sum: { delta: true },
  });
  return new Map(rows.map((r) => [r.garmentVariantId, r._sum.delta ?? 0]));
}

/** Pieces on unshipped orders per garment variant, across both shops. */
export async function committedByVariant(): Promise<Map<string, number>> {
  const [byListing, listings] = await Promise.all([
    committedUnitsByListing(),
    prisma.listingVariant.findMany({
      where: { garmentVariantId: { not: null } },
      select: { platform: true, listingId: true, variationId: true, garmentVariantId: true },
    }),
  ]);
  const map = new Map<string, number>();
  for (const l of listings) {
    const units = byListing.get(`${l.platform}:${l.listingId}:${l.variationId}`) ?? 0;
    if (units) map.set(l.garmentVariantId!, (map.get(l.garmentVariantId!) ?? 0) + units);
  }
  return map;
}

/**
 * The owner sets how many pieces are on the shelf. The first time it's the
 * starting count; after that it's a recount, recorded as the difference.
 */
export async function setShelfCount(variantId: string, count: number, now: Date = new Date()) {
  const n = Math.max(0, Math.floor(count));
  const variant = await prisma.garmentVariant.findUniqueOrThrow({ where: { id: variantId } });
  if (!variant.startingStockSetAt) {
    await prisma.$transaction([
      prisma.stockMovement.deleteMany({ where: { garmentVariantId: variantId } }),
      prisma.stockMovement.create({
        data: { garmentVariantId: variantId, delta: n, reason: StockReason.INITIAL, sourceKey: `initial:${variantId}:${now.getTime()}` },
      }),
      prisma.garmentVariant.update({ where: { id: variantId }, data: { startingStock: n, startingStockSetAt: now } }),
    ]);
    return;
  }
  const current = (await onShelfByVariant([variantId])).get(variantId) ?? 0;
  if (current === n) return;
  await prisma.stockMovement.create({
    data: {
      garmentVariantId: variantId,
      delta: n - current,
      reason: StockReason.ADJUSTMENT,
      sourceKey: `adjust:${variantId}:${crypto.randomUUID()}`,
      note: `Recount: ${current} → ${n}`,
    },
  });
}

/** Linking/merging changes what a variant's stock means, so its count starts over. */
export async function resetStock(variantIds: string[]) {
  if (!variantIds.length) return;
  await prisma.$transaction([
    prisma.stockMovement.deleteMany({ where: { garmentVariantId: { in: variantIds } } }),
    prisma.garmentVariant.updateMany({
      where: { id: { in: variantIds } },
      data: { startingStock: null, startingStockSetAt: null },
    }),
  ]);
}

export class StockNotStartedError extends Error {}

/**
 * Staff recorded a supplier delivery. `clientKey` comes from the phone, so a
 * double tap or a retry on a bad connection is only counted once.
 */
export async function recordSupplierDelivery(opts: {
  variantId: string;
  quantity: number;
  staffMemberId: string;
  clientKey: string;
}) {
  const variant = await prisma.garmentVariant.findUniqueOrThrow({ where: { id: opts.variantId } });
  // Before the owner's first count, a delivery would be counted twice (once here, once in her count).
  if (!variant.startingStockSetAt) throw new StockNotStartedError("Ask the owner to set the starting count first.");
  try {
    await prisma.stockMovement.create({
      data: {
        garmentVariantId: opts.variantId,
        delta: Math.abs(Math.floor(opts.quantity)),
        reason: StockReason.SUPPLIER_IN,
        sourceKey: `in:${opts.clientKey}`,
        staffMemberId: opts.staffMemberId,
      },
    });
    return { duplicate: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { duplicate: true };
    throw err;
  }
}

/** A return scanned as sellable goes back on the shelf, once, per item. */
export async function recordGoodReturn(parcelId: string) {
  const parcel = await prisma.returnParcel.findUnique({ where: { id: parcelId } });
  if (!parcel?.physicalCondition || !RESTOCK_CONDITIONS.has(parcel.physicalCondition)) return 0;
  const items = Array.isArray(parcel.itemsJson)
    ? (parcel.itemsJson as Array<{ listingId?: string | null; variationId?: string | null; quantity?: number }>)
    : [];
  let added = 0;
  for (const item of items) {
    if (!item.listingId || !item.variationId) continue;
    const lv = await prisma.listingVariant.findUnique({
      where: {
        shopConnectionId_listingId_variationId: {
          shopConnectionId: parcel.shopConnectionId,
          listingId: item.listingId,
          variationId: item.variationId,
        },
      },
      include: { garmentVariant: true },
    });
    if (!lv?.garmentVariant?.startingStockSetAt) continue;
    const res = await prisma.stockMovement.createMany({
      data: [
        {
          garmentVariantId: lv.garmentVariant.id,
          delta: Math.max(1, item.quantity ?? 1),
          reason: StockReason.RETURN_GOOD,
          sourceKey: `return:${parcel.id}:${item.listingId}:${item.variationId}`,
        },
      ],
      skipDuplicates: true,
    });
    added += res.count;
  }
  return added;
}

/**
 * Subtracts stock for orders that left the warehouse since the last tick.
 * Each order is processed once; cancellations before pickup only clear it.
 */
export async function recordShipments(deadline: number, batch = 200) {
  const COMMITTED = [...new Set(Object.values(COMMITTED_ORDER_STATUSES).flat())];
  const orders = await prisma.order.findMany({
    where: { stockRecordedAt: null, status: { notIn: COMMITTED } },
    include: { lines: true },
    orderBy: { platformUpdatedAt: "asc" },
    take: batch,
  });
  let movements = 0;
  for (const order of orders) {
    if (Date.now() >= deadline) break;
    if (hasLeftWarehouse(order.platform, order.status, order.shippedAt)) {
      const listings = await prisma.listingVariant.findMany({
        where: {
          shopConnectionId: order.shopConnectionId,
          OR: order.lines.map((l) => ({ listingId: l.listingId, variationId: l.variationId })),
        },
        include: { garmentVariant: { select: { id: true, startingStockSetAt: true } } },
      });
      const byKey = new Map(listings.map((l) => [`${l.listingId}:${l.variationId}`, l.garmentVariant]));
      const data = shipMovements(
        order,
        order.lines.map((l) => ({
          listingId: l.listingId,
          variationId: l.variationId,
          quantity: l.quantity,
          variant: byKey.get(`${l.listingId}:${l.variationId}`) ?? null,
        }))
      ).map((m) => ({ ...m, reason: StockReason.SHIPPED }));
      if (data.length) {
        movements += (await prisma.stockMovement.createMany({ data, skipDuplicates: true })).count;
      }
    }
    await prisma.order.update({ where: { id: order.id }, data: { stockRecordedAt: new Date() } });
  }
  return { orders: orders.length, movements };
}
