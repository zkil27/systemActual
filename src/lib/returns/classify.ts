import { DigitalStatus, ReturnCategory } from "@prisma/client";

/**
 * Every platform field and status value that decides which bucket a parcel is
 * in lives here, as data. The PH values marked "confirm" come from the public
 * API docs and must be checked against live payloads at cutover (Task 14);
 * change them here only.
 */

// ---------------------------------------------------------------- Shopee returns

/** return_refund_request_type */
export const SHOPEE_REQUEST_TYPE = { NORMAL: 0, IN_TRANSIT: 1, RETURN_ON_THE_SPOT: 2 } as const;

/** return_solution */
export const SHOPEE_SOLUTION_REFUND_ONLY = 1;

/** Shopee return `status` → our digital status. Unknown values fall back to RETURN_REQUESTED. */
const SHOPEE_RETURN_STATUS: Record<string, DigitalStatus> = {
  REQUESTED: DigitalStatus.RETURN_REQUESTED,
  ACCEPTED: DigitalStatus.RETURN_IN_TRANSIT,
  PROCESSING: DigitalStatus.RETURN_IN_TRANSIT,
  JUDGING: DigitalStatus.DISPUTED,
  SELLER_DISPUTE: DigitalStatus.DISPUTED,
  REFUND_PAID: DigitalStatus.RESOLVED_REFUNDED,
  CANCELLED: DigitalStatus.CANCELLED_RETURN,
  CLOSED: DigitalStatus.CANCELLED_RETURN,
};

/** reverse_logistics_status values meaning the parcel reached the seller. Confirm. */
const SHOPEE_REVERSE_DELIVERED = new Set([
  "LOGISTICS_DELIVERY_DONE",
  "LOGISTICS_DELIVERED",
  "DELIVERED",
  "RETURN_DELIVERED",
]);

export interface ShopeeReturnClass {
  category: ReturnCategory;
  expectsPhysicalReturn: boolean;
  returnRequestType: number | null;
  returnType: "RETURN_AND_REFUND" | "REFUND_ONLY";
  digitalStatus: DigitalStatus;
}

export function classifyShopeeReturn(r: {
  return_refund_request_type?: unknown;
  return_solution?: unknown;
  needs_logistics?: unknown;
  status?: unknown;
}): ShopeeReturnClass {
  const type = r.return_refund_request_type === undefined || r.return_refund_request_type === null
    ? null
    : Number(r.return_refund_request_type);
  const refundOnly = Number(r.return_solution) === SHOPEE_SOLUTION_REFUND_ONLY || r.needs_logistics === false;
  const isRos = type === SHOPEE_REQUEST_TYPE.RETURN_ON_THE_SPOT;
  const status = SHOPEE_RETURN_STATUS[String(r.status ?? "").toUpperCase()] ?? DigitalStatus.RETURN_REQUESTED;

  return {
    // Return on the Spot: the buyer refused at the door; the rider brings it
    // back on the original waybill, so the warehouse treats it as a failed delivery.
    category: isRos ? ReturnCategory.FAILED_DELIVERY : ReturnCategory.RETURN_REFUND,
    expectsPhysicalReturn: isRos || !refundOnly,
    returnRequestType: type,
    returnType: refundOnly && !isRos ? "REFUND_ONLY" : "RETURN_AND_REFUND",
    digitalStatus:
      isRos && status === DigitalStatus.RETURN_REQUESTED ? DigitalStatus.RETURNING_TO_SELLER : status,
  };
}

/** Normal returns come back on a new waybill; ROS and in-transit on the original. */
export function shopeeReturnUsesNewWaybill(returnRequestType: number | null): boolean {
  return returnRequestType === null || returnRequestType === SHOPEE_REQUEST_TYPE.NORMAL;
}

export function isShopeeReverseDelivered(status: unknown): boolean {
  return SHOPEE_REVERSE_DELIVERED.has(String(status ?? "").toUpperCase());
}

// ---------------------------------------------------------------- TikTok returns

const TIKTOK_RETURN_STATUS: Record<string, DigitalStatus> = {
  RETURN_OR_REFUND_REQUEST_PENDING: DigitalStatus.RETURN_REQUESTED,
  AWAITING_BUYER_SHIP: DigitalStatus.RETURN_REQUESTED,
  AWAITING_BUYER_RESPONSE: DigitalStatus.RETURN_REQUESTED,
  REPLACEMENT_REQUEST_PENDING: DigitalStatus.RETURN_REQUESTED,
  EXCHANGE_REQUEST_PENDING: DigitalStatus.RETURN_REQUESTED,
  BUYER_SHIPPED_ITEM: DigitalStatus.RETURN_IN_TRANSIT,
  REJECT_RECEIVE_PACKAGE: DigitalStatus.DISPUTED,
  RETURN_OR_REFUND_REQUEST_SUCCESS: DigitalStatus.RESOLVED_REFUNDED,
  RETURN_OR_REFUND_REQUEST_COMPLETE: DigitalStatus.RESOLVED_REFUNDED,
  REPLACEMENT_REQUEST_COMPLETE: DigitalStatus.RESOLVED_REFUNDED,
  REPLACEMENT_REQUEST_REFUND_SUCCESS: DigitalStatus.RESOLVED_REFUNDED,
  EXCHANGE_REQUEST_COMPLETE: DigitalStatus.RESOLVED_REFUNDED,
  EXCHANGE_REQUEST_REFUND_SUCCESS: DigitalStatus.RESOLVED_REFUNDED,
  REFUND_OR_RETURN_REQUEST_REJECT: DigitalStatus.CANCELLED_RETURN,
  RETURN_OR_REFUND_REQUEST_CANCEL: DigitalStatus.CANCELLED_RETURN,
  REPLACEMENT_REQUEST_REJECT: DigitalStatus.CANCELLED_RETURN,
  REPLACEMENT_REQUEST_CANCEL: DigitalStatus.CANCELLED_RETURN,
  EXCHANGE_REQUEST_CANCEL: DigitalStatus.CANCELLED_RETURN,
};

