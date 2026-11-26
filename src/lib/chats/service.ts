import { ActionRequestStatus, ChatMessageStatus, Platform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildOrderPanel } from "./order-panel";
import { sendReply, type ReplyContent, type ReplyStore, type StoredReply } from "./send";
import {
  canSendFrom,
  canSendPhotosFrom,
  ChatSendDisabledError,
  chatSourceFor,
  PHOTO_OFF_NOTE,
  REPLY_OFF_NOTE,
  resolveChatSendSetting,
  tiktokSendSetting,
} from "./source";

export { ChatSendDisabledError };
import { refreshDraft } from "@/lib/ai/drafts";
import { isHoldingReply } from "@/lib/ai/intent";
import { getAiSettings } from "@/lib/ai/settings-store";
import { chatsComingSoon } from "./format";
import type { ChatCard, ChatListItem, ChatMessageView, ChatPlatform, ChatThread, ChatUnread } from "./types";

export const CHAT_PAGE_SIZE = 30;
/** First load of a thread. Older messages stay in the shop app. */
export const THREAD_MESSAGE_LIMIT = 200;

/** Real shops only. Shopee chats are coming soon, so none are listed or counted. */
export async function listChats(
  platform: ChatPlatform,
  cursor?: string | null
): Promise<{ items: ChatListItem[]; nextCursor: string | null; comingSoon: boolean }> {
  if (chatsComingSoon(platform)) return { items: [], nextCursor: null, comingSoon: true };
  const rows = await prisma.chatConversation.findMany({
    where: { platform: platform as Platform, shopConnection: { isDemo: false } },
    orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
    take: CHAT_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      platform: true,
      buyerName: true,
      buyerAvatarUrl: true,
      lastMessagePreview: true,
      lastMessageAt: true,
      unreadCount: true,
    },
  });
  const page = rows.slice(0, CHAT_PAGE_SIZE);
  return {
    items: page.map((r) => ({
      id: r.id,
      platform: r.platform as ChatPlatform,
      buyerName: r.buyerName,
      buyerAvatarUrl: r.buyerAvatarUrl,
      preview: r.lastMessagePreview,
      lastMessageAt: r.lastMessageAt.toISOString(),
      unreadCount: r.unreadCount,
    })),
    nextCursor: rows.length > CHAT_PAGE_SIZE ? page[page.length - 1].id : null,
    comingSoon: false,
  };
}

/** Sums unread per platform. Skips sample shops and platforms whose chats are coming soon. */
export function sumUnread(groups: Array<{ platform: string; isDemo: boolean; unread: number }>): ChatUnread {
  const out: ChatUnread = { SHOPEE: 0, TIKTOK: 0, total: 0 };
  for (const g of groups) {
    if (g.platform !== "SHOPEE" && g.platform !== "TIKTOK") continue;
    if (g.isDemo || chatsComingSoon(g.platform)) continue;
    out[g.platform] += g.unread;
  }
  out.total = out.SHOPEE + out.TIKTOK;
  return out;
}

export async function unreadTotals(): Promise<ChatUnread> {
  // Only unread chats, so this stays small however many chats there are.
  const rows = await prisma.chatConversation.findMany({
    where: { unreadCount: { gt: 0 }, shopConnection: { isDemo: false } },
    select: { platform: true, unreadCount: true },
  });
  return sumUnread(rows.map((r) => ({ platform: r.platform, isDemo: false, unread: r.unreadCount })));
}

export function toCard(raw: Prisma.JsonValue | null): ChatCard | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
  const itemName = str(r.itemName);
  if (!itemName) return null;
  return {
    itemName,
    imageUrl: str(r.imageUrl),
    variation: str(r.variation),
    orderSn: str(r.orderSn),
    pricePhp: typeof r.pricePhp === "number" ? r.pricePhp : null,
    ...(r.logistics === true ? { logistics: true } : {}),
    ...(str(r.productId) ? { productId: str(r.productId) } : {}),
  };
}

const messageSelect = {
  id: true,
  sender: true,
  kind: true,
  text: true,
  imageUrl: true,
  cardData: true,
  sentAt: true,
  status: true,
  clientKey: true,
} satisfies Prisma.ChatMessageSelect;

type MessageRow = Prisma.ChatMessageGetPayload<{ select: typeof messageSelect }>;

export function toMessageView(m: MessageRow): ChatMessageView {
  return {
    id: m.id,
    sender: m.sender,
    kind: m.kind,
    text: m.text,
    imageUrl: m.imageUrl,
    card: toCard(m.cardData),
    sentAt: m.sentAt.toISOString(),
    status: m.status,
    clientKey: m.clientKey,
    autoBy: m.sender === "SELLER" && m.kind === "TEXT" && !m.clientKey && isHoldingReply(m.text) ? "duoke" : null,
  };
}

