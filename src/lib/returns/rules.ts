import { DigitalStatus, DisputeStatus, Prisma, ReturnCategory } from "@prisma/client";
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
  /** Owner closed the case by hand ("Found" / "Settled"). Optional so older selects still type-check. */
  resolvedAt?: Date | null;
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
  if (!isExpectedAtDoor(p) || !p.courierReturnedToSellerAt || p.physicallyReceivedAt || p.resolvedAt) {
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
    !p.resolvedAt &&
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
    resolvedAt: null,
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
    resolvedAt: null,
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

/** Dispute deadlines inside this window count as "due soon" on Home, Returns and Telegram. */
export const URGENT_DEADLINE_WINDOW_MS = 24 * 3600_000;
/** A deadline that passed less than this long ago still shows, so the owner sees it slipped. */
export const URGENT_DEADLINE_GRACE_MS = 2 * 3600_000;

/** Open disputes whose platform deadline is within the next 24h (or just passed). */
export function urgentDeadlineWhere(now: Date = new Date()): Prisma.ReturnParcelWhereInput {
  return {
    disputeDeadlineAt: {
      gt: new Date(now.getTime() - URGENT_DEADLINE_GRACE_MS),
      lte: new Date(now.getTime() + URGENT_DEADLINE_WINDOW_MS),
    },
    resolvedAt: null,
    disputeStatus: DisputeStatus.NONE,
    digitalStatus: { notIn: [DigitalStatus.CANCELLED_RETURN, DigitalStatus.RESOLVED_REFUNDED] },
  };
}

export function isUrgentDeadline(
  p: {
    disputeDeadlineAt: Date | null;
    resolvedAt?: Date | null;
    disputeStatus?: string | null;
    digitalStatus?: DigitalStatus;
  },
  now: Date = new Date()
): boolean {
  if (!p.disputeDeadlineAt || p.resolvedAt) return false;
  if (p.disputeStatus && p.disputeStatus !== "NONE") return false;
  if (p.digitalStatus === DigitalStatus.CANCELLED_RETURN || p.digitalStatus === DigitalStatus.RESOLVED_REFUNDED) {
    return false;
  }
  const t = p.disputeDeadlineAt.getTime();
  return t > now.getTime() - URGENT_DEADLINE_GRACE_MS && t <= now.getTime() + URGENT_DEADLINE_WINDOW_MS;
}

// ---------------------------------------------------------------- Item-by-item check

/**
 * Parcels checked item by item keep piece counts; older ones only have a
 * parcel condition. Each rule below reads the counts when present and falls
 * back to the condition, so old and new scans land in the same lists.
 */
export interface ItemCheckRuleInput {
  physicalCondition: string | null;
  piecesMissing?: number | null;
  piecesWrong?: number | null;
}

/** Some pieces never came back. */
export function isPartialReturn(p: ItemCheckRuleInput): boolean {
  if (p.piecesMissing !== null && p.piecesMissing !== undefined) return p.piecesMissing > 0;
  return p.physicalCondition === "MISSING_PIECE";
}

/** Something other than what we sent came back. */
export function isWrongItemReturn(p: ItemCheckRuleInput): boolean {
  if (p.piecesWrong !== null && p.piecesWrong !== undefined) return p.piecesWrong > 0;
  return p.physicalCondition === "WRONG_OR_SWAPPED_ITEM";
}

export const partialReturnWhere: Prisma.ReturnParcelWhereInput = {
  OR: [{ piecesMissing: { gt: 0 } }, { piecesMissing: null, physicalCondition: "MISSING_PIECE" }],
};

export const wrongItemWhere: Prisma.ReturnParcelWhereInput = {
  OR: [{ piecesWrong: { gt: 0 } }, { piecesWrong: null, physicalCondition: "WRONG_OR_SWAPPED_ITEM" }],
};

/**
 * The buyer's refund is paid but nothing was scanned back in, and the owner
 * hasn't closed it. Split for the owner into "courier says returned" (also
 * Missing) and "no courier update yet", never blended.
 */
export function isRefundedNotBack(
  p: Pick<
    ParcelRuleInput,
    "category" | "digitalStatus" | "expectsPhysicalReturn" | "physicallyReceivedAt" | "resolvedAt" | "digitalReturnTaggedAt"
  >,
  since?: Date | null
): boolean {
  if (since && (!p.digitalReturnTaggedAt || p.digitalReturnTaggedAt.getTime() < since.getTime())) return false;
  return (
    p.category === ReturnCategory.RETURN_REFUND &&
    p.expectsPhysicalReturn &&
    p.digitalStatus === DigitalStatus.RESOLVED_REFUNDED &&
    !p.physicallyReceivedAt &&
    !p.resolvedAt
  );
}

export function refundedNotBackWhere(since?: Date | null): Prisma.ReturnParcelWhereInput {
  return {
    category: ReturnCategory.RETURN_REFUND,
    expectsPhysicalReturn: true,
    digitalStatus: DigitalStatus.RESOLVED_REFUNDED,
    physicallyReceivedAt: null,
    resolvedAt: null,
    ...(since ? { digitalReturnTaggedAt: { gte: since } } : {}),
  };
}
