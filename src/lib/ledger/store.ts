import { Prisma, type Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  FINAL_ORDER_STATUSES,
  isOrderUnchanged,
  shouldApplyOrderUpdate,
  type NormalizedOrder,
  type OrderComparisonSnapshot,
} from "./normalize";
import { ensureGarmentFor } from "@/lib/catalog/garments";

export const ORDER_RETENTION_DAYS = 90;

const existingSelect = {
  id: true,
  orderSn: true,
  platformUpdatedAt: true,
  status: true,
  cancelRequested: true,
  shippedAt: true,
  packages: { select: { packageNumber: true, status: true, trackingNumber: true } },
} satisfies Prisma.OrderSelect;

export type ExistingOrderSnapshot = OrderComparisonSnapshot & { id: string; orderSn: string };

/** Loads existing snapshots for a page of orders in one query so overlap skips take milliseconds. */
export async function loadExistingOrders(
  platform: Platform,
  orderSns: string[]
): Promise<Map<string, ExistingOrderSnapshot>> {
  if (!orderSns.length) return new Map();
  const rows = await prisma.order.findMany({
    where: { platform, orderSn: { in: orderSns } },
    select: existingSelect,
  });
  return new Map(rows.map((r) => [r.orderSn, r]));
}

/**
 * Writes one order with its lines and packages. Idempotent: saving the same
 * payload twice leaves the same rows. Older or unchanged updates are skipped.
 */
export async function saveOrder(
  shopConnectionId: string,
  platform: Platform,
  n: NormalizedOrder,
  now: Date = new Date(),
  opts?: {
    /** Pass `null` when pre-checked as absent, or the snapshot when present. */
    existing?: ExistingOrderSnapshot | null;
    /** Listings already ensured in this sync pass (avoids redundant upserts per order). */
    seenListings?: Set<string>;
  }
): Promise<"saved" | "stale" | "unchanged"> {
  const existing =
    opts && "existing" in opts
      ? opts.existing ?? null
      : await prisma.order.findUnique({
          where: { platform_orderSn: { platform, orderSn: n.orderSn } },
          select: existingSelect,
        });
  if (existing && !shouldApplyOrderUpdate(existing.platformUpdatedAt, n.updatedAt)) return "stale";
  if (existing && isOrderUnchanged(existing, n)) return "unchanged";

  const orderData = {
    status: n.status,
    isCod: n.isCod,
    totalPhp: new Prisma.Decimal(n.totalPhp.toFixed(2)),
    platformCreatedAt: n.createdAt,
    platformUpdatedAt: n.updatedAt,
    shippedAt: n.shippedAt,
    cancelBy: n.cancelBy,
    cancelReason: n.cancelReason,
    cancelRequested: n.cancelRequested,
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
    const listingKey = `${shopConnectionId}:${l.listingId}:${l.variationId}`;
    if (opts?.seenListings?.has(listingKey)) continue;
    const listing = {
      name: l.name,
      variationName: l.variationName,
      imageUrl: l.imageUrl,
      lastSeenAt: now,
    };
    const lv = await prisma.listingVariant.upsert({
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
    if (!lv.garmentVariantId) await ensureGarmentFor(lv);
    opts?.seenListings?.add(listingKey);
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
