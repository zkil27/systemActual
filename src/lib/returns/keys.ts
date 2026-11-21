import { ReturnCategory } from "@prisma/client";

/**
 * Failed deliveries (including Shopee Return on the Spot) are one physical
 * parcel per order coming back on the original waybill, so they key on the
 * order. That also merges a Return-on-the-Spot request with the same order's
 * cancelled-after-pickup record. Buyer returns key on the return id.
 * Keep in sync with the backfill in migration 20261121030000.
 */
export function returnDedupeKey(category: ReturnCategory, returnSn: string | null | undefined, orderSn: string): string {
  if (category === ReturnCategory.FAILED_DELIVERY) return `F:${orderSn}`;
  return returnSn ? `R:${returnSn}` : `R:order:${orderSn}`;
}
