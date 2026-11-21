import { Platform, PrintJobStatus, WaveItemStatus, WaveStatus, type Prisma } from "@prisma/client";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { prisma } from "@/lib/prisma";
import { MIN_SUFFIX_LENGTH } from "@/lib/returns/scan-match";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { getManilaDayBounds, getManilaTodayStr } from "@/lib/time";

export type OutboundScanStatus =
  | "BLOCKED_CANCELLED"
  | "BLOCKED_WRONG_COURIER"
  | "ALREADY_PACKED"
  | "NEEDS_MULTI_CONFIRM"
  | "AUTO_PACK_OK"
  | "READY_TO_PACK";

export interface OutboundScanEvaluation {
  status: OutboundScanStatus;
  courierMismatch: boolean;
  expectedCourier: string | null;
}

/** Printed parcels still waiting for rider pickup after 3 hours trigger an alert. */
export const UNPICKED_ALERT_AGE_MS = 3 * 60 * 60_000;

/**
 * Returns true if an outbound order has been cancelled or has an active buyer
 * cancellation request and must never be packed or handed over to a courier.
 */
export function isOrderCancelledForPacking(order: {
  status: string;
  cancelRequested: boolean;
}): boolean {
  if (order.cancelRequested) return true;
  const upper = order.status.trim().toUpperCase();
  return upper === "CANCELLED" || upper === "IN_CANCEL";
}

/**
 * Returns true when an arranged/printed order is still sitting in the warehouse
 * waiting for the courier rider to scan/pick it up.
 *
 * Important platform difference:
 * - Shopee sets `shippedAt` from `pickup_done_time` (actual rider scan).
 * - TikTok sets `shippedAt` from `rts_time` (when shipment was arranged, BEFORE
 *   pickup), so TikTok must be checked via `status === "AWAITING_COLLECTION"`.
 */
export function isAwaitingRiderPickup(order: {
  platform: Platform | string;
  status: string;
  shippedAt: Date | null;
}): boolean {
  const s = order.status.trim().toUpperCase();
  if (order.platform === Platform.TIKTOK || order.platform === "TIKTOK") {
    return s === "AWAITING_COLLECTION";
  }
  return (s === "PROCESSED" || s === "READY_TO_SHIP") && order.shippedAt === null;
}

/** Last 6 characters of tracking number (or orderSn) for fast sticker matching. */
export function lastTrackingDigits(
  trackingNumber: string | null | undefined,
  orderSn: string
): string {
  const raw = (trackingNumber?.trim() || orderSn.trim()).toUpperCase();
  return raw.length > 6 ? raw.slice(-6) : raw;
}

/**
 * Evaluates a scanned outbound package against cancellation state, active
 * courier-sack lock, prior packing state, and single- vs multi-piece rules.
 */
export function evaluateOutboundScan(
  pkg: {
    isCancelled: boolean;
    courier: string;
    totalPieces: number;
    lineCount: number;
    alreadyPacked: boolean;
  },
  opts?: {
    courierLock?: string | null;
    autoPackSingle?: boolean;
  }
): OutboundScanEvaluation {
  const rawLock = opts?.courierLock?.trim() ?? "";
  const expectedCourier =
    rawLock && rawLock.toUpperCase() !== "ALL"
      ? normalizeCourierName(rawLock)
      : null;
  const actualCourier = normalizeCourierName(pkg.courier);
  const courierMismatch = Boolean(
    expectedCourier && actualCourier !== expectedCourier
  );

  if (pkg.isCancelled) {
    return { status: "BLOCKED_CANCELLED", courierMismatch, expectedCourier };
  }
  if (courierMismatch) {
    return { status: "BLOCKED_WRONG_COURIER", courierMismatch: true, expectedCourier };
  }
  if (pkg.alreadyPacked) {
    return { status: "ALREADY_PACKED", courierMismatch: false, expectedCourier };
  }
  if (pkg.totalPieces > 1 || pkg.lineCount > 1) {
    return { status: "NEEDS_MULTI_CONFIRM", courierMismatch: false, expectedCourier };
  }
  if (opts?.autoPackSingle) {
    return { status: "AUTO_PACK_OK", courierMismatch: false, expectedCourier };
  }
  return { status: "READY_TO_PACK", courierMismatch: false, expectedCourier };
}

