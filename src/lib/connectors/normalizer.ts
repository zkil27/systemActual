import {
  DigitalStatus,
  Platform,
  Prisma,
  ReturnCategory,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { returnDedupeKey } from "@/lib/returns/keys";

export interface NormalizedReturnItem {
  name: string;
  variationName: string | null;
  quantity: number;
  imageUrl: string | null;
  listingId?: string | null;
  variationId?: string | null;
}

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
  /** Every line item. itemSummary/variationName/image describe the first one. */
  items?: NormalizedReturnItem[];
  orderTotalPhp: number;
  estimatedUnitCostPhp?: number;
  orderCreatedAt?: Date | null;
  digitalReturnTaggedAt?: Date | null;
  courierReturnedToSellerAt?: Date | null;
  expectsPhysicalReturn?: boolean;
  returnRequestType?: number | null;
  returnType?: string | null;
  source: string;
  rawStatus: string;
  eventDescription?: string | null;
  eventTimestamp: Date;
  rawPayloadJson?: unknown;
}

/**
 * Text-based fallback classifier, used only for spreadsheet imports, which
 * have no structured return-type fields. API data is classified from platform
 * fields in src/lib/returns/classify.ts instead.
 */
export function classifyReturnCategory(input: {
  platform: Platform;
  hasBuyerReturnSn?: boolean;
  rawStatus?: string | null;
  reason?: string | null;
}): ReturnCategory {
  const status = (input.rawStatus ?? "").toUpperCase();
  const reason = (input.reason ?? "").toLowerCase();

  // Whole-word matches only: "rts" must not match "shirts", "skirts" or "shorts".
  const failedDeliveryStatus =
    /(FAILED_DELIVERY|DELIVERY_FAILED|UNABLE_TO_DELIVER|UNDELIVERED|RETURNING_TO_SELLER|RETURNED?_TO_SELLER|COD_REFUSED)/.test(
      status
    ) || /\bRTS\b/.test(status);
  const failedDeliveryReason =
    /(failed delivery|delivery failed|buyer refused|refused cod|recipient unreachable|cannot contact|wrong address|unclaimed|delivery attempt|return to seller)/.test(
      reason
    ) || /\brts\b/.test(reason);

  const hasBuyerClaimReason =
    /(wrong size|wrong item|damaged|defective|missing|change of mind|changed mind|not as described|buyer return|refund)/.test(
      reason
    );

  if (hasBuyerClaimReason) return ReturnCategory.RETURN_REFUND;
  if (failedDeliveryStatus || failedDeliveryReason) return ReturnCategory.FAILED_DELIVERY;
  if (
    input.hasBuyerReturnSn ||
    /(RETURN_REQUEST|REFUND|AFTER_SALE|BUYER_RETURN)/.test(status)
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

/** Statuses that a later, less-informed poll must not move a parcel back from. */
const PROGRESS_RANK: Partial<Record<DigitalStatus, number>> = {
  [DigitalStatus.FAILED_DELIVERY_TAGGED]: 0,
  [DigitalStatus.RETURN_REQUESTED]: 0,
  [DigitalStatus.RETURNING_TO_SELLER]: 1,
  [DigitalStatus.RETURN_IN_TRANSIT]: 1,
  [DigitalStatus.COURIER_RETURNED]: 2,
};

export function mergeDigitalStatus(existing: DigitalStatus | undefined, incoming: DigitalStatus): DigitalStatus {
  if (!existing) return incoming;
  const a = PROGRESS_RANK[existing];
  const b = PROGRESS_RANK[incoming];
  // Only the "on its way" ladder is ordered; outcomes (refunded, disputed,
  // cancelled) always win, since they come from the platform's own decision.
  if (a !== undefined && b !== undefined && b < a) return existing;
  return incoming;
}

/**
 * Idempotently upserts a return parcel and appends an audit event. Keyed by
 * returnDedupeKey(): one row per buyer return, one per failed-delivery order.
 */
export async function upsertNormalizedReturn(
  input: NormalizedReturnInput,
  opts?: { defaultUnitCostPhp?: number }
) {
  let defaultUnitCost = opts?.defaultUnitCostPhp;
  if (defaultUnitCost === undefined && input.estimatedUnitCostPhp === undefined) {
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    defaultUnitCost = Number(settings?.defaultUnitCostPhp ?? 82);
  }
  const items = input.items?.length ? input.items : null;
  const qty = Math.max(1, items ? items.reduce((n, i) => n + i.quantity, 0) : input.quantity ?? 1);
  const unitCostTotal =
    input.estimatedUnitCostPhp !== undefined
      ? input.estimatedUnitCostPhp
      : (defaultUnitCost ?? 82) * qty;

  const dedupeKey = returnDedupeKey(input.category, input.returnSn, input.orderSn);
  const where = { platform_dedupeKey: { platform: input.platform, dedupeKey } };
  const existing = await prisma.returnParcel.findUnique({ where });

  const courierReturnedToSellerAt = pickEarliestTimestamp(
    existing?.courierReturnedToSellerAt,
    input.courierReturnedToSellerAt ??
      (input.digitalStatus === DigitalStatus.COURIER_RETURNED
        ? input.eventTimestamp
        : null)
  );

  const rawTaggedAt = pickEarliestTimestamp(
    existing?.digitalReturnTaggedAt,
    input.digitalReturnTaggedAt ?? input.eventTimestamp
  );

  const digitalReturnTaggedAt =
    rawTaggedAt &&
    courierReturnedToSellerAt &&
    rawTaggedAt.getTime() > courierReturnedToSellerAt.getTime()
      ? courierReturnedToSellerAt
      : rawTaggedAt;

  const digitalStatus = mergeDigitalStatus(
    existing?.digitalStatus,
    courierReturnedToSellerAt && input.digitalStatus !== DigitalStatus.RESOLVED_REFUNDED &&
      input.digitalStatus !== DigitalStatus.DISPUTED && input.digitalStatus !== DigitalStatus.CANCELLED_RETURN
      ? DigitalStatus.COURIER_RETURNED
      : input.digitalStatus
  );

  const courier = normalizeCourierName(input.courier);
  const itemsJson = items ? (items as unknown as Prisma.InputJsonValue) : undefined;

  const parcel = await prisma.returnParcel.upsert({
    where,
    create: {
      shopConnectionId: input.shopConnectionId,
      platform: input.platform,
      orderSn: input.orderSn,
      dedupeKey,
      returnSn: input.returnSn ?? null,
      forwardTrackingNumber: input.forwardTrackingNumber?.trim() || null,
      rtsTrackingNumber: input.rtsTrackingNumber?.trim() || null,
      courier,
      category: input.category,
      digitalStatus,
      returnReason: input.returnReason ?? null,
      disputeDeadlineAt: input.disputeDeadlineAt ?? null,
      itemSummary: input.itemSummary.trim() || "Fashion Item",
      variationName: input.variationName?.trim() || null,
      quantity: qty,
      itemImageUrl: input.itemImageUrl ?? null,
      itemsJson: itemsJson ?? Prisma.JsonNull,
      orderTotalPhp: new Prisma.Decimal(input.orderTotalPhp.toFixed(2)),
      estimatedUnitCostPhp: new Prisma.Decimal(unitCostTotal.toFixed(2)),
      orderCreatedAt: input.orderCreatedAt ?? null,
      digitalReturnTaggedAt,
      courierReturnedToSellerAt,
      expectsPhysicalReturn: input.expectsPhysicalReturn ?? true,
      returnRequestType: input.returnRequestType ?? null,
      returnType: input.returnType ?? null,
    },
    update: {
      returnSn: input.returnSn ?? existing?.returnSn ?? null,
      forwardTrackingNumber:
        input.forwardTrackingNumber?.trim() || existing?.forwardTrackingNumber || null,
      rtsTrackingNumber:
        input.rtsTrackingNumber?.trim() || existing?.rtsTrackingNumber || null,
      courier: courier !== "Other Courier" ? courier : existing?.courier ?? courier,
      digitalStatus,
      returnReason: input.returnReason ?? existing?.returnReason ?? null,
      disputeDeadlineAt: input.disputeDeadlineAt ?? existing?.disputeDeadlineAt ?? null,
      itemSummary:
        input.itemSummary && input.itemSummary !== "Fashion Item"
          ? input.itemSummary
          : existing?.itemSummary ?? "Fashion Item",
      variationName: input.variationName ?? existing?.variationName ?? null,
      quantity: qty,
      itemImageUrl: input.itemImageUrl ?? existing?.itemImageUrl ?? null,
      ...(itemsJson ? { itemsJson } : {}),
      digitalReturnTaggedAt,
      courierReturnedToSellerAt,
      ...(input.expectsPhysicalReturn !== undefined ? { expectsPhysicalReturn: input.expectsPhysicalReturn } : {}),
      ...(input.returnRequestType !== undefined ? { returnRequestType: input.returnRequestType } : {}),
      ...(input.returnType !== undefined ? { returnType: input.returnType } : {}),
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
      // Omit rawPayloadJson to keep Supabase Free (<500 MB) lean.
      rawPayloadJson: Prisma.JsonNull,
    },
    update: {},
  });

  return parcel;
}
