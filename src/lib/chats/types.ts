/** Shapes the chat APIs send to the screens. No raw platform payloads. */

export type ChatPlatform = "SHOPEE" | "TIKTOK";
export const CHAT_PLATFORMS: readonly ChatPlatform[] = ["SHOPEE", "TIKTOK"];

export interface ChatListItem {
  id: string;
  platform: ChatPlatform;
  buyerName: string;
  buyerAvatarUrl: string | null;
  preview: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface ChatUnread {
  SHOPEE: number;
  TIKTOK: number;
  total: number;
}

export interface ChatCard {
  itemName: string;
  imageUrl: string | null;
  variation: string | null;
  orderSn: string | null;
  pricePhp: number | null;
  /** Delivery-status card: courier and tracking go in `variation`. */
  logistics?: boolean;
  /** TikTok product id of a product card (for the assistant's listing lookup). */
  productId?: string | null;
}

export interface ChatMessageView {
  id: string;
  /** ROBOT: the shop's TikTok auto-reply. SYSTEM: platform notices. */
  sender: "BUYER" | "SELLER" | "ROBOT" | "SYSTEM";
  kind: "TEXT" | "IMAGE" | "ORDER_CARD" | "PRODUCT_CARD" | "OTHER";
  text: string | null;
  imageUrl: string | null;
  card: ChatCard | null;
  sentAt: string;
  status: "SENDING" | "SENT" | "FAILED";
  clientKey: string | null;
  /** A shop-side message sent by a tool, not a person (Duoke's "please wait"). */
  autoBy?: "duoke" | null;
}

/** The assistant's suggested reply (never sent without the owner, except in test chats). */
export interface ChatDraftView {
  id: string;
  text: string;
  source: "TEMPLATE" | "AI" | "SAVED";
  intent: string;
  basis: string;
  rating: "good" | "bad" | null;
}

export interface OrderPanel {
  orderSn: string;
  photoUrl: string | null;
  itemName: string;
  variation: string | null;
  /** More pieces in the order beyond the first item. */
  moreItems: number;
  statusLabel: string;
  carrier: string | null;
  trackingNumber: string | null;
}

export interface ChatThread {
  id: string;
  platform: ChatPlatform;
  buyerName: string;
  buyerAvatarUrl: string | null;
  sample: boolean;
  /** Replies can be sent from Kyna Ops in this chat. */
  canReply: boolean;
  /** The photo button shows (sample chats now; TikTok later). */
  canSendPhotos: boolean;
  /** Why not, in plain words, when canReply is false. */
  replyNote: string | null;
  order: OrderPanel | null;
  messages: ChatMessageView[];
  /** Chats assistant draft for the newest buyer question, if any. */
  draft: ChatDraftView | null;
  /** "Suggest a reply" shows: a question is waiting and the AI can try. */
  canSuggest: boolean;
  /** Nothing suggested yet for the newest question: the screen asks the AI right away. */
  autoSuggest?: boolean;
}

/** Preview line for the chat list. `from` true means the shop (old callers). */
export function previewFor(
  kind: ChatMessageView["kind"],
  text: string | null,
  from: boolean | ChatMessageView["sender"]
): string {
  const body =
    kind === "IMAGE"
      ? "Photo"
      : kind === "ORDER_CARD"
        ? "Order"
        : kind === "PRODUCT_CARD"
          ? "Product"
          : (text ?? "").replace(/\s+/g, " ").trim() || (kind === "OTHER" ? "Other message" : "Message");
  const prefix = from === true || from === "SELLER" ? "You: " : from === "ROBOT" ? "Auto-reply: " : "";
  return `${prefix}${body}`.slice(0, 140);
}
