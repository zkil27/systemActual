import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import type { NormalizedReturnInput, NormalizedReturnItem } from "@/lib/connectors/normalizer";
import {
  classifyShopeeReturn,
  classifyTikTokReturn,
  findDeliveryFailed,
  findReturnedToSeller,
  isShopeeReverseDelivered,
  shopeeReturnUsesNewWaybill,
  type TrackingEvent,
} from "./classify";

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};
const unix = (v: unknown): Date | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
};
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

function summarize(items: NormalizedReturnItem[]) {
  const first = items[0];
  return {
    itemSummary: first ? (items.length > 1 ? `${first.name} +${items.length - 1} more` : first.name) : "Fashion Item",
    variationName: first?.variationName ?? null,
    itemImageUrl: first?.imageUrl ?? null,
    quantity: Math.max(1, items.reduce((n, i) => n + i.quantity, 0)),
  };
}

/** Merge per-unit lines (TikTok) into one item per variation. */
function mergeItems(items: NormalizedReturnItem[]): NormalizedReturnItem[] {
  const map = new Map<string, NormalizedReturnItem>();
  for (const it of items) {
    const key = `${it.listingId ?? it.name}:${it.variationId ?? it.variationName ?? ""}`;
    const prev = map.get(key);
    if (prev) prev.quantity += it.quantity;
    else map.set(key, { ...it });
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- Shopee

/** Fields of v2.returns.get_reverse_tracking_info we use. */
export interface ShopeeReverseInfo {
  tracking_number?: unknown;
  reverse_logistics_status?: unknown;
  reverse_logistics_update_time?: unknown;
  validation_type?: unknown;
  rts_tracking_number?: unknown;
  post_return_logistics_status?: unknown;
  post_return_logistics_update_time?: unknown;
}

export interface ShopeeReturnContext {
  shopConnectionId: string;
  /** Original waybill, from the order ledger. ROS and in-transit returns come back on it. */
  forwardTrackingNumber: string | null;
  orderCarrier: string | null;
  /** model_id → variation name, from the ledger (return items carry no variation name). */
  variationNames?: Map<string, string>;
  reverse?: ShopeeReverseInfo | null;
}

/** When the reverse leg says the parcel reached the seller (or warehouse→seller leg did). */
export function shopeeReverseDeliveredAt(reverse: ShopeeReverseInfo | null | undefined): Date | null {
  if (!reverse) return null;
  if (String(reverse.validation_type ?? "") === "warehouse_validation") {
    return isShopeeReverseDelivered(reverse.post_return_logistics_status)
      ? unix(reverse.post_return_logistics_update_time) ?? new Date()
      : null;
  }
  return isShopeeReverseDelivered(reverse.reverse_logistics_status)
    ? unix(reverse.reverse_logistics_update_time) ?? new Date()
    : null;
}

export function mapShopeeReturn(r: Raw, ctx: ShopeeReturnContext): NormalizedReturnInput {
  const cls = classifyShopeeReturn(r);
  const items = mergeItems(
    arr(r.item).map((it) => {
      const modelId = str(it.model_id);
      return {
        name: str(it.name) ?? "Item",
        variationName: (modelId && ctx.variationNames?.get(modelId)) || str(it.model_name) || null,
        quantity: Math.max(1, Number(it.amount) || 1),
        imageUrl: arr(it.images).length ? String((it.images as unknown[])[0]) : null,
        listingId: str(it.item_id),
        variationId: modelId,
      };
    })
  );
  const created = unix(r.create_time) ?? new Date();
  const updated = unix(r.update_time) ?? created;
  const newWaybill = shopeeReturnUsesNewWaybill(cls.returnRequestType);
  const reverse = ctx.reverse ?? null;
  const rtsTrackingNumber = newWaybill
    ? str(reverse?.rts_tracking_number) ?? str(reverse?.tracking_number) ?? str(r.tracking_number)
    : null;
  const courierReturnedToSellerAt = cls.expectsPhysicalReturn ? shopeeReverseDeliveredAt(reverse) : null;
  const reasonText = str(r.text_reason);

  return {
    shopConnectionId: ctx.shopConnectionId,
    platform: Platform.SHOPEE,
    orderSn: String(r.order_sn),
    returnSn: String(r.return_sn),
    forwardTrackingNumber: ctx.forwardTrackingNumber,
    rtsTrackingNumber,
    courier: str(r.reverse_logistics_channel_name) ?? ctx.orderCarrier ?? "SPX Express",
    category: cls.category,
    digitalStatus: cls.digitalStatus,
    returnReason:
      cls.category === ReturnCategory.FAILED_DELIVERY
        ? "Refused at the door (Return on the Spot)"
        : str(r.reason) ?? reasonText ?? "Buyer return request",
    disputeDeadlineAt: unix(r.due_date),
    ...summarize(items),
    items,
    orderTotalPhp: Number(r.refund_amount) || 0,
    digitalReturnTaggedAt: created,
    courierReturnedToSellerAt,
    expectsPhysicalReturn: cls.expectsPhysicalReturn,
    returnRequestType: cls.returnRequestType,
    returnType: cls.returnType,
    source: "SHOPEE_RETURNS",
    rawStatus: String(r.status ?? "UNKNOWN"),
    eventDescription: reasonText ?? String(r.status ?? ""),
    eventTimestamp: updated,
    rawPayloadJson: { return_sn: r.return_sn, status: r.status, return_refund_request_type: r.return_refund_request_type, return_solution: r.return_solution },
  };
}

// ---------------------------------------------------------------- TikTok

export function mapTikTokReturn(
  r: Raw,
  ctx: { shopConnectionId: string; forwardTrackingNumber: string | null; orderCarrier: string | null }
): NormalizedReturnInput {
  const cls = classifyTikTokReturn(r);
  const items = mergeItems(
    arr(r.return_line_items).map((li) => ({
      name: str(li.product_name) ?? "Item",
      variationName: str(li.sku_name),
      quantity: 1,
      imageUrl: str((li.product_image as Raw | undefined)?.url),
      listingId: str(li.product_id),
      variationId: str(li.sku_id),
    }))
  );
  const created = unix(r.create_time) ?? new Date();
  const updated = unix(r.update_time) ?? created;
  const status = String(r.return_status ?? "UNKNOWN");

  return {
    shopConnectionId: ctx.shopConnectionId,
    platform: Platform.TIKTOK,
    orderSn: String(r.order_id),
    returnSn: String(r.return_id),
    forwardTrackingNumber: ctx.forwardTrackingNumber,
    rtsTrackingNumber: cls.expectsPhysicalReturn ? str(r.return_tracking_number) : null,
    courier: str(r.return_provider_name) ?? ctx.orderCarrier ?? "J&T Express",
    category: cls.category,
    digitalStatus: cls.digitalStatus,
    returnReason: str(r.return_reason_text) ?? str(r.return_reason) ?? "Buyer return",
    disputeDeadlineAt: cls.disputeDeadlineAt,
    ...summarize(items),
    items,
    orderTotalPhp: Number((r.refund_amount as Raw | undefined)?.refund_total) || 0,
    digitalReturnTaggedAt: created,
    courierReturnedToSellerAt: cls.courierDelivered ? updated : null,
    expectsPhysicalReturn: cls.expectsPhysicalReturn,
    returnType: cls.returnType,
    source: "TIKTOK_RETURNS",
    rawStatus: status,
    eventDescription: str(r.return_reason_text) ?? status,
    eventTimestamp: updated,
    rawPayloadJson: { return_id: r.return_id, return_status: r.return_status, return_type: r.return_type },
  };
}

// ---------------------------------------------------------------- Failed deliveries from the ledger

export interface LedgerOrderForReturn {
  orderSn: string;
  status: string;
  totalPhp: number;
  platformCreatedAt: Date;
  platformUpdatedAt: Date;
  cancelReason: string | null;
  lines: Array<{ name: string; variationName: string | null; imageUrl: string | null; quantity: number; listingId: string; variationId: string }>;
  packages: Array<{ trackingNumber: string | null; carrier: string | null }>;
}

export function mapFailedDelivery(
  platform: Platform,
  shopConnectionId: string,
  order: LedgerOrderForReturn,
  events: TrackingEvent[] = []
): NormalizedReturnInput {
  const items = order.lines.map((l) => ({
    name: l.name,
    variationName: l.variationName,
    quantity: l.quantity,
    imageUrl: l.imageUrl,
    listingId: l.listingId,
    variationId: l.variationId,
  }));
  const pkg = order.packages.find((p) => p.trackingNumber) ?? order.packages[0];
  const returnedAt = findReturnedToSeller(events);
  const rawTaggedAt = findDeliveryFailed(events) ?? returnedAt ?? order.platformUpdatedAt;
  const taggedAt =
    returnedAt && rawTaggedAt.getTime() > returnedAt.getTime() ? returnedAt : rawTaggedAt;
  return {
    shopConnectionId,
    platform,
    orderSn: order.orderSn,
    forwardTrackingNumber: pkg?.trackingNumber ?? null,
    courier: pkg?.carrier ?? (platform === Platform.SHOPEE ? "SPX Express" : "J&T Express"),
    category: ReturnCategory.FAILED_DELIVERY,
    digitalStatus: returnedAt ? DigitalStatus.COURIER_RETURNED : DigitalStatus.RETURNING_TO_SELLER,
    returnReason: order.cancelReason ?? "Failed delivery",
    ...summarize(items),
    items,
    orderTotalPhp: order.totalPhp,
    orderCreatedAt: order.platformCreatedAt,
    digitalReturnTaggedAt: taggedAt,
    courierReturnedToSellerAt: returnedAt,
    expectsPhysicalReturn: true,
    source: platform === Platform.SHOPEE ? "SHOPEE_ORDERS" : "TIKTOK_ORDERS",
    rawStatus: order.status,
    eventDescription: order.cancelReason ?? "Cancelled after pickup",
    eventTimestamp: returnedAt ?? taggedAt,
  };
}

// ---------------------------------------------------------------- Tracking payloads → events

export function shopeeTrackingEvents(resp: Raw | null | undefined): TrackingEvent[] {
  return arr(resp?.tracking_info).map((e) => ({
    time: unix(e.update_time) ?? new Date(0),
    description: String(e.description ?? ""),
    status: str(e.logistics_status),
  }));
}

export function tiktokTrackingEvents(resp: Raw | null | undefined): TrackingEvent[] {
  return arr(resp?.tracking).map((e) => ({
    time: new Date(Number(e.update_time_millis) || 0),
    description: String(e.description ?? ""),
    status: str(e.action_code),
  }));
}
