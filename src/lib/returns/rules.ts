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

/** The courier says it was delivered back, but nobody scanned it in. */
export function isMissingDiscrepancy(p: ParcelRuleInput): boolean {
  return isExpectedAtDoor(p) && Boolean(p.courierReturnedToSellerAt && !p.physicallyReceivedAt);
}

/** A failed delivery still on its way back after `overdueDays`. */
export function isOverdueRts(p: ParcelRuleInput, overdueDays: number, now: Date = new Date()): boolean {
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

export const missingWhere: Prisma.ReturnParcelWhereInput = {
  ...expectedWhere,
  courierReturnedToSellerAt: { not: null },
  physicallyReceivedAt: null,
};

export function overdueWhere(overdueDays: number, now: Date = new Date()): Prisma.ReturnParcelWhereInput {
  return {
    ...expectedWhere,
    category: ReturnCategory.FAILED_DELIVERY,
    physicallyReceivedAt: null,
    courierReturnedToSellerAt: null,
    digitalReturnTaggedAt: { lte: new Date(now.getTime() - overdueDays * 24 * 3600_000) },
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
