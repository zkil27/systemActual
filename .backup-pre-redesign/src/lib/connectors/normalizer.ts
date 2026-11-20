import {
  DigitalStatus,
  Platform,
  Prisma,
  ReturnCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";

export interface NormalizedReturnInput {
  shopConnectionId: string;
  platform: Platform;
  orderSn: string;
  returnSn?: string | null;
  forwardTrackingNumber?: string | null;
  rtsTrackingNumber?: string | null;
  courier: string;
  category: ReturnCategory;
  digitalStatus: DigitalStatus;
  returnReason?: string | null;
  disputeDeadlineAt?: Date | null;
  itemSummary: string;
  variationName?: string | null;
  quantity?: number;
  itemImageUrl?: string | null;
  itemsJson?: unknown;
  orderTotalPhp: number;
  estimatedUnitCostPhp?: number;
  orderCreatedAt?: Date | null;
  digitalReturnTaggedAt?: Date | null;
  courierReturnedToSellerAt?: Date | null;
  source: string;
  rawStatus: string;
  eventDescription?: string | null;
  eventTimestamp: Date;
  rawPayloadJson?: unknown;
}

/**
 * Pure classification helper separating Failed Delivery (COD / Undelivered RTS)
 * from Buyer Return / Refund.
 */
export function classifyReturnCategory(input: {
  platform: Platform;
  hasBuyerReturnSn?: boolean;
  rawStatus?: string | null;
  reason?: string | null;
}): ReturnCategory {
  const status = (input.rawStatus ?? "").toUpperCase();
  const reason = (input.reason ?? "").toLowerCase();

  // Explicit failed-delivery / COD refusal markers win even if platform created an internal reverse ID
  const failedDeliveryPatterns = [
    "FAILED_DELIVERY",
    "DELIVERY_FAILED",
    "LOGISTICS_DELIVERY_FAILED",
    "UNABLE_TO_DELIVER",
    "UNDELIVERED",
    "RETURNING_TO_SELLER",
    "RETURN_TO_SELLER",
    "RETURNED_TO_SELLER",
    "COD_REFUSED",
    "RTS",
  ];
  const failedReasonPatterns = [
    "failed delivery",
    "delivery failed",
    "buyer refused",
    "refused cod",
    "recipient unreachable",
    "cannot contact",
    "wrong address",
    "unclaimed",
    "delivery attempt",
    "return to seller",
    "rts",
  ];

  const hasBuyerClaimReason =
    reason.includes("wrong size") ||
    reason.includes("wrong item") ||
    reason.includes("damaged") ||
    reason.includes("defective") ||
    reason.includes("missing") ||
    reason.includes("change of mind") ||
    reason.includes("changed mind") ||
    reason.includes("not as described") ||
    reason.includes("buyer return") ||
    reason.includes("refund");

  if (hasBuyerClaimReason) return ReturnCategory.RETURN_REFUND;

  if (
    failedDeliveryPatterns.some((p) => status.includes(p)) ||
    failedReasonPatterns.some((p) => reason.includes(p))
  ) {
    return ReturnCategory.FAILED_DELIVERY;
  }

  if (
    input.hasBuyerReturnSn ||
    status.includes("RETURN_REQUEST") ||
    status.includes("REFUND") ||
    status.includes("AFTER_SALE") ||
    status.includes("BUYER_RETURN")
  ) {
    return ReturnCategory.RETURN_REFUND;
  }

  return ReturnCategory.FAILED_DELIVERY;
}

export function normalizeCourierName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  const lower = s.toLowerCase();
  if (!s) return "Other Courier";
  if (lower.includes("spx") || lower.includes("shopee xpress") || lower.includes("shopee express")) {
    return "SPX Express";
  }
  if (lower.includes("j&t") || lower.includes("jnt") || lower.includes("j and t")) {
    return "J&T Express";
  }
  if (lower.includes("flash")) return "Flash Express";
  if (lower.includes("ninjavan") || lower.includes("ninja van")) return "Ninja Van";
  if (lower.includes("yunda") || lower.includes("yto")) return "YTO Express";
  if (lower.includes("lbc")) return "LBC Express";
  return s;
}

/**
 * Picks the earliest valid timestamp so later re-polls never push an older
 * driver-tagged return into "today".
 */
export function pickEarliestTimestamp(
  existing: Date | null | undefined,
  incoming: Date | null | undefined
): Date | null {
  if (!existing) return incoming ?? null;
  if (!incoming) return existing;
  return existing.getTime() <= incoming.getTime() ? existing : incoming;
}

