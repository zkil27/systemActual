import { Prisma, type Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { FINAL_ORDER_STATUSES, shouldApplyOrderUpdate, type NormalizedOrder } from "./normalize";

export const ORDER_RETENTION_DAYS = 90;

/**
 * Writes one order with its lines and packages. Idempotent: saving the same
 * payload twice leaves the same rows. Older updates never overwrite newer ones.
 */
export async function saveOrder(
  shopConnectionId: string,
  platform: Platform,
  n: NormalizedOrder,
  now: Date = new Date()
): Promise<"saved" | "stale"> {
  const existing = await prisma.order.findUnique({
    where: { platform_orderSn: { platform, orderSn: n.orderSn } },
    select: { id: true, platformUpdatedAt: true },
  });
  if (existing && !shouldApplyOrderUpdate(existing.platformUpdatedAt, n.updatedAt)) return "stale";

  const orderData = {
    status: n.status,
    isCod: n.isCod,
    totalPhp: new Prisma.Decimal(n.totalPhp.toFixed(2)),
    platformCreatedAt: n.createdAt,
    platformUpdatedAt: n.updatedAt,
    shippedAt: n.shippedAt,
    cancelBy: n.cancelBy,
    cancelReason: n.cancelReason,
  };

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.upsert({
      where: { platform_orderSn: { platform, orderSn: n.orderSn } },
      create: { shopConnectionId, platform, orderSn: n.orderSn, ...orderData },
      update: orderData,
      select: { id: true },
    });

    await tx.orderLine.deleteMany({ where: { orderId: order.id } });
    if (n.lines.length) {
      await tx.orderLine.createMany({
        data: n.lines.map((l) => ({
          orderId: order.id,
          listingId: l.listingId,
          variationId: l.variationId,
          name: l.name,
          variationName: l.variationName,
          imageUrl: l.imageUrl,
          quantity: l.quantity,
          unitPricePhp: new Prisma.Decimal(l.unitPricePhp.toFixed(2)),
        })),
      });
    }

    // Packages keep their row (later tasks hang shipping state on them), so
    // upsert instead of replace, and drop only packages the platform removed
    // (split / combine).
    const numbers = n.packages.map((p) => p.packageNumber);
    await tx.package.deleteMany({
      where: { orderId: order.id, ...(numbers.length ? { packageNumber: { notIn: numbers } } : {}) },
    });
    for (const p of n.packages) {
      const data = {
        trackingNumber: p.trackingNumber,
        carrier: p.carrier,
        channelId: p.channelId,
        status: p.status,
      };
      await tx.package.upsert({
        where: { orderId_packageNumber: { orderId: order.id, packageNumber: p.packageNumber } },
        create: { orderId: order.id, packageNumber: p.packageNumber, ...data },
        update: {
          ...data,
          // Never erase a tracking number we already have.
          trackingNumber: p.trackingNumber ?? undefined,
        },
      });
    }
  });

  for (const l of n.lines) {
    if (!l.listingId || !l.variationId) continue;
    const listing = {
      name: l.name,
      variationName: l.variationName,
      imageUrl: l.imageUrl,
      lastSeenAt: now,
    };
    await prisma.listingVariant.upsert({
      where: {
        shopConnectionId_listingId_variationId: {
          shopConnectionId,
          listingId: l.listingId,
          variationId: l.variationId,
        },
      },
      create: { shopConnectionId, platform, listingId: l.listingId, variationId: l.variationId, ...listing },
      update: { ...listing, imageUrl: l.imageUrl ?? undefined },
    });
  }

  return "saved";
}

/** Deletes finished orders older than the retention window. */
export async function pruneOldOrders(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ORDER_RETENTION_DAYS * 24 * 3600_000);
  const res = await prisma.order.deleteMany({
    where: { status: { in: FINAL_ORDER_STATUSES }, platformUpdatedAt: { lt: cutoff } },
  });
  return res.count;
}
