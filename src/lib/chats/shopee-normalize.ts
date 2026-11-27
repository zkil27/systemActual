import type { SpConversation, SpMessage } from "./shopee-api";
import type { NormalizedConversation, NormalizedMessage } from "./tiktok-normalize";

export { latestOrderSn } from "./tiktok-normalize";
export type { NormalizedConversation, NormalizedMessage };

function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseContent(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { text: String(v) };
  } catch {
    return { text: raw };
  }
}

/**
 * Converts Shopee chat timestamps to a Date:
 * - Conversation `last_message_timestamp` is in nanoseconds (~19 digits, > 1e15)
 * - Message `created_timestamp` is in seconds (~10 digits)
 * - Milliseconds (~13 digits, > 1e12) are handled safely too.
 */
export function spTime(v: unknown): Date {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return new Date(0);
  if (n > 1e15) return new Date(Math.floor(n / 1e6));
  if (n > 1e12) return new Date(n);
  return new Date(n * 1000);
}

const BOT_TYPES = new Set(["new_faq", "faq", "auto_reply"]);
const BOT_SOURCES = new Set(["server", "system", "chatbot", "faq"]);

export function shopeeSenderFor(m: SpMessage, shopId: string): NormalizedMessage["sender"] {
  const type = String(m.message_type ?? "").toLowerCase();
  if (type === "notification") return "SYSTEM";
  const fromShop = str(m.from_shop_id);
  const isFromShop = Boolean(fromShop && fromShop === String(shopId));
  if (!isFromShop) return "BUYER";
  const source = String(m.source ?? "").toLowerCase();
  if (BOT_TYPES.has(type) || BOT_SOURCES.has(source)) return "ROBOT";
  return "SELLER";
}

/** Normalizes one Shopee Seller Chat message into our shared chat shape. */
export function normalizeShopeeMessage(m: SpMessage, shopId: string): NormalizedMessage | null {
  if (!m?.message_id) return null;
  const type = String(m.message_type ?? "").toLowerCase();
  const c = parseContent(m.content);
  const sourceOrderSn = str(m.source_content?.order_sn);
  const sourceItemId = str(m.source_content?.item_id);

  const base: NormalizedMessage = {
    externalId: String(m.message_id),
    sender: shopeeSenderFor(m, shopId),
    kind: "TEXT",
    text: null,
    imageUrl: null,
    orderSn: sourceOrderSn,
    packageId: null,
    productId: sourceItemId,
    logistics: false,
    sentAt: spTime(m.created_timestamp),
  };

  switch (type) {
    case "text":
    case "faq_liveagent": {
      const text = str(c.text) ?? str(c.content);
      return { ...base, kind: "TEXT", text };
    }
    case "notification": {
      const text =
        str(c.notification_for_sender) ?? str(c.notification_for_receiver) ?? str(c.text) ?? str(c.content);
      return { ...base, sender: "SYSTEM", kind: "TEXT", text };
    }
    case "image": {
      const url = str(c.url) ?? str(c.image_url) ?? str(c.thumb_url);
      return url ? { ...base, kind: "IMAGE", imageUrl: url } : { ...base, kind: "OTHER", text: "Photo" };
    }
    case "image_with_text": {
      const url = str(c.image_url) ?? str(c.url) ?? str(c.thumb_url);
      const text = str(c.text) ?? str(c.caption) ?? str(c.title);
      if (url) return { ...base, kind: "IMAGE", imageUrl: url, text };
      if (text) return { ...base, kind: "TEXT", text };
      return { ...base, kind: "OTHER" };
    }
    case "order": {
      const orderSn = str(c.order_sn) ?? sourceOrderSn;
      return { ...base, kind: "ORDER_CARD", orderSn };
    }
    case "item":
    case "variation_card": {
      const productId = str(c.item_id) ?? sourceItemId;
      return productId ? { ...base, kind: "PRODUCT_CARD", productId } : { ...base, kind: "OTHER" };
    }
    default:
      return { ...base, kind: "OTHER" };
  }
}

export function normalizeShopeeConversation(c: SpConversation): NormalizedConversation {
  return {
    externalId: String(c.conversation_id),
    buyerName: str(c.to_name) ?? "Shopee buyer",
    buyerAvatarUrl: str(c.to_avatar),
    lastMessageAt: spTime(c.last_message_timestamp),
    unreadCount: Math.max(0, Number(c.unread_count ?? 0) || 0),
    canReply: true,
  };
}
