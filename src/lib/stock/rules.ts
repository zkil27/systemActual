import { OrderState, Platform } from "@prisma/client";
import { isCommittedOrderState, normalizeOrderState } from "@/lib/ledger/state";

/**
 * Stock model (replaces BigSeller's stock sync):
 *
 *   on shelf   = starting count + deliveries + good returns − shipped ± recounts
 *   committed  = pieces on orders not yet picked up (from the order ledger, live)
 *   available  = on shelf − committed − safety buffer, never below 0
 *
 * "available" is what both shops are told they can sell.
 */
export function availableToSell(onShelf: number, committed: number, buffer: number): number {
  return Math.max(0, onShelf - committed - Math.max(0, buffer));
}

const TIKTOK_TRANSIT_PACKAGE_STATUSES = new Set(["IN_TRANSIT", "DELIVERED", "COMPLETED"]);

/**
 * An order has left the warehouse once it's out of the unshipped statuses,
 * except a cancellation before pickup (the parcel never left).
 * - Shopee sets `shippedAt` from `pickup_done_time` (actual rider scan).
 * - TikTok sets `shippedAt` from `rts_time` (when shipment was arranged, BEFORE
 *   pickup), so a TikTok CANCELLED order only counts as having left the warehouse
 *   if a package reached transit/delivered status.
 */
export function hasLeftWarehouse(
  platform: Platform,
  status: string,
  shippedAt: Date | null,
  packages?: Array<{ status: string | null }>,
  state?: OrderState | null
): boolean {
  const resolved = state ?? normalizeOrderState(platform, status);
  if (isCommittedOrderState(resolved)) return false;
  if (resolved === OrderState.CANCELLED) {
    if (platform === Platform.TIKTOK) {
      return Boolean(
        packages?.some((p) => p.status && TIKTOK_TRANSIT_PACKAGE_STATUSES.has(p.status.trim().toUpperCase()))
      );
    }
    return shippedAt !== null;
  }
  return true;
}

export interface ShipLine {
  listingId: string;
  variationId: string;
  quantity: number;
  /** null if this listing isn't linked to a garment variant with a starting count */
  variant: { id: string; startingStockSetAt: Date | null } | null;
}

/**
 * Stock movements for an order that left the warehouse. Only pieces shipped
 * after the variant's starting count are subtracted: anything earlier was
 * already off the shelf when the owner counted.
 */
export function shipMovements(
  order: { platform: Platform; orderSn: string; shippedAt: Date | null; platformUpdatedAt: Date },
  lines: ShipLine[]
): Array<{ garmentVariantId: string; delta: number; sourceKey: string }> {
  const shipTime = order.shippedAt ?? order.platformUpdatedAt;
  return lines
    .filter((l) => l.variant?.startingStockSetAt && shipTime.getTime() >= l.variant.startingStockSetAt.getTime())
    .map((l) => ({
      garmentVariantId: l.variant!.id,
      delta: -Math.abs(l.quantity),
      sourceKey: `ship:${order.platform}:${order.orderSn}:${l.listingId}:${l.variationId}`,
    }));
}

/** Returns that come back sellable go back on the shelf. */
export const RESTOCK_CONDITIONS = new Set(["GOOD_RESTOCKABLE", "DAMAGED_PACKAGING"]);

export interface PushCandidate {
  listingVariantId: string;
  platform: Platform;
  shopConnectionId: string;
  listingId: string;
  variationId: string;
  warehouseId: string | null;
  target: number;
  pushedStock: number | null;
}

/** Listings whose shop number differs from what it should be, lowest stock first (sell-out risk). */
export function planPushes(rows: PushCandidate[]): PushCandidate[] {
  return rows.filter((r) => r.pushedStock !== r.target).sort((a, b) => a.target - b.target);
}

/** Alert the owner once, on the push failure that reaches this count. */
export const PUSH_ALERT_AFTER = 3;
