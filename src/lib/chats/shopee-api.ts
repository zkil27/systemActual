import { shopeeGet, shopeePostRaw, shopeeUploadChatImage } from "@/lib/connectors/shopee";

/**
 * Shopee Open Platform v2 Seller Chat API (`/api/v2/sellerchat/*`).
 * Paths and wire formats verified against the live PH shop.
 */
export const SP_CONVERSATIONS_PAGE = 25;
export const SP_MESSAGES_PAGE = 25;

export interface SpConversation {
  conversation_id: string | number;
  to_id?: number | string;
  to_name?: string;
  to_avatar?: string;
  shop_id?: number | string;
  unread_count?: number;
  pinned?: boolean;
  last_read_message_id?: string;
  latest_message_id?: string;
  latest_message_type?: string;
  latest_message_content?: Record<string, unknown>;
  latest_message_from_id?: number | string;
  /** Nanoseconds on live Shopee Seller Chat. */
  last_message_timestamp?: number | string;
}

export interface SpMessage {
  message_id: string;
  conversation_id?: string | number;
  from_id?: number | string;
  to_id?: number | string;
  from_shop_id?: number | string;
  to_shop_id?: number | string;
  /** text, image, image_with_text, order, item, variation_card, notification, faq_liveagent, new_faq, video, sticker, voucher... */
  message_type?: string;
  content?: Record<string, unknown> | string;
  /** Unix seconds. */
  created_timestamp?: number | string;
  source?: string;
  source_content?: {
    order_sn?: string;
    item_id?: number | string;
  };
}

export interface SpChatShop {
  shopId: string;
  accessToken: string;
}

export type SpCall = (opts: {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string | number>;
  rawBody?: string;
}) => Promise<Record<string, unknown>>;

export type SpUpload = (file: Blob, fileName: string) => Promise<{ url: string }>;

/** Validates a positive integer string for raw 64-bit JSON serialization (no float precision loss). */
export function safeInt64Literal(raw: string | number, label: string): string {
  const s = String(raw).trim();
  if (!/^\d{1,20}$/.test(s)) {
    throw new Error(`Invalid Shopee ${label}: ${s}`);
  }
  return s;
}

export function shopeeChatCaller(shop: SpChatShop): SpCall {
  return async (opts) => {
    if (opts.method === "GET") {
      return ((await shopeeGet(opts.path, shop.shopId, shop.accessToken, opts.query ?? {})) ?? {}) as Record<
        string,
        unknown
      >;
    }
    return ((await shopeePostRaw(opts.path, shop.shopId, shop.accessToken, opts.rawBody ?? "{}")) ?? {}) as Record<
      string,
      unknown
    >;
  };
}

export function shopeeChatUploader(shop: SpChatShop): SpUpload {
  return (file, fileName) => shopeeUploadChatImage(shop.shopId, shop.accessToken, file, fileName);
}

/**
 * Lists conversations newest-first (`direction: "older"` walks backward from now).
 */
export async function listShopeeConversations(
  call: SpCall,
  nextTimestampNano?: string | null
): Promise<{ conversations: SpConversation[]; nextTimestampNano: string | null; more: boolean }> {
  const query: Record<string, string | number> = {
    direction: "older",
    type: "all",
    page_size: SP_CONVERSATIONS_PAGE,
  };
  if (nextTimestampNano) query.next_timestamp_nano = nextTimestampNano;

  const d = await call({
    method: "GET",
    path: "/api/v2/sellerchat/get_conversation_list",
    query,
  });
  const pageResult = (d.page_result ?? {}) as Record<string, unknown>;
  const cursor = (pageResult.next_cursor ?? {}) as Record<string, unknown>;
  const nextNano =
    typeof cursor.next_message_time_nano === "string" && cursor.next_message_time_nano && cursor.next_message_time_nano !== "0"
      ? cursor.next_message_time_nano
      : null;
  const more = Boolean(pageResult.more && nextNano);
  return {
    conversations: Array.isArray(d.conversations) ? (d.conversations as SpConversation[]) : [],
    nextTimestampNano: more ? nextNano : null,
    more,
  };
}

export async function getShopeeConversation(call: SpCall, conversationId: string): Promise<SpConversation | null> {
  const d = await call({
    method: "GET",
    path: "/api/v2/sellerchat/get_one_conversation",
    query: { conversation_id: conversationId },
  });
  if (!d || !d.conversation_id) return null;
  return d as unknown as SpConversation;
}

/**
 * Lists messages newest-first. Pass `offset` (`page_result.next_offset`) to load older messages.
 */
export async function listShopeeMessages(
  call: SpCall,
  conversationId: string,
  offset?: string | null
): Promise<{ messages: SpMessage[]; nextOffset: string | null }> {
  const query: Record<string, string | number> = {
    conversation_id: conversationId,
    page_size: SP_MESSAGES_PAGE,
  };
  if (offset) query.offset = offset;

  const d = await call({
    method: "GET",
    path: "/api/v2/sellerchat/get_message",
    query,
  });
  const pageResult = (d.page_result ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(d.messages) ? (d.messages as SpMessage[]) : [];
  const nextOffset =
    typeof pageResult.next_offset === "string" && pageResult.next_offset && pageResult.next_offset !== "0"
      ? pageResult.next_offset
      : null;
  return {
    messages,
    nextOffset: messages.length >= SP_MESSAGES_PAGE ? nextOffset : null,
  };
}

/** Marks a conversation read up to `lastReadMessageId` using exact int64 `conversation_id`. */
export async function markShopeeConversationRead(
  call: SpCall,
  conversationId: string,
  lastReadMessageId: string
): Promise<void> {
  const convLit = safeInt64Literal(conversationId, "conversation_id");
  const rawBody = `{"conversation_id":${convLit},"last_read_message_id":${JSON.stringify(lastReadMessageId)}}`;
  await call({
    method: "POST",
    path: "/api/v2/sellerchat/read_conversation",
    rawBody,
  });
}

/** Sends a text reply to a Shopee buyer (`to_id`). Returns Shopee's `message_id` when provided. */
export async function sendShopeeTextMessage(call: SpCall, toId: string | number, text: string): Promise<string | null> {
  const toLit = safeInt64Literal(toId, "to_id");
  const rawBody = `{"to_id":${toLit},"message_type":"text","content":${JSON.stringify({ text })}}`;
  const d = await call({
    method: "POST",
    path: "/api/v2/sellerchat/send_message",
    rawBody,
  });
  const id = d.message_id ?? d.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

/** Sends an image reply (using the URL from `/api/v2/sellerchat/upload_image`). */
export async function sendShopeeImageMessage(
  call: SpCall,
  toId: string | number,
  imageUrl: string
): Promise<string | null> {
  const toLit = safeInt64Literal(toId, "to_id");
  const rawBody = `{"to_id":${toLit},"message_type":"image","content":${JSON.stringify({ image_url: imageUrl })}}`;
  const d = await call({
    method: "POST",
    path: "/api/v2/sellerchat/send_message",
    rawBody,
  });
  const id = d.message_id ?? d.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export async function uploadShopeeChatPhoto(upload: SpUpload, file: Blob, fileName: string): Promise<string> {
  const { url } = await upload(file, fileName);
  if (!url) throw new Error("Shopee didn't return the uploaded photo.");
  return url;
}

export function isTemporaryShopeeChatError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /rate limit|too many|timeout|timed out|internal|system busy|ECONNRESET|fetch failed|502|503|504/i.test(msg);
}