async function draftFor(conversationId: string): Promise<Pick<ChatThread, "draft" | "canSuggest" | "autoSuggest">> {
  try {
    const r = await refreshDraft(conversationId);
    return { draft: r.draft, canSuggest: r.canSuggest, autoSuggest: Boolean(r.autoSuggest) };
  } catch (err) {
    console.error("[assistant] draft", conversationId, err instanceof Error ? err.message : err);
    return { draft: null, canSuggest: false, autoSuggest: false };
  }
}

/**
 * One chat with its order. With `afterId`, only messages newer than that one
 * (for polling). Returns null when the chat doesn't exist or isn't shown.
 */
export async function getThread(id: string, afterId?: string | null): Promise<ChatThread | null> {
  const conv = await prisma.chatConversation.findUnique({
    where: { id },
    select: {
      id: true,
      platform: true,
      buyerName: true,
      buyerAvatarUrl: true,
      orderSn: true,
      sampleOrder: true,
      canReply: true,
      externalId: true,
      shopConnection: { select: { isDemo: true, platform: true, accessToken: true, chatAccessAt: true } },
    },
  });
  if (!conv) return null;

  // Open real TikTok chat: fetch anything new before answering (throttled).
  if (!conv.shopConnection.isDemo && conv.platform === Platform.TIKTOK) {
    const { refreshTikTokConversation } = await import("./tiktok-sync");
    await refreshTikTokConversation(conv.id).catch(() => false);
  }

  let messages: MessageRow[];
  const after = afterId
    ? await prisma.chatMessage.findFirst({
        where: { id: afterId, conversationId: id },
        select: { id: true, sentAt: true },
      })
    : null;
  if (after) {
    messages = await prisma.chatMessage.findMany({
      where: {
        conversationId: id,
        OR: [{ sentAt: { gt: after.sentAt } }, { sentAt: after.sentAt, id: { gt: after.id } }],
      },
      orderBy: [{ sentAt: "asc" }, { id: "asc" }],
      take: THREAD_MESSAGE_LIMIT,
      select: messageSelect,
    });
  } else {
    const latest = await prisma.chatMessage.findMany({
      where: { conversationId: id },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take: THREAD_MESSAGE_LIMIT,
      select: messageSelect,
    });
    messages = latest.reverse();
  }

  const order =
    !conv.shopConnection.isDemo && conv.orderSn
      ? await prisma.order.findUnique({
          where: { platform_orderSn: { platform: conv.platform, orderSn: conv.orderSn } },
          select: {
            orderSn: true,
            status: true,
            cancelRequested: true,
            lines: { select: { name: true, variationName: true, imageUrl: true, quantity: true } },
            packages: { select: { trackingNumber: true, carrier: true } },
          },
        })
      : null;

  const [draft, ai] = await Promise.all([draftFor(conv.id), getAiSettings()]);

  return {
    id: conv.id,
    platform: conv.platform as ChatPlatform,
    buyerName: conv.buyerName,
    buyerAvatarUrl: conv.buyerAvatarUrl,
    ...replyState(
      conv.canReply,
      conv.shopConnection,
      conv.externalId,
      resolveChatSendSetting(ai.chatSendEnabled)
    ),
    order: buildOrderPanel({ order, sampleOrder: conv.shopConnection.isDemo ? conv.sampleOrder : null }),
    messages: messages.map(toMessageView),
    ...draft,
  };
}

/** Whether the reply box shows, and what to say instead when it doesn't. */
export function replyState(
  convCanReply: boolean,
  shop: { isDemo: boolean; platform: string },
  conversationExternalId?: string,
  setting?: ReturnType<typeof tiktokSendSetting>
): { canReply: boolean; canSendPhotos: boolean; replyNote: string | null } {
  if (!convCanReply) {
    return { canReply: false, canSendPhotos: false, replyNote: "TikTok doesn't allow replies in this chat anymore." };
  }
  if (!canSendFrom(shop, conversationExternalId, setting)) {
    return { canReply: false, canSendPhotos: false, replyNote: REPLY_OFF_NOTE };
  }
  return { canReply: true, canSendPhotos: canSendPhotosFrom(shop), replyNote: null };
}

async function loadSourceConversation(id: string) {
  return prisma.chatConversation.findUnique({
    where: { id },
    select: {
      id: true,
      externalId: true,
      platform: true,
      shopConnectionId: true,
      unreadCount: true,
      shopConnection: { select: { isDemo: true, platform: true } },
    },
  });
}

/**
 * Clears the unread count. Safe to call again: a chat that's already read
 * doesn't tell the shop twice. Returns false when the chat doesn't exist.
 */
export async function markChatRead(
  id: string,
  deps: {
    load: typeof loadSourceConversation;
    clear: (id: string) => Promise<number>;
    sourceFor: typeof chatSourceFor;
  } = {
    load: loadSourceConversation,
    clear: async (convId) =>
      (await prisma.chatConversation.updateMany({ where: { id: convId, unreadCount: { gt: 0 } }, data: { unreadCount: 0 } }))
        .count,
    sourceFor: chatSourceFor,
  }
): Promise<boolean> {
  const conv = await deps.load(id);
  if (!conv) return false;
  if (conv.unreadCount <= 0) return true;
  const cleared = await deps.clear(id);
  if (cleared > 0) {
    try {
      await deps.sourceFor(conv.shopConnection).markRead({ ...conv, platform: conv.platform as ChatPlatform });
    } catch (err) {
      console.error("[chats] mark read", id, err instanceof Error ? err.message : err);
    }
  }
  return true;
}