/**
 * Statuses only reached after the seller has the returned parcel in hand (or the
 * platform accepted it on delivery). TikTok has no seller-side reverse
 * tracking call, so this is the best "courier delivered it" signal. Confirm.
 */
const TIKTOK_SELLER_HAS_PARCEL = new Set([
  "REJECT_RECEIVE_PACKAGE",
  "RETURN_OR_REFUND_REQUEST_SUCCESS",
  "RETURN_OR_REFUND_REQUEST_COMPLETE",
]);

export interface TikTokReturnClass {
  category: ReturnCategory;
  expectsPhysicalReturn: boolean;
  returnType: string;
  digitalStatus: DigitalStatus;
  courierDelivered: boolean;
}

export function classifyTikTokReturn(r: { return_type?: unknown; return_status?: unknown }): TikTokReturnClass {
  const returnType = String(r.return_type ?? "RETURN_AND_REFUND").toUpperCase();
  const status = String(r.return_status ?? "").toUpperCase();
  const expectsPhysicalReturn = returnType !== "REFUND";
  return {
    category: ReturnCategory.RETURN_REFUND,
    expectsPhysicalReturn,
    returnType,
    digitalStatus: TIKTOK_RETURN_STATUS[status] ?? DigitalStatus.RETURN_REQUESTED,
    courierDelivered: expectsPhysicalReturn && TIKTOK_SELLER_HAS_PARCEL.has(status),
  };
}

// ---------------------------------------------------------------- Failed deliveries (from the order ledger)

/** Shopee package logistics_status meaning the parcel is lost, not coming back. Confirm. */
const SHOPEE_LOST = new Set(["LOGISTICS_LOST"]);

/**
 * An order that was cancelled after the courier had it is a parcel on its way
 * back. This doesn't depend on cancel-reason wording, which varies by market.
 *  - Shopee: CANCELLED with pickup_done_time (actual courier pickup).
 *  - TikTok: CANCELLED with rts_time. rts_time is when shipment was arranged,
 *    so the caller must confirm with tracking that the courier picked it up.
 */
export function isFailedDeliveryCandidate(order: {
  status: string;
  shippedAt: Date | null;
  packageStatuses: Array<string | null>;
}): boolean {
  if (order.status.toUpperCase() !== "CANCELLED" || !order.shippedAt) return false;
  return !order.packageStatuses.some((s) => s && SHOPEE_LOST.has(s.toUpperCase()));
}

// ---------------------------------------------------------------- Courier tracking text

/** Tracking event wording/statuses meaning "delivered back to the seller". Confirm with live data. */
const RETURNED_TO_SELLER_PATTERNS = [
  /returned to (the )?seller/i,
  /return(ed)? delivered/i,
  /delivered back/i,
  /delivered to (the )?seller/i,
  /successfully returned/i,
  /naibalik/i, // Tagalog: "returned"
  /^LOGISTICS_RETURN_DONE$/i,
  /^RETURNED$/i,
];

/** Wording meaning delivery failed / heading back, used for the tagged time. */
const DELIVERY_FAILED_PATTERNS = [
  /delivery (attempt )?(failed|unsuccessful)/i,
  /failed delivery/i,
  /returning to (the )?seller/i,
  /return to sender/i,
  /refused/i,
  /^LOGISTICS_DELIVERY_FAILED$/i,
];

export interface TrackingEvent {
  time: Date;
  description: string;
  status?: string | null;
}

function matches(patterns: RegExp[], e: TrackingEvent): boolean {
  return patterns.some((p) => p.test(e.description) || (e.status ? p.test(e.status) : false));
}

/** Earliest event meaning delivered back to the seller, if any. */
export function findReturnedToSeller(events: TrackingEvent[]): Date | null {
  const hits = events.filter((e) => matches(RETURNED_TO_SELLER_PATTERNS, e)).map((e) => e.time.getTime());
  return hits.length ? new Date(Math.min(...hits)) : null;
}

/** Earliest event meaning delivery failed / sent back, if any. */
export function findDeliveryFailed(events: TrackingEvent[]): Date | null {
  const hits = events.filter((e) => matches(DELIVERY_FAILED_PATTERNS, e)).map((e) => e.time.getTime());
  return hits.length ? new Date(Math.min(...hits)) : null;
}
