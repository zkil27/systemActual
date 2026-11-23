/**
 * Maps raw Shopee / TikTok order payloads into one shape for the order ledger.
 * Pure functions: same input, same output, so re-syncing an order is a no-op.
 */

export interface NormalizedLine {
  listingId: string;
  variationId: string;
  name: string;
  variationName: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPricePhp: number;
}

export interface NormalizedPackage {
  packageNumber: string;
  trackingNumber: string | null;
  carrier: string | null;
  channelId: string | null;
  status: string | null;
}

export interface NormalizedOrder {
  orderSn: string;
  status: string;
  isCod: boolean;
  totalPhp: number;
  createdAt: Date;
  updatedAt: Date;
  shippedAt: Date | null;
  cancelBy: string | null;
  cancelReason: string | null;
  /** Buyer asked to cancel; the order must not be shipped. */
  cancelRequested: boolean;
  lines: NormalizedLine[];
  packages: NormalizedPackage[];
}

type Raw = Record<string, unknown>;

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fromUnix(v: unknown): Date | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : null;
}

function arr(v: unknown): Raw[] {
  return Array.isArray(v) ? (v as Raw[]) : [];
}

/** Same listing + variation appearing twice (bundles, TikTok per-unit lines) becomes one line. */
function mergeLines(lines: NormalizedLine[]): NormalizedLine[] {
  const byKey = new Map<string, NormalizedLine>();
  for (const line of lines) {
    const key = `${line.listingId}:${line.variationId}`;
    const existing = byKey.get(key);
    if (existing) existing.quantity += line.quantity;
    else byKey.set(key, { ...line });
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.listingId}:${a.variationId}`.localeCompare(`${b.listingId}:${b.variationId}`)
  );
}

/** One order from v2.order.get_order_detail. */
export function mapShopeeOrder(o: Raw): NormalizedOrder {
  const createdAt = fromUnix(o.create_time) ?? new Date(0);
  const paymentMethod = String(o.payment_method ?? "");
  const lines = arr(o.item_list).map((it) => ({
    listingId: String(it.item_id ?? ""),
    variationId: String(it.model_id ?? 0),
    name: str(it.item_name) ?? "Item",
    variationName: str(it.model_name),
    imageUrl: str((it.image_info as Raw | undefined)?.image_url),
    quantity: Math.max(1, num(it.model_quantity_purchased) || 1),
    unitPricePhp: num(it.model_discounted_price) || num(it.model_original_price),
  }));
  const packages = arr(o.package_list)
    .filter((p) => str(p.package_number))
    .map((p) => ({
      packageNumber: String(p.package_number),
      trackingNumber: str(p.tracking_number),
      carrier: str(p.shipping_carrier) ?? str(o.shipping_carrier),
      channelId: str(p.logistics_channel_id),
      status: str(p.logistics_status),
    }));
  return {
    orderSn: String(o.order_sn),
    status: String(o.order_status ?? "UNKNOWN"),
    isCod: o.cod === true || /cod|cash on delivery/i.test(paymentMethod),
    totalPhp: num(o.total_amount),
    createdAt,
    updatedAt: fromUnix(o.update_time) ?? createdAt,
    shippedAt: fromUnix(o.pickup_done_time),
    cancelBy: str(o.cancel_by),
    cancelReason: str(o.cancel_reason) ?? str(o.buyer_cancel_reason),
    cancelRequested: String(o.order_status ?? "").toUpperCase() === "IN_CANCEL",
    lines: mergeLines(lines),
    packages,
  };
}

/** One order from /order/202309/orders/search. TikTok line items are one unit each. */
export function mapTikTokOrder(o: Raw): NormalizedOrder {
  const createdAt = fromUnix(o.create_time) ?? new Date(0);
  const status = String(o.status ?? "UNKNOWN");
  const orderCancelled = status.trim().toUpperCase() === "CANCELLED";
  const allItems = arr(o.line_items);
  // Filter out partially-cancelled line items on active orders so pick lists,
  // packing slips, and stock deductions only count active items.
  const activeItems = orderCancelled
    ? allItems
    : allItems.filter((li) => {
        const ds = String(li.display_status ?? "").trim().toUpperCase();
        return ds !== "CANCELLED" && ds !== "CANCELED";
      });
  const items = activeItems.length > 0 ? activeItems : allItems;
  const lines = items.map((li) => ({
    listingId: String(li.product_id ?? ""),
    variationId: String(li.sku_id ?? ""),
    name: str(li.product_name) ?? "Item",
    variationName: str(li.sku_name),
    imageUrl: str(li.sku_image),
    quantity: 1,
    unitPricePhp: num(li.sale_price),
  }));

  const packages = new Map<string, NormalizedPackage>();
  for (const li of items) {
    const id = str(li.package_id);
    if (!id || packages.has(id)) continue;
    packages.set(id, {
      packageNumber: id,
      trackingNumber: str(li.tracking_number),
      carrier: str(li.shipping_provider_name) ?? str(o.shipping_provider),
      channelId: str(li.shipping_provider_id) ?? str(o.shipping_provider_id),
      status: str(li.package_status),
    });
  }
  for (const p of arr(o.packages)) {
    const id = str(p.id);
    if (id && !packages.has(id)) {
      packages.set(id, {
        packageNumber: id,
        trackingNumber: null,
        carrier: str(o.shipping_provider),
        channelId: str(o.shipping_provider_id),
        status: null,
      });
    }
  }

  const rtsTimes = items.map((li) => num(li.rts_time)).filter((n) => n > 0);
  const shippedAt = fromUnix(o.rts_time) ?? (rtsTimes.length ? new Date(Math.min(...rtsTimes) * 1000) : null);

  return {
    orderSn: String(o.id),
    status: String(o.status ?? "UNKNOWN"),
    isCod: o.is_cod === true,
    totalPhp: num((o.payment as Raw | undefined)?.total_amount),
    createdAt,
    updatedAt: fromUnix(o.update_time) ?? createdAt,
    shippedAt,
    cancelBy: str(o.cancellation_initiator),
    cancelReason: str(o.cancel_reason),
    cancelRequested: o.is_buyer_request_cancel === true,
    lines: mergeLines(lines),
    packages: [...packages.values()].sort((a, b) => a.packageNumber.localeCompare(b.packageNumber)),
  };
}

/** Skip writes that would move an order backwards (webhook/poll arriving out of order). */
export function shouldApplyOrderUpdate(existingUpdatedAt: Date | null | undefined, incoming: Date): boolean {
  return !existingUpdatedAt || incoming.getTime() >= existingUpdatedAt.getTime();
}

export interface OrderComparisonSnapshot {
  platformUpdatedAt: Date;
  status: string;
  cancelRequested: boolean;
  shippedAt: Date | null;
  packages: Array<{ packageNumber: string; status: string | null; trackingNumber: string | null }>;
}

/**
 * True when the stored order already matches this snapshot (same update_time,
 * status, cancel flag, ship time and packages), so re-writing it in an overlap
 * window would be wasted work.
 */
export function isOrderUnchanged(existing: OrderComparisonSnapshot, incoming: NormalizedOrder): boolean {
  if (existing.platformUpdatedAt.getTime() !== incoming.updatedAt.getTime()) return false;
  if (existing.status !== incoming.status) return false;
  if (existing.cancelRequested !== incoming.cancelRequested) return false;
  if ((existing.shippedAt?.getTime() ?? null) !== (incoming.shippedAt?.getTime() ?? null)) return false;
  if (existing.packages.length !== incoming.packages.length) return false;
  const byNum = new Map(existing.packages.map((p) => [p.packageNumber, p]));
  for (const p of incoming.packages) {
    const prev = byNum.get(p.packageNumber);
    if (!prev) return false;
    if (prev.status !== p.status) return false;
    if (p.trackingNumber && prev.trackingNumber !== p.trackingNumber) return false;
  }
  return true;
}

/** Statuses after which an order can be deleted once it's old enough. */
export const FINAL_ORDER_STATUSES = ["COMPLETED", "CANCELLED"];