const replySelect = {
  id: true,
  conversationId: true,
  clientKey: true,
  kind: true,
  text: true,
  imageUrl: true,
  sentAt: true,
  status: true,
} satisfies Prisma.ChatMessageSelect;

function asStored(m: Prisma.ChatMessageGetPayload<{ select: typeof replySelect }>): StoredReply {
  return { ...m, kind: m.kind === "IMAGE" ? "IMAGE" : "TEXT" };
}

export const prismaReplyStore: ReplyStore = {
  async findByClientKey(clientKey) {
    const m = await prisma.chatMessage.findUnique({ where: { clientKey }, select: replySelect });
    return m ? asStored(m) : null;
  },
  async create(data) {
    try {
      const m = await prisma.chatMessage.create({
        data: { ...data, sender: "SELLER", status: ChatMessageStatus.SENDING },
        select: replySelect,
      });
      return asStored(m);
    } catch (err) {
      // Two taps raced: the other request already saved this clientKey.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const m = await prisma.chatMessage.findUnique({ where: { clientKey: data.clientKey }, select: replySelect });
        if (m) return asStored(m);
      }
      throw err;
    }
  },
  async claimForRetry(id) {
    const res = await prisma.chatMessage.updateMany({
      where: { id, status: ChatMessageStatus.FAILED },
      data: { status: ChatMessageStatus.SENDING },
    });
    return res.count > 0;
  },
  async finish(id, result) {
    const m = await prisma.chatMessage.update({
      where: { id },
      data: result.status === "SENT" ? { status: "SENT", externalId: result.externalId } : { status: "FAILED" },
      select: replySelect,
    });
    return asStored(m);
  },
  async touchConversation(conversationId, at, preview) {
    await prisma.chatConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: at, lastMessagePreview: preview },
    });
  },
};

export class ChatNotFoundError extends Error {}

const HUMAN_REPLY_AI_PAUSE_MS = 2 * 3600_000;

export async function sendChatMessage(
  id: string,
  clientKey: string,
  content: ReplyContent,
  opts: { isAutoReply?: boolean; pauseAi?: boolean } = {}
): Promise<ChatMessageView> {
  const [conv, ai] = await Promise.all([loadSourceConversation(id), getAiSettings()]);
  if (!conv) throw new ChatNotFoundError("Chat not found.");
  const sendSetting = resolveChatSendSetting(ai.chatSendEnabled);
  // Refuse before saving anything, so no "Not sent" bubble is left behind.
  if (!canSendFrom(conv.shopConnection, conv.externalId, sendSetting)) {
    throw new ChatSendDisabledError(REPLY_OFF_NOTE);
  }
  if ("imageUrl" in content && !canSendPhotosFrom(conv.shopConnection)) {
    throw new ChatSendDisabledError(PHOTO_OFF_NOTE);
  }
  const source = chatSourceFor(conv.shopConnection);
  const stored = await sendReply(
    { conversation: { ...conv, platform: conv.platform as ChatPlatform }, clientKey, content },
    { store: prismaReplyStore, source }
  );
  if (!opts.isAutoReply && stored.status === "SENT") {
    const pauseUntil = new Date(Date.now() + HUMAN_REPLY_AI_PAUSE_MS);
    await Promise.all([
      opts.pauseAi === false
        ? Promise.resolve()
        : prisma.chatConversation.update({
            where: { id },
            data: { aiPausedUntil: pauseUntil },
          }),
      prisma.actionRequest.updateMany({
        where: {
          conversationId: id,
          kind: "chat.reply",
          status: ActionRequestStatus.PENDING,
        },
        data: { status: ActionRequestStatus.EXPIRED },
      }),
    ]).catch((err) => console.error("[chats] pause after reply", id, err));
  }
  const row = await prisma.chatMessage.findUniqueOrThrow({ where: { id: stored.id }, select: messageSelect });
  return toMessageView(row);
}

/** Checked before uploading a photo, so a refused photo is never stored. */
export async function canSendPhotoTo(id: string): Promise<boolean> {
  const [conv, ai] = await Promise.all([loadSourceConversation(id), getAiSettings()]);
  const sendSetting = resolveChatSendSetting(ai.chatSendEnabled);
  return Boolean(conv && canSendFrom(conv.shopConnection, conv.externalId, sendSetting) && canSendPhotosFrom(conv.shopConnection));
}

/** Whether a reply with this clientKey was already saved (so a retry can skip the upload). */
export async function findReplyByClientKey(clientKey: string) {
  return prisma.chatMessage.findUnique({ where: { clientKey }, select: { id: true, conversationId: true } });
}
