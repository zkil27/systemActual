import crypto from "crypto";
import { Prisma, StockReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { committedUnitsByListing } from "@/lib/catalog/garments";
import { COMMITTED_ORDER_STATUSES, computeStartingStock } from "@/lib/catalog/variants";
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

async function ensureVariantStartingStock(variant: {
  id: string;
  startingStockSetAt: Date | null;
  listings: Array<{
    platform: import("@prisma/client").Platform;
    listingId: string;
    variationId: string;
    availableStock: number | null;
  }>;
}) {
  if (variant.startingStockSetAt) return;
  let units = 0;
  if (variant.listings.length > 0) {
    const listingIds = [...new Set(variant.listings.map((l) => l.listingId))];
    const platforms = [...new Set(variant.listings.map((l) => l.platform))];
    const groups = await Promise.all(
      platforms.map((platform) =>
        prisma.orderLine.groupBy({
          by: ["listingId", "variationId"],
          where: {
            listingId: { in: listingIds },
            order: { platform, status: { in: COMMITTED_ORDER_STATUSES[platform] } },
          },
          _sum: { quantity: true },
        })
      )
    );
    const committed = new Map<string, number>();
    platforms.forEach((platform, idx) => {
      for (const r of groups[idx]) {
        committed.set(`${platform}:${r.listingId}:${r.variationId}`, r._sum.quantity ?? 0);
      }
    });
    units = variant.listings.reduce(
      (n, l) => n + (committed.get(`${l.platform}:${l.listingId}:${l.variationId}`) ?? 0),
      0
    );
  }
  const suggested = computeStartingStock(variant.listings, units).suggested ?? 0;
  await setShelfCount(variant.id, suggested);
}

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
  const variant = await prisma.garmentVariant.findUniqueOrThrow({
    where: { id: opts.variantId },
    include: { listings: { select: { platform: true, listingId: true, variationId: true, availableStock: true } } },
  });
  await ensureVariantStartingStock(variant);
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

export type StaffStockReportMode = "EMPTY_SHELF" | "DEFECTIVE";

/**
 * Staff reported an empty shelf (0 left) or damaged/stained pieces found on the rack.
 * Deducts shelf stock immediately so shops stop overselling; idempotent on `clientKey`.
 */
export async function recordStaffStockReport(opts: {
  variantId: string;
  mode: StaffStockReportMode;
  quantity?: number;
  note?: string;
  staffMemberId: string;
  staffName: string;
  clientKey: string;
}): Promise<{
  duplicate: boolean;
  garmentName: string;
  variantLabel: string;
  previousOnShelf: number;
  newOnShelf: number;
  delta: number;
}> {
  const variant = await prisma.garmentVariant.findUniqueOrThrow({
    where: { id: opts.variantId },
    include: {
      garment: { select: { name: true } },
      listings: { select: { platform: true, listingId: true, variationId: true, availableStock: true } },
    },
  });
  await ensureVariantStartingStock(variant);
  const previousOnShelf = (await onShelfByVariant([opts.variantId])).get(opts.variantId) ?? 0;

  const cleanNote = opts.note?.trim() || "";
  let delta: number;
  let sourceKey: string;
  let note: string;

  if (opts.mode === "EMPTY_SHELF") {
    delta = -Math.max(0, previousOnShelf);
    sourceKey = `empty:${opts.clientKey}`;
    note = cleanNote
      ? `Shelf empty (0): ${cleanNote}`
      : `Shelf empty (0 left) reported by ${opts.staffName}`;
  } else {
    const deduct = Math.min(
      Math.max(0, previousOnShelf),
      Math.max(1, Math.floor(opts.quantity ?? 1))
    );
    delta = -deduct;
    sourceKey = `defect:${opts.clientKey}`;
    note = cleanNote
      ? `Damaged on shelf (-${deduct}): ${cleanNote}`
      : `Damaged on shelf (-${deduct}) reported by ${opts.staffName}`;
  }

  const newOnShelf = Math.max(0, previousOnShelf + delta);
  try {
    await prisma.stockMovement.create({
      data: {
        garmentVariantId: opts.variantId,
        delta,
        reason: StockReason.ADJUSTMENT,
        sourceKey,
        staffMemberId: opts.staffMemberId,
        note,
      },
    });
    return {
      duplicate: false,
      garmentName: variant.garment.name,
      variantLabel: variant.label,
      previousOnShelf,
      newOnShelf,
      delta,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        duplicate: true,
        garmentName: variant.garment.name,
        variantLabel: variant.label,
        previousOnShelf,
        newOnShelf: previousOnShelf,
        delta: 0,
      };
    }
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
  if (!orders.length) return { orders: 0, movements: 0 };

  const shippedOrders = orders.filter((o) => hasLeftWarehouse(o.platform, o.status, o.shippedAt));
  const byKey = new Map<string, { id: string; startingStockSetAt: Date | null } | null>();
  if (shippedOrders.length > 0) {
    const shopIds = [...new Set(shippedOrders.map((o) => o.shopConnectionId))];
    const listingIds = [...new Set(shippedOrders.flatMap((o) => o.lines.map((l) => l.listingId)))];
    if (listingIds.length > 0) {
      const listings = await prisma.listingVariant.findMany({
        where: {
          shopConnectionId: { in: shopIds },
          listingId: { in: listingIds },
        },
        select: {
          shopConnectionId: true,
          listingId: true,
          variationId: true,
          garmentVariant: { select: { id: true, startingStockSetAt: true } },
        },
      });
      for (const l of listings) {
        byKey.set(`${l.shopConnectionId}:${l.listingId}:${l.variationId}`, l.garmentVariant);
      }
    }
  }

  let movements = 0;
  const processedIds: string[] = [];
  const allMovements: Array<{
    garmentVariantId: string;
    delta: number;
    sourceKey: string;
    reason: StockReason;
  }> = [];

  for (const order of orders) {
    if (Date.now() >= deadline) break;
    if (hasLeftWarehouse(order.platform, order.status, order.shippedAt)) {
      const data = shipMovements(
        order,
        order.lines.map((l) => ({
          listingId: l.listingId,
          variationId: l.variationId,
          quantity: l.quantity,
          variant: byKey.get(`${order.shopConnectionId}:${l.listingId}:${l.variationId}`) ?? null,
        }))
      ).map((m) => ({ ...m, reason: StockReason.SHIPPED }));
      allMovements.push(...data);
    }
    processedIds.push(order.id);
  }

  if (allMovements.length > 0) {
    movements = (await prisma.stockMovement.createMany({ data: allMovements, skipDuplicates: true })).count;
  }
  if (processedIds.length > 0) {
    await prisma.order.updateMany({
      where: { id: { in: processedIds } },
      data: { stockRecordedAt: new Date() },
    });
  }
  return { orders: orders.length, movements };
}
