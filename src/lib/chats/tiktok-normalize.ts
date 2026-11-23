import type { TtConversation, TtMessage } from "./tiktok-api";

/** One TikTok message in our shape. Card details are filled in later from our orders. */
export interface NormalizedMessage {
  externalId: string;
  sender: "BUYER" | "SELLER" | "ROBOT" | "SYSTEM";
  kind: "TEXT" | "IMAGE" | "ORDER_CARD" | "PRODUCT_CARD" | "OTHER";
  text: string | null;
  imageUrl: string | null;
  /** Order the message points to (order or delivery card). */
  orderSn: string | null;
  packageId: string | null;
  productId: string | null;
  /** A delivery-status card rather than an order card. */
  logistics: boolean;
  sentAt: Date;
}

export interface NormalizedConversation {
  externalId: string;
  buyerName: string;
  buyerAvatarUrl: string | null;
  lastMessageAt: Date;
  unreadCount: number;
  canReply: boolean;
}

function parseContent(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : { content: String(v) };
  } catch {
    // Not JSON: treat the whole string as the text.
    return { content: raw };
  }
}

function str(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** TikTok seconds (sometimes milliseconds) to a Date. */
export function ttTime(v: unknown): Date {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n <= 0) return new Date(0);
  return new Date(n > 1e12 ? n : n * 1000);
}

export function senderFor(role: string | undefined): NormalizedMessage["sender"] {
  switch ((role ?? "").toUpperCase()) {
    case "BUYER":
      return "BUYER";
    case "SHOP":
    case "CUSTOMER_SERVICE":
      return "SELLER";
    case "ROBOT":
      return "ROBOT";
    default:
      return "SYSTEM";
  }
}

const SYSTEM_TYPES = new Set(["NOTIFICATION", "ALLOCATED_SERVICE"]);

/** Null for messages TikTok hides from the chat (is_visible = false) or that have no id. */
export function normalizeMessage(m: TtMessage): NormalizedMessage | null {
  if (!m?.id || m.is_visible === false) return null;
  const type = String(m.type ?? "").toUpperCase();
  const c = parseContent(m.content);
  const base: NormalizedMessage = {
    externalId: String(m.id),
    sender: SYSTEM_TYPES.has(type) ? "SYSTEM" : senderFor(m.sender?.role),
    kind: "TEXT",
    text: null,
    imageUrl: null,
    orderSn: null,
    packageId: null,
    productId: null,
    logistics: false,
    sentAt: ttTime(m.create_time),
  };

  switch (type) {
    case "TEXT":
    case "NOTIFICATION":
    case "ALLOCATED_SERVICE":
      return { ...base, text: str(c.content) ?? str(c.text) };
    case "IMAGE": {
      const url = str(c.url) ?? str(c.image_url) ?? str(c.imageUrl);
      return url ? { ...base, kind: "IMAGE", imageUrl: url } : { ...base, kind: "OTHER", text: "Photo" };
    }
    case "ORDER_CARD":
      return { ...base, kind: "ORDER_CARD", orderSn: str(c.order_id) };
    case "LOGISTICS_CARD":
      return { ...base, kind: "ORDER_CARD", orderSn: str(c.order_id), packageId: str(c.package_id), logistics: true };
    case "PRODUCT_CARD":
      return { ...base, kind: "PRODUCT_CARD", productId: str(c.product_id) };
    default:
      // Stickers, videos, coupons, bot question lists. TikTok sends only
      // "[Other] Please check this message in seller center…", so show our own placeholder.
      return { ...base, kind: "OTHER" };
  }
}

export function normalizeConversation(c: TtConversation): NormalizedConversation {
  const buyer = (c.participants ?? []).find((p) => (p.role ?? "").toUpperCase() === "BUYER");
  const latest = c.latest_message?.create_time ?? c.create_time;
  return {
    externalId: String(c.id),
    buyerName: str(buyer?.nickname) ?? "TikTok buyer",
    buyerAvatarUrl: str(buyer?.avatar),
    lastMessageAt: ttTime(latest),
    unreadCount: Math.max(0, Number(c.unread_count ?? 0) || 0),
    canReply: c.can_send_message !== false,
  };
}

/** Newest order mentioned by a set of messages (oldest-first or any order). */
export function latestOrderSn(messages: NormalizedMessage[]): string | null {
  let best: NormalizedMessage | null = null;
  for (const m of messages) {
    if (m.orderSn && (!best || m.sentAt.getTime() >= best.sentAt.getTime())) best = m;
  }
  return best?.orderSn ?? null;
}
