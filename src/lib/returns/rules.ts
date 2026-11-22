import { DigitalStatus, Prisma, ReturnCategory } from "@prisma/client";
import { daysSince } from "@/lib/time";

/**
 * One definition of "expected at the door", "missing" and "overdue", used by
 * the dashboard, returns list, Telegram and the scanner.
 *
 * Refund-only returns (nothing is shipped back) and cancelled/rejected
 * requests are never expected, so they can't show up as missing or overdue.
 */
export interface ParcelRuleInput {
  category: ReturnCategory;
  digitalStatus: DigitalStatus;
  expectsPhysicalReturn: boolean;
  digitalReturnTaggedAt: Date | null;
  courierReturnedToSellerAt: Date | null;
  physicallyReceivedAt: Date | null;
}

export function isExpectedAtDoor(p: Pick<ParcelRuleInput, "expectsPhysicalReturn" | "digitalStatus">): boolean {
  return p.expectsPhysicalReturn && p.digitalStatus !== DigitalStatus.CANCELLED_RETURN;
}

/**
 * Soft go-live cutoff: returns before `startAt` stay in Postgres for history,
 * but only parcels with return activity at or after `startAt` — or still open /
 * on the way back to the warehouse — count in active views.
 */
export function isActiveSince(
  p: Pick<
    ParcelRuleInput,
    | "expectsPhysicalReturn"
    | "digitalStatus"
    | "digitalReturnTaggedAt"
    | "courierReturnedToSellerAt"
    | "physicallyReceivedAt"
  >,
  startAt?: Date | null
): boolean {
  if (!startAt) return true;
  const t = startAt.getTime();
  if (p.courierReturnedToSellerAt && p.courierReturnedToSellerAt.getTime() >= t) return true;
  if (p.physicallyReceivedAt && p.physicallyReceivedAt.getTime() >= t) return true;
  if (!p.courierReturnedToSellerAt && p.digitalReturnTaggedAt && p.digitalReturnTaggedAt.getTime() >= t) {
    return true;
  }
  if (
    isExpectedAtDoor(p) &&
    !p.courierReturnedToSellerAt &&
    !p.physicallyReceivedAt &&
    p.digitalStatus !== DigitalStatus.RESOLVED_REFUNDED
  ) {
    return true;
  }
  return false;
}

export function activeSinceWhere(startAt?: Date | null): Prisma.ReturnParcelWhereInput | null {
  if (!startAt) return null;
  return {
    OR: [
      { courierReturnedToSellerAt: { gte: startAt } },
      { physicallyReceivedAt: { gte: startAt } },
      { courierReturnedToSellerAt: null, digitalReturnTaggedAt: { gte: startAt } },
      {
        expectsPhysicalReturn: true,
        courierReturnedToSellerAt: null,
        physicallyReceivedAt: null,
        digitalStatus: {
          notIn: [DigitalStatus.CANCELLED_RETURN, DigitalStatus.RESOLVED_REFUNDED],
        },
      },
    ],
  };
}

/** The courier says it was delivered back, but nobody scanned it in (since `missingSinceAt` if set). */
export function isMissingDiscrepancy(p: ParcelRuleInput, missingSinceAt?: Date | null): boolean {
  if (!isExpectedAtDoor(p) || !p.courierReturnedToSellerAt || p.physicallyReceivedAt) {
    return false;
  }
  if (missingSinceAt && p.courierReturnedToSellerAt.getTime() < missingSinceAt.getTime()) {
    return false;
  }
  return true;
}

/** A failed delivery still on its way back after `overdueDays` (tagged on/after `startAt` if set). */
export function isOverdueRts(
  p: ParcelRuleInput,
  overdueDays: number,
  now: Date = new Date(),
  startAt?: Date | null
): boolean {
  if (startAt && (!p.digitalReturnTaggedAt || p.digitalReturnTaggedAt.getTime() < startAt.getTime())) {
    return false;
  }
  return (
    isExpectedAtDoor(p) &&
    p.category === ReturnCategory.FAILED_DELIVERY &&
    !p.physicallyReceivedAt &&
    !p.courierReturnedToSellerAt &&
    daysSince(p.digitalReturnTaggedAt, now) >= overdueDays
  );
}

const expectedWhere: Prisma.ReturnParcelWhereInput = {
  expectsPhysicalReturn: true,
  digitalStatus: { not: DigitalStatus.CANCELLED_RETURN },
};

export const returnedToSellerWhere: Prisma.ReturnParcelWhereInput = {
  ...expectedWhere,
  courierReturnedToSellerAt: { not: null },
};

export function arrivedWhere(startAt?: Date | null): Prisma.ReturnParcelWhereInput {
  return {
    physicallyReceivedAt: startAt ? { gte: startAt } : { not: null },
  };
}

export function missingWhere(missingSinceAt?: Date | null): Prisma.ReturnParcelWhereInput {
  return {
    ...expectedWhere,
    courierReturnedToSellerAt: missingSinceAt ? { gte: missingSinceAt } : { not: null },
    physicallyReceivedAt: null,
  };
}

export function overdueWhere(
  overdueDays: number,
  now: Date = new Date(),
  startAt?: Date | null
): Prisma.ReturnParcelWhereInput {
  const cutoff = new Date(now.getTime() - overdueDays * 24 * 3600_000);
  return {
    ...expectedWhere,
    category: ReturnCategory.FAILED_DELIVERY,
    physicallyReceivedAt: null,
    courierReturnedToSellerAt: null,
    digitalReturnTaggedAt: startAt ? { lte: cutoff, gte: startAt } : { lte: cutoff },
  };
}

/**
 * Money at risk for one parcel: the item cost (₱82 × quantity by default, set
 * when the parcel is created) plus the return shipping the seller is charged.
 * Refund-only returns have no return shipment, only the item.
 */
export function costAtRiskPhp(
  p: { estimatedUnitCostPhp: number; expectsPhysicalReturn: boolean },
  returnShippingEstimatePhp: number
): number {
  return p.estimatedUnitCostPhp + (p.expectsPhysicalReturn ? returnShippingEstimatePhp : 0);
}