export function isDiscrepancyParcel(parcel: {
  courierReturnedToSellerAt: Date | null;
  physicallyReceivedAt: Date | null;
}): boolean {
  return Boolean(parcel.courierReturnedToSellerAt && !parcel.physicallyReceivedAt);
}

/**
 * Idempotently upserts a normalized return parcel and appends an audit event.
 */
export async function upsertNormalizedReturn(input: NormalizedReturnInput) {
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const defaultUnitCost = Number(settings?.defaultUnitCostPhp ?? 82);
  const qty = Math.max(1, input.quantity ?? 1);
  const unitCostTotal =
    input.estimatedUnitCostPhp !== undefined
      ? input.estimatedUnitCostPhp
      : defaultUnitCost * qty;

  const existing = await prisma.returnParcel.findUnique({
    where: {
      platform_orderSn_category: {
        platform: input.platform,
        orderSn: input.orderSn,
        category: input.category,
      },
    },
  });

  const digitalReturnTaggedAt = pickEarliestTimestamp(
    existing?.digitalReturnTaggedAt,
    input.digitalReturnTaggedAt ?? input.eventTimestamp
  );

  const courierReturnedToSellerAt = pickEarliestTimestamp(
    existing?.courierReturnedToSellerAt,
    input.courierReturnedToSellerAt ??
      (input.digitalStatus === DigitalStatus.COURIER_RETURNED
        ? input.eventTimestamp
        : null)
  );

  const courier = normalizeCourierName(input.courier);

  const parcel = await prisma.returnParcel.upsert({
    where: {
      platform_orderSn_category: {
        platform: input.platform,
        orderSn: input.orderSn,
        category: input.category,
      },
    },
    create: {
      shopConnectionId: input.shopConnectionId,
      platform: input.platform,
      orderSn: input.orderSn,
      returnSn: input.returnSn ?? null,
      forwardTrackingNumber: input.forwardTrackingNumber?.trim() || null,
      rtsTrackingNumber: input.rtsTrackingNumber?.trim() || null,
      courier,
      category: input.category,
      digitalStatus: input.digitalStatus,
      returnReason: input.returnReason ?? null,
      disputeDeadlineAt: input.disputeDeadlineAt ?? null,
      itemSummary: input.itemSummary.trim() || "Fashion Item",
      variationName: input.variationName?.trim() || null,
      quantity: qty,
      itemImageUrl: input.itemImageUrl ?? null,
      itemsJson: input.itemsJson
        ? (input.itemsJson as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      orderTotalPhp: new Prisma.Decimal(input.orderTotalPhp.toFixed(2)),
      estimatedUnitCostPhp: new Prisma.Decimal(unitCostTotal.toFixed(2)),
      orderCreatedAt: input.orderCreatedAt ?? null,
      digitalReturnTaggedAt,
      courierReturnedToSellerAt,
    },
    update: {
      returnSn: input.returnSn ?? existing?.returnSn ?? null,
      forwardTrackingNumber:
        input.forwardTrackingNumber?.trim() || existing?.forwardTrackingNumber || null,
      rtsTrackingNumber:
        input.rtsTrackingNumber?.trim() || existing?.rtsTrackingNumber || null,
      courier: courier !== "Other Courier" ? courier : existing?.courier ?? courier,
      digitalStatus: input.digitalStatus,
      returnReason: input.returnReason ?? existing?.returnReason ?? null,
      disputeDeadlineAt: input.disputeDeadlineAt ?? existing?.disputeDeadlineAt ?? null,
      itemSummary:
        input.itemSummary && input.itemSummary !== "Fashion Item"
          ? input.itemSummary
          : existing?.itemSummary ?? "Fashion Item",
      variationName: input.variationName ?? existing?.variationName ?? null,
      quantity: qty,
      itemImageUrl: input.itemImageUrl ?? existing?.itemImageUrl ?? null,
      digitalReturnTaggedAt,
      courierReturnedToSellerAt,
    },
  });

  await prisma.returnEvent.upsert({
    where: {
      parcelId_source_rawStatus_eventTimestamp: {
        parcelId: parcel.id,
        source: input.source,
        rawStatus: input.rawStatus,
        eventTimestamp: input.eventTimestamp,
      },
    },
    create: {
      parcelId: parcel.id,
      source: input.source,
      rawStatus: input.rawStatus,
      description: input.eventDescription ?? null,
      eventTimestamp: input.eventTimestamp,
      rawPayloadJson: input.rawPayloadJson
        ? (input.rawPayloadJson as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    },
    update: {},
  });

  return parcel;
}
