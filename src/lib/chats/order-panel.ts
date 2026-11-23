import { z } from "zod";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import type { OrderPanel } from "./types";

/** Sample chats carry their own order card, so the demo never creates fake orders. */
export const sampleOrderSchema = z.object({
  orderSn: z.string().min(1),
  photoUrl: z.string().nullable(),
  itemName: z.string().min(1),
  variation: z.string().nullable(),
  moreItems: z.number().int().min(0).default(0),
  statusLabel: z.string().min(1),
  carrier: z.string().nullable(),
  trackingNumber: z.string().nullable(),
});
export type SampleOrder = z.infer<typeof sampleOrderSchema>;

const STATUS_LABELS: Record<string, string> = {
  // Shopee
  UNPAID: "Waiting for payment",
  READY_TO_SHIP: "Getting ready to ship",
  PROCESSED: "Packed, waiting for courier",
  RETRY_SHIP: "Shipping again",
  SHIPPED: "On the way",
  TO_CONFIRM_RECEIVE: "Delivered",
  IN_CANCEL: "Buyer asked to cancel",
  CANCELLED: "Cancelled",
  TO_RETURN: "Return requested",
  COMPLETED: "Completed",
  // TikTok
  ON_HOLD: "On hold",
  AWAITING_SHIPMENT: "Getting ready to ship",
  PARTIALLY_SHIPPING: "Partly shipped",
  AWAITING_COLLECTION: "Packed, waiting for courier",
  IN_TRANSIT: "On the way",
  DELIVERED: "Delivered",
};

/** Raw Shopee / TikTok order status in plain words. */
export function orderStatusLabel(status: string, cancelRequested = false): string {
  const key = status.trim().toUpperCase();
  if (cancelRequested && key !== "CANCELLED") return "Buyer asked to cancel";
  if (STATUS_LABELS[key]) return STATUS_LABELS[key];
  const words = key.replace(/_/g, " ").toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

export interface PanelOrderInput {
  orderSn: string;
  status: string;
  cancelRequested: boolean;
  lines: Array<{ name: string; variationName: string | null; imageUrl: string | null; quantity: number }>;
  packages: Array<{ trackingNumber: string | null; carrier: string | null }>;
}

/**
 * The order card beside a chat. Real chats use the synced order; sample chats
 * use their own `sampleOrder`. Null when the chat isn't about an order we know.
 */
export function buildOrderPanel(input: { sampleOrder?: unknown; order?: PanelOrderInput | null }): OrderPanel | null {
  if (input.order) {
    const o = input.order;
    const first = o.lines[0];
    const pieces = o.lines.reduce((n, l) => n + l.quantity, 0);
    const pkg = o.packages.find((p) => p.trackingNumber) ?? o.packages[0];
    return {
      orderSn: o.orderSn,
      photoUrl: first?.imageUrl ?? null,
      itemName: first?.name ?? "Order",
      variation: first?.variationName ?? null,
      moreItems: Math.max(0, pieces - (first?.quantity ?? 0)),
      statusLabel: orderStatusLabel(o.status, o.cancelRequested),
      carrier: pkg?.carrier ? normalizeCourierName(pkg.carrier) : null,
      trackingNumber: pkg?.trackingNumber ?? null,
    };
  }
  if (input.sampleOrder) {
    const parsed = sampleOrderSchema.safeParse(input.sampleOrder);
    if (parsed.success) return parsed.data;
  }
  return null;
}
