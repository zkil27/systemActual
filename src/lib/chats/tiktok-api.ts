import { tiktokRequest, tiktokUploadRequest } from "@/lib/connectors/tiktok";

/**
 * TikTok Shop Customer Service API (2023-09). Paths here were checked against
 * the live shop. TikTok returns messages newest first, at most 10 per page.
 */
export const TT_CONVERSATIONS_PAGE = 20;
export const TT_MESSAGES_PAGE = 10;

export interface TtUser {
  im_user_id?: string;
  user_id?: string;
  nickname?: string;
  avatar?: string;
  /** BUYER, SHOP, CUSTOMER_SERVICE, ROBOT, SYSTEM */
  role?: string;
}

export interface TtMessage {
  id: string;
  /** TEXT, IMAGE, ORDER_CARD, PRODUCT_CARD, LOGISTICS_CARD, NOTIFICATION, ALLOCATED_SERVICE, OTHER… */
  type: string;
  /** JSON string, e.g. {"content":"hi"} or {"order_id":"…"} */
  content: string;
  /** Unix seconds. */
  create_time: number;
  index?: string;
  is_visible?: boolean;
  sender?: TtUser;
}

export interface TtConversation {
  id: string;
  create_time: number;
  can_send_message?: boolean;
  unread_count?: number;
  participant_count?: number;
  participants?: TtUser[];
  latest_message?: TtMessage;
}

export interface TtShop {
  accessToken: string;
  shopCipher: string;
}

/** Signs and sends one request. Tests pass a fake. */
export type TtCall = (opts: {
  method: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}) => Promise<Record<string, unknown>>;

export function tiktokCaller(shop: TtShop): TtCall {
  return async (opts) =>
    ((await tiktokRequest({ ...opts, accessToken: shop.accessToken, shopCipher: shop.shopCipher })) ?? {}) as Record<
      string,
      unknown
    >;
}

function pageToken(token?: string | null): Record<string, string> {
  return token ? { page_token: token } : {};
}

export async function listConversations(
  call: TtCall,
  token?: string | null
): Promise<{ conversations: TtConversation[]; nextPageToken: string | null }> {
  const d = await call({
    method: "GET",
    path: "/customer_service/202309/conversations",
    query: { page_size: String(TT_CONVERSATIONS_PAGE), ...pageToken(token) },
  });
  return {
    conversations: Array.isArray(d.conversations) ? (d.conversations as TtConversation[]) : [],
    nextPageToken: typeof d.next_page_token === "string" && d.next_page_token ? d.next_page_token : null,
  };
}

export async function listMessages(
  call: TtCall,
  conversationId: string,
  token?: string | null
): Promise<{ messages: TtMessage[]; nextPageToken: string | null }> {
  const d = await call({
    method: "GET",
    path: `/customer_service/202309/conversations/${encodeURIComponent(conversationId)}/messages`,
    query: { page_size: String(TT_MESSAGES_PAGE), ...pageToken(token) },
  });
  return {
    messages: Array.isArray(d.messages) ? (d.messages as TtMessage[]) : [],
    nextPageToken: typeof d.next_page_token === "string" && d.next_page_token ? d.next_page_token : null,
  };
}

/** Marks the buyer's messages in this chat as read on TikTok. */
export async function markConversationRead(call: TtCall, conversationId: string): Promise<void> {
  await call({
    method: "POST",
    path: `/customer_service/202309/conversations/${encodeURIComponent(conversationId)}/messages/read`,
    body: {},
  });
}

/** Sends a text reply. Returns TikTok's message id (null if it didn't send one back). */
export async function sendTextMessage(call: TtCall, conversationId: string, text: string): Promise<string | null> {
  const d = await call({
    method: "POST",
    path: `/customer_service/202309/conversations/${encodeURIComponent(conversationId)}/messages`,
    body: { type: "TEXT", content: JSON.stringify({ content: text }) },
  });
  const id = d.message_id ?? d.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export interface TtImage {
  url: string;
  width: number;
  height: number;
}

/** Uploads one photo for chat. TikTok gives back the image's URL and size. */
export type TtUpload = (file: Blob, fileName: string) => Promise<Record<string, unknown>>;

export function tiktokUploader(shop: TtShop): TtUpload {
  return async (file, fileName) =>
    ((await tiktokUploadRequest({
      path: "/customer_service/202309/images/upload",
      accessToken: shop.accessToken,
      shopCipher: shop.shopCipher,
      field: "data",
      file,
      fileName,
    })) ?? {}) as Record<string, unknown>;
}

export async function uploadChatImage(upload: TtUpload, file: Blob, fileName: string): Promise<TtImage> {
  const d = await upload(file, fileName);
  const url = typeof d.url === "string" ? d.url : "";
  if (!url) throw new Error("TikTok didn't return the uploaded photo.");
  return { url, width: Number(d.width) || 0, height: Number(d.height) || 0 };
}

/** Sends a photo already uploaded with uploadChatImage. */
export async function sendImageMessage(call: TtCall, conversationId: string, image: TtImage): Promise<string | null> {
  const d = await call({
    method: "POST",
    path: `/customer_service/202309/conversations/${encodeURIComponent(conversationId)}/messages`,
    body: { type: "IMAGE", content: JSON.stringify({ url: image.url, width: image.width, height: image.height }) },
  });
  const id = d.message_id ?? d.id;
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

/**
 * TikTok sometimes answers "access denied … scope" for a few minutes after the
 * shop reauthorizes, and on bursts. Treat it as temporary, not as disconnected.
 */
export function isTemporaryTikTokError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /access denied|scope|rate limit|too many|timeout|timed out|internal|system busy|ECONNRESET|fetch failed/i.test(msg);
}