export const OUTBOUND_PACKAGE_INCLUDE = {
  packedByStaff: { select: { name: true } },
  order: {
    include: {
      lines: {
        select: {
          id: true,
          listingId: true,
          variationId: true,
          name: true,
          variationName: true,
          imageUrl: true,
          quantity: true,
        },
      },
    },
  },
  waveItems: {
    orderBy: { updatedAt: "desc" as const },
    take: 1,
    select: {
      status: true,
      position: true,
      wave: { select: { id: true, parcelCount: true } },
    },
  },
} satisfies Prisma.PackageInclude;

export type LoadedOutboundPackage = Prisma.PackageGetPayload<{
  include: typeof OUTBOUND_PACKAGE_INCLUDE;
}>;

/**
 * Resolves a scanner session to a StaffMember ID (using the first active staff
 * profile when the store owner uses /scan directly).
 */
export async function resolveActorStaffMemberId(
  session:
    | { actorType: "staff"; staffId: string; name: string }
    | { actorType: "owner"; userId: string; name: string }
): Promise<string | null> {
  if (session.actorType === "staff") {
    return session.staffId;
  }
  const firstStaff = await prisma.staffMember.findFirst({
    where: { active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return firstStaff?.id ?? null;
}

/**
 * Printed/queued wave parcels from the last 48h that were cancelled after
 * printing and have NOT yet been tapped "Pulled" (`package.packedAt` is null).
 */
export function cancelledToPullWhere(now: Date = new Date()): Prisma.WaveItemWhereInput {
  const cutoff = new Date(now.getTime() - 48 * 60 * 60_000);
  return {
    status: { in: [WaveItemStatus.LABEL_READY, WaveItemStatus.PRINTED] },
    updatedAt: { gte: cutoff },
    wave: { status: { in: [WaveStatus.RUNNING, WaveStatus.DONE] } },
    package: {
      packedAt: null,
      order: {
        OR: [
          { cancelRequested: true },
          { status: { in: ["CANCELLED", "IN_CANCEL"] } },
        ],
      },
    },
  };
}

/**
 * Printed wave parcels from today (printed >= `minAgeMs` ago) that are still
 * awaiting rider pickup on Shopee (`PROCESSED`, `shippedAt: null`) or TikTok
 * (`AWAITING_COLLECTION`), catching forgotten pouches or jammed sticker rolls.
 */
export function unpickedPrintedWhere(
  now: Date = new Date(),
  minAgeMs: number = UNPICKED_ALERT_AGE_MS
): Prisma.WaveItemWhereInput {
  const { start, end } = getManilaDayBounds(getManilaTodayStr());
  const olderThan = new Date(now.getTime() - minAgeMs);
  return {
    status: WaveItemStatus.PRINTED,
    updatedAt: { lte: olderThan },
    wave: {
      createdAt: { gte: start, lt: end },
      status: { in: [WaveStatus.RUNNING, WaveStatus.DONE] },
    },
    package: {
      order: {
        cancelRequested: false,
        OR: [
          {
            platform: Platform.SHOPEE,
            status: { in: ["PROCESSED", "READY_TO_SHIP"] },
            shippedAt: null,
          },
          {
            platform: Platform.TIKTOK,
            status: "AWAITING_COLLECTION",
          },
        ],
      },
    },
  };
}

/** Shared filter for printed/label-ready parcels from today's waves not yet packed. */
export function unpackedWaveItemWhere(start: Date, end: Date): Prisma.WaveItemWhereInput {
  return {
    status: { in: ["LABEL_READY", "PRINTED"] },
    wave: {
      createdAt: { gte: start, lt: end },
      status: { in: ["RUNNING", "DONE"] },
    },
    package: {
      packedAt: null,
      order: {
        cancelRequested: false,
        status: { notIn: ["CANCELLED", "IN_CANCEL"] },
      },
    },
  };
}

export async function getPackerStats(
  session:
    | { actorType: "staff"; staffId: string; name: string }
    | { actorType: "owner"; userId: string; name: string }
): Promise<{
  todayPackedCount: number;
  unpackedWaveCount: number;
  cancelledToPullCount: number;
  unpickedOverdueCount: number;
}> {
  const now = new Date();
  const { start, end } = getManilaDayBounds(getManilaTodayStr());
  const packedWhere: Prisma.PackageWhereInput =
    session.actorType === "staff"
      ? { packedByStaffId: session.staffId, packedAt: { gte: start, lt: end } }
      : { packedAt: { gte: start, lt: end } };

  const [todayPackedCount, unpackedWaveCount, cancelledToPullCount, unpickedOverdueCount] =
    await Promise.all([
      prisma.package.count({ where: packedWhere }),
      prisma.waveItem.count({ where: unpackedWaveItemWhere(start, end) }),
      prisma.waveItem.count({ where: cancelledToPullWhere(now) }),
      prisma.waveItem.count({ where: unpickedPrintedWhere(now) }),
    ]);

  return {
    todayPackedCount,
    unpackedWaveCount,
    cancelledToPullCount,
    unpickedOverdueCount,
  };
}

/**
 * Called by Shopee/TikTok webhooks when an order is cancelled or requests
 * cancellation. If a label is already queued or printed:
 *  - Cancels any still-QUEUED single-parcel PrintJob so it doesn't waste a sticker.
 *  - Sends an immediate Telegram alert with the last 6 digits of tracking number,
 *    order number, courier, and items so packers pull it off the table without scanning.
 */
export async function notifyCancelledPrintedOrder(
  platform: Platform,
  orderSn: string
): Promise<boolean> {
  if (!orderSn) return false;

  const waveItems = await prisma.waveItem.findMany({
    where: {
      platform,
      status: { in: [WaveItemStatus.LABEL_READY, WaveItemStatus.PRINTED] },
      package: {
        packedAt: null,
        order: { orderSn },
      },
    },
    include: {
      package: { include: OUTBOUND_PACKAGE_INCLUDE },
    },
    orderBy: { updatedAt: "desc" },
    take: 3,
  });

  if (waveItems.length === 0) return false;

  // Cancel any still-queued single-parcel label jobs before the PC claims them.
  const pkgIds = waveItems.map((w) => w.packageId);
  await prisma.printJob.updateMany({
    where: {
      status: PrintJobStatus.QUEUED,
      packageId: { in: pkgIds },
      batchPackageIds: { isEmpty: true },
    },
    data: {
      status: PrintJobStatus.FAILED,
      error: "Buyer cancelled before printing",
    },
  });

  const first = waveItems[0];
  const pkg = first.package;
  const courier = normalizeCourierName(pkg.carrier);
  const tracking = pkg.trackingNumber || pkg.order.orderSn;
  const last6 = lastTrackingDigits(pkg.trackingNumber, pkg.order.orderSn);
  const itemsText = pkg.order.lines
    .map((l) => `${l.quantity}× ${l.name}${l.variationName ? ` (${l.variationName})` : ""}`)
    .join(", ");

  const msg = [
    `PULL CANCELLED LABEL — DO NOT SHIP`,
    `Tracking ends in: ${last6} (${courier})`,
    `Full tracking: ${tracking}`,
    `Order: ${pkg.order.orderSn}`,
    itemsText ? `Item: ${itemsText}` : null,
    `Pull this label/pouch off the table and tap "Pulled" on /scan.`,
  ]
    .filter(Boolean)
    .join("\n");

  await notifyOwnerTelegram(msg);
  return true;
}

/**
 * Fills missing OrderLine imageUrl values from ListingVariant / Garment thumbnails
 * so zero-SKU fashion lines always show photos at the packing table.
 */
export async function enrichPackageLineImages(
  packages: LoadedOutboundPackage[]
): Promise<LoadedOutboundPackage[]> {
  const missingLines = packages.flatMap((pkg) =>
    pkg.order.lines
      .filter((l) => !l.imageUrl)
      .map((l) => ({
        shopConnectionId: pkg.order.shopConnectionId,
        listingId: l.listingId,
        variationId: l.variationId,
      }))
  );
  if (missingLines.length === 0) return packages;

  const shopIds = [...new Set(missingLines.map((m) => m.shopConnectionId))];
  const listingIds = [...new Set(missingLines.map((m) => m.listingId))];
  const variants = await prisma.listingVariant.findMany({
    where: {
      shopConnectionId: { in: shopIds },
      listingId: { in: listingIds },
    },
    select: {
      shopConnectionId: true,
      listingId: true,
      variationId: true,
      imageUrl: true,
      garmentVariant: {
        select: {
          garment: { select: { imageUrl: true } },
        },
      },
    },
  });

  const imgByKey = new Map<string, string>();
  for (const v of variants) {
    const img = v.imageUrl ?? v.garmentVariant?.garment?.imageUrl ?? null;
    if (img) {
      imgByKey.set(`${v.shopConnectionId}:${v.listingId}:${v.variationId}`, img);
    }
  }

  return packages.map((pkg) => ({
    ...pkg,
    order: {
      ...pkg.order,
      lines: pkg.order.lines.map((l) => ({
        ...l,
        imageUrl:
          l.imageUrl ??
          imgByKey.get(
            `${pkg.order.shopConnectionId}:${l.listingId}:${l.variationId}`
          ) ??
          null,
      })),
    },
  }));
}

export type OutboundLookupResult =
  | { kind: "one"; pkg: LoadedOutboundPackage }
  | { kind: "pick"; packages: LoadedOutboundPackage[] }
  | { kind: "ambiguous" }
  | { kind: "none" };

export async function findOutboundPackagesByCode(
  code: string
): Promise<OutboundLookupResult> {
  const exact = await prisma.package.findMany({
    where: {
      OR: [
        { trackingNumber: { equals: code, mode: "insensitive" } },
        { order: { orderSn: { equals: code, mode: "insensitive" } } },
      ],
    },
    include: OUTBOUND_PACKAGE_INCLUDE,
    orderBy: { order: { platformCreatedAt: "desc" } },
    take: 6,
  });

  if (exact.length === 1) {
    const [enriched] = await enrichPackageLineImages(exact);
    return { kind: "one", pkg: enriched };
  }
  if (exact.length > 1) {
    const sorted = [...exact].sort(
      (a, b) => Number(Boolean(a.packedAt)) - Number(Boolean(b.packedAt))
    );
    return { kind: "pick", packages: await enrichPackageLineImages(sorted) };
  }

  if (code.length >= MIN_SUFFIX_LENGTH) {
    const suffix = await prisma.package.findMany({
      where: {
        OR: [
          { trackingNumber: { endsWith: code, mode: "insensitive" } },
          { order: { orderSn: { endsWith: code, mode: "insensitive" } } },
        ],
      },
      include: OUTBOUND_PACKAGE_INCLUDE,
      take: 2,
    });
    if (suffix.length === 1) {
      const [enriched] = await enrichPackageLineImages(suffix);
      return { kind: "one", pkg: enriched };
    }
    if (suffix.length > 1) {
      return { kind: "ambiguous" };
    }
  }

  // Fallback: search recent printed/active wave parcels by item name or partial code
  // so packers can find and reprint a jammed/missing label without having the barcode.
  if (code.length >= 3) {
    const cutoff = new Date(Date.now() - 48 * 60 * 60_000);
    const byItem = await prisma.package.findMany({
      where: {
        waveItems: {
          some: {
            updatedAt: { gte: cutoff },
            status: { in: [WaveItemStatus.LABEL_READY, WaveItemStatus.PRINTED] },
          },
        },
        OR: [
          { trackingNumber: { endsWith: code, mode: "insensitive" } },
          { order: { orderSn: { endsWith: code, mode: "insensitive" } } },
          {
            order: {
              lines: {
                some: {
                  OR: [
                    { name: { contains: code, mode: "insensitive" } },
                    { variationName: { contains: code, mode: "insensitive" } },
                  ],
                },
              },
            },
          },
        ],
      },
      include: OUTBOUND_PACKAGE_INCLUDE,
      orderBy: { order: { platformCreatedAt: "desc" } },
      take: 8,
    });
    if (byItem.length === 1) {
      const [enriched] = await enrichPackageLineImages(byItem);
      return { kind: "one", pkg: enriched };
    }
    if (byItem.length > 1) {
      return { kind: "pick", packages: await enrichPackageLineImages(byItem) };
    }
  }

  return { kind: "none" };
}
