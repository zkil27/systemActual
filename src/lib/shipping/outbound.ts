import type { Prisma } from "@prisma/client";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { prisma } from "@/lib/prisma";
import { MIN_SUFFIX_LENGTH } from "@/lib/returns/scan-match";
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
): Promise<{ todayPackedCount: number; unpackedWaveCount: number }> {
  const { start, end } = getManilaDayBounds(getManilaTodayStr());
  const packedWhere: Prisma.PackageWhereInput =
    session.actorType === "staff"
      ? { packedByStaffId: session.staffId, packedAt: { gte: start, lt: end } }
      : { packedAt: { gte: start, lt: end } };

  const [todayPackedCount, unpackedWaveCount] = await Promise.all([
    prisma.package.count({ where: packedWhere }),
    prisma.waveItem.count({ where: unpackedWaveItemWhere(start, end) }),
  ]);

  return { todayPackedCount, unpackedWaveCount };
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

  return { kind: "none" };
}
