import { randomBytes } from "crypto";

/**
 * Where replies actually go. Sample chats only write to our database. TikTok
 * marks chats read for real; sending to TikTok is switched on separately once
 * it has been tried with a test buyer. Shopee plugs in later.
 */
export interface ChatSourceConversation {
  id: string;
  externalId: string;
  platform: "SHOPEE" | "TIKTOK";
  shopConnectionId: string;
}

export type ChatOutgoing = { text: string } | { imageUrl: string };

export interface ChatSource {
  send(conv: ChatSourceConversation, message: ChatOutgoing): Promise<{ externalId: string; sentAt: Date }>;
  markRead(conv: ChatSourceConversation): Promise<void>;
}

/** Replying isn't switched on for this shop yet. */
export class ChatSendDisabledError extends Error {}

export const demoChatSource: ChatSource = {
  async send() {
    return { externalId: `demo-out-${randomBytes(8).toString("hex")}`, sentAt: new Date() };
  },
  async markRead() {
    // Nothing to tell: sample chats live only in our database.
  },
};

export interface ChatShopRef {
  isDemo: boolean;
  platform: string;
  accessToken?: string | null;
  chatAccessAt?: Date | null;
}

/** Whether this real shop's chats come from the platform (they replace the sample chats). */
export function isChatLive(shop: ChatShopRef): boolean {
  return !shop.isDemo && shop.platform === "TIKTOK" && Boolean(shop.accessToken) && Boolean(shop.chatAccessAt);
}

/**
 * CHAT_SEND_TIKTOK: unset or "off" = no replies to real TikTok chats; "all" =
 * every chat; otherwise a comma list of TikTok conversation ids (test buyers).
 */
export function tiktokSendSetting(raw: string | undefined = process.env.CHAT_SEND_TIKTOK): "off" | "all" | Set<string> {
  const v = raw?.trim();
  if (!v || v.toLowerCase() === "off") return "off";
  if (v.toLowerCase() === "all") return "all";
  return new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Resolves the effective TikTok send policy from the owner Settings switch and
 * optional CHAT_SEND_TIKTOK env override (test-buyer allowlist while switch is off).
 */
export function resolveChatSendSetting(
  chatSendEnabled: boolean,
  rawEnv: string | undefined = process.env.CHAT_SEND_TIKTOK
): "off" | "all" | Set<string> {
  if (chatSendEnabled) return "all";
  const env = tiktokSendSetting(rawEnv);
  return env instanceof Set ? env : "off";
}

/** Replying from Kyna Ops: always for sample chats; for TikTok when Settings allows it (or test allowlist). */
export function canSendFrom(shop: ChatShopRef, conversationExternalId?: string, setting = tiktokSendSetting()): boolean {
  if (shop.isDemo) return true;
  if (shop.platform !== "TIKTOK" || setting === "off") return false;
  if (setting === "all") return true;
  return Boolean(conversationExternalId && setting.has(conversationExternalId));
}

/** Photos: sample chats and TikTok (Shopee later). Still subject to canSendFrom. */
export function canSendPhotosFrom(shop: ChatShopRef): boolean {
  return shop.isDemo || shop.platform === "TIKTOK";
}

export const REPLY_OFF_NOTE = "Replying from Kyna Ops is switched off. Turn it on in Settings → Chats assistant, or reply in TikTok Seller Center.";
export const PHOTO_OFF_NOTE = "Sending photos from Kyna Ops isn't available for this shop yet.";

const tiktokChatSource: ChatSource = {
  async send(conv, message) {
    const [{ prisma }, { ensureFreshToken }, api] = await Promise.all([
      import("@/lib/prisma"),
      import("@/lib/connectors/tokens"),
      import("./tiktok-api"),
    ]);
    const shop = await prisma.shopConnection.findUnique({ where: { id: conv.shopConnectionId } });
    if (!shop?.accessToken || !shop.shopCipher) throw new Error("The TikTok shop isn't connected.");
    const token = await ensureFreshToken(shop);
    const creds = { accessToken: token, shopCipher: shop.shopCipher };
    let id: string | null;
    if ("text" in message) {
      id = await api.sendTextMessage(api.tiktokCaller(creds), conv.externalId, message.text);
    } else {
      // The photo was saved in Kyna Ops first; hand the same file to TikTok.
      const { readChatPhoto } = await import("@/lib/storage");
      const photo = await readChatPhoto(message.imageUrl);
      const image = await api.uploadChatImage(
        api.tiktokUploader(creds),
        new Blob([new Uint8Array(photo.buffer)], { type: photo.format.contentType }),
        photo.fileName
      );
      id = await api.sendImageMessage(api.tiktokCaller(creds), conv.externalId, image);
    }
    // Without an id the next sync would store our reply a second time; keep a unique placeholder.
    return { externalId: id ?? `sent-${randomBytes(8).toString("hex")}`, sentAt: new Date() };
  },
  async markRead(conv) {
    // Loaded lazily: keeps the TikTok client out of sample-only code paths and tests.
    const [{ prisma }, { ensureFreshToken }, api] = await Promise.all([
      import("@/lib/prisma"),
      import("@/lib/connectors/tokens"),
      import("./tiktok-api"),
    ]);
    const shop = await prisma.shopConnection.findUnique({ where: { id: conv.shopConnectionId } });
    if (!shop?.accessToken || !shop.shopCipher) return;
    const token = await ensureFreshToken(shop);
    await api.markConversationRead(api.tiktokCaller({ accessToken: token, shopCipher: shop.shopCipher }), conv.externalId);
  },
};

export function chatSourceFor(shop: ChatShopRef): ChatSource {
  if (shop.isDemo) return demoChatSource;
  if (shop.platform === "TIKTOK") return tiktokChatSource;
  throw new Error("Chats for this shop aren't connected yet.");
}
