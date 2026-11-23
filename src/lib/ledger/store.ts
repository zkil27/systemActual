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
  lines: {
    select: {
      listingId: true,
      variationId: true,
      quantity: true,
    },
  },
  packages: {
    select: {
      packageNumber: true,
      status: true,
      trackingNumber: true,
      carrier: true,
      channelId: true,
    },
  },
} satisfies Prisma.OrderSelect;

export type ExistingOrderSnapshot = Omit<OrderComparisonSnapshot, "packages"> & {
  id: string;
  orderSn: string;
  lines: Array<{
    listingId: string;
    variationId: string;
    quantity: number;
  }>;
  packages: Array<{
    packageNumber: string;
    status: string | null;
    trackingNumber: string | null;
    carrier: string | null;
    channelId: string | null;
  }>;
};

function lineSignature(lines: Array<{ listingId: string; variationId: string; quantity: number }>): string {
  return lines
    .map((l) => `${l.listingId}:${l.variationId}:${l.quantity}`)
    .sort()
    .join("|");
}

function areLinesUnchanged(
  existing: ExistingOrderSnapshot["lines"],
  incoming: NormalizedOrder["lines"]
): boolean {
  if (existing.length !== incoming.length) return false;
  return lineSignature(existing) === lineSignature(incoming);
}

function arePackagesUnchanged(
  existing: ExistingOrderSnapshot["packages"],
  incoming: NormalizedOrder["packages"]
): boolean {
  if (existing.length !== incoming.length) return false;
  const byNum = new Map(existing.map((p) => [p.packageNumber, p]));
  for (const p of incoming) {
    const prev = byNum.get(p.packageNumber);
    if (!prev) return false;
    if (prev.status !== p.status) return false;
    if (prev.carrier !== p.carrier) return false;
    if (prev.channelId !== p.channelId) return false;
    if (p.trackingNumber && prev.trackingNumber !== p.trackingNumber) return false;
  }
  return true;
}

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
 * Ensures every listing variation referenced by a batch of orders exists and
 * has a GarmentVariant, preloading already-linked rows in one query so hot
 * sync pages do zero redundant listing upserts.
 */
export async function ensureListingsForBatch(
  shopConnectionId: string,
  platform: Platform,
  orders: NormalizedOrder[],
  now: Date,
  seenListings: Set<string>
): Promise<void> {
  const pending = new Map<string, NormalizedOrder["lines"][number]>();
  const listingIds = new Set<string>();

  for (const o of orders) {
    for (const l of o.lines) {
      if (!l.listingId || !l.variationId) continue;
      const key = `${shopConnectionId}:${l.listingId}:${l.variationId}`;
      if (seenListings.has(key) || pending.has(key)) continue;
      pending.set(key, l);
      listingIds.add(l.listingId);
    }
  }
  if (!pending.size) return;

  const existing = await prisma.listingVariant.findMany({
    where: { shopConnectionId, listingId: { in: [...listingIds] } },
    select: { listingId: true, variationId: true, garmentVariantId: true },
  });
  for (const row of existing) {
    if (!row.garmentVariantId) continue;
    const key = `${shopConnectionId}:${row.listingId}:${row.variationId}`;
    seenListings.add(key);
    pending.delete(key);
  }

  for (const [key, l] of pending) {
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
    seenListings.add(key);
  }
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
    /** Set true when caller already ran `ensureListingsForBatch`. */
    skipListingEnsure?: boolean;
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

  const linesAlreadySaved = Boolean(existing && existing.lines.length > 0 && areLinesUnchanged(existing.lines, n.lines));
  const packagesUnchanged = Boolean(existing && arePackagesUnchanged(existing.packages, n.packages));

  if (existing && linesAlreadySaved && packagesUnchanged) {
    // Fast path: only order-level fields changed (e.g. status transition). One DB round-trip.
    await prisma.order.update({
      where: { id: existing.id },
      data: orderData,
    });
  } else {
    await prisma.$transaction(async (tx) => {
      const order = await tx.order.upsert({
        where: { platform_orderSn: { platform, orderSn: n.orderSn } },
        create: { shopConnectionId, platform, orderSn: n.orderSn, ...orderData },
        update: orderData,
        select: { id: true },
      });

      if (!linesAlreadySaved) {
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
      }

      if (!packagesUnchanged) {
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
      }
    });
  }

  if (!opts?.skipListingEnsure) {
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
  }

  return "saved";
}

/**
 * Saves a page of normalized orders in bounded parallel chunks after
 * preloading existing order snapshots and listing links in two batch queries.
 */
export async function saveOrderBatch(
  shopConnectionId: string,
  platform: Platform,
  batch: NormalizedOrder[],
  opts?: {
    now?: Date;
    seenListings?: Set<string>;
    concurrency?: number;
    beforeChunk?: () => void;
    onChunkDone?: (chunk: NormalizedOrder[]) => void;
  }
): Promise<{ saved: number }> {
  if (!batch.length) return { saved: 0 };
  const now = opts?.now ?? new Date();
  const seenListings = opts?.seenListings ?? new Set<string>();
  const concurrency = Math.max(1, opts?.concurrency ?? 6);

  const [existingBySn] = await Promise.all([
    loadExistingOrders(
      platform,
      batch.map((o) => o.orderSn)
    ),
    ensureListingsForBatch(shopConnectionId, platform, batch, now, seenListings),
  ]);

  let saved = 0;
  for (let i = 0; i < batch.length; i += concurrency) {
    opts?.beforeChunk?.();
    const chunk = batch.slice(i, i + concurrency);
    const outcomes = await Promise.all(
      chunk.map((order) =>
        saveOrder(shopConnectionId, platform, order, now, {
          existing: existingBySn.get(order.orderSn) ?? null,
          seenListings,
          skipListingEnsure: true,
        })
      )
    );
    for (const outcome of outcomes) {
      if (outcome === "saved") saved++;
    }
    opts?.onChunkDone?.(chunk);
  }
  return { saved };
}

/** Deletes finished orders older than the retention window. */
export async function pruneOldOrders(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ORDER_RETENTION_DAYS * 24 * 3600_000);
  const res = await prisma.order.deleteMany({
    where: { status: { in: FINAL_ORDER_STATUSES }, platformUpdatedAt: { lt: cutoff } },
  });
  return res.count;
}
