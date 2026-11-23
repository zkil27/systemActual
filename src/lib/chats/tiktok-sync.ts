import { Platform, Prisma, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { notifyNewBuyerMessage } from "./notify";
import {
  isTemporaryTikTokError,
  listConversations,
  listMessages,
  tiktokCaller,
  type TtCall,
  type TtMessage,
} from "./tiktok-api";
import {
  latestOrderSn,
  normalizeConversation,
  normalizeMessage,
  type NormalizedMessage,
} from "./tiktok-normalize";
import { previewFor } from "./types";

/** Recent chats loaded the first time. Older ones stay in TikTok Seller Center. */
export const FIRST_IMPORT_CONVERSATION_PAGES = 3;
/** Pages of 10 messages read per chat: fewer on first import. */
export const FIRST_IMPORT_MESSAGE_PAGES = 2;
export const UPDATE_MESSAGE_PAGES = 5;
/** Pages of the chat list read on a normal check (stops early when nothing changed). */
export const UPDATE_CONVERSATION_PAGES = 5;

/**
 * Reads a chat's messages newest first until it reaches ones we already have.
 * Returns them oldest first. Pure apart from `call`.
 */
export async function collectNewMessages(
  call: TtCall,
  conversationId: string,
  opts: { knownIds: Set<string>; since: Date | null; maxPages: number }
): Promise<TtMessage[]> {
  const out: TtMessage[] = [];
  let token: string | null = null;
  for (let page = 0; page < opts.maxPages; page++) {
    const res = await listMessages(call, conversationId, token);
    let reachedKnown = false;
    for (const m of res.messages) {
      const id = String(m.id);
      const sentMs = Number(m.create_time) * (Number(m.create_time) > 1e12 ? 1 : 1000);
      // Newest first: everything after a known (or older) message is already stored.
      // A minute of overlap on time, since TikTok times are whole seconds; duplicates are skipped on save.
      if (opts.knownIds.has(id) || (opts.since && sentMs < opts.since.getTime() - 60_000)) {
        reachedKnown = true;
        break;
      }
      out.push(m);
    }
    token = res.nextPageToken;
    if (reachedKnown || !token) break;
  }
  return out.reverse();
}

type CardData = Prisma.InputJsonValue;

/** Fills order, delivery and product cards with what Kyna Ops knows about them. */
async function buildCards(messages: NormalizedMessage[]): Promise<Map<string, CardData>> {
  const orderSns = [...new Set(messages.map((m) => m.orderSn).filter((s): s is string => Boolean(s)))];
  const productIds = [...new Set(messages.map((m) => m.productId).filter((s): s is string => Boolean(s)))];
  const [orders, listings] = await Promise.all([
    orderSns.length
      ? prisma.order.findMany({
          where: { platform: Platform.TIKTOK, orderSn: { in: orderSns } },
          select: {
            orderSn: true,
            lines: { select: { name: true, variationName: true, imageUrl: true }, take: 1 },
            packages: { select: { packageNumber: true, trackingNumber: true, carrier: true } },
          },
        })
      : [],
    productIds.length
      ? prisma.listingVariant.findMany({
          where: { platform: Platform.TIKTOK, listingId: { in: productIds } },
          select: { listingId: true, name: true, imageUrl: true },
          distinct: ["listingId"],
        })
      : [],
  ]);
  const orderBySn = new Map(orders.map((o) => [o.orderSn, o]));
  const listingById = new Map(listings.map((l) => [l.listingId, l]));

  const cards = new Map<string, CardData>();
  for (const m of messages) {
    if (m.kind === "ORDER_CARD") {
      const o = m.orderSn ? orderBySn.get(m.orderSn) : undefined;
      const line = o?.lines[0];
      if (m.logistics) {
        const pkg = o?.packages.find((p) => p.packageNumber === m.packageId) ?? o?.packages.find((p) => p.trackingNumber);
        const delivery = [pkg?.carrier ? normalizeCourierName(pkg.carrier) : null, pkg?.trackingNumber].filter(Boolean).join(" · ");
        cards.set(m.externalId, {
          itemName: "Delivery update",
          imageUrl: line?.imageUrl ?? null,
          variation: delivery || line?.name || null,
          orderSn: m.orderSn,
          logistics: true,
        });
      } else {
        cards.set(m.externalId, {
          itemName: line?.name ?? "Order",
          imageUrl: line?.imageUrl ?? null,
          variation: line?.variationName ?? null,
          orderSn: m.orderSn,
        });
      }
    } else if (m.kind === "PRODUCT_CARD") {
      const l = m.productId ? listingById.get(m.productId) : undefined;
      cards.set(m.externalId, { itemName: l?.name ?? "Product", imageUrl: l?.imageUrl ?? null });
    }
  }
  return cards;
}

/** Saves new messages, skipping ones already stored. Returns how many buyer messages were new. */
async function saveMessages(conversationId: string, messages: NormalizedMessage[]): Promise<number> {
  if (messages.length === 0) return 0;
  const cards = await buildCards(messages);
  const existing = await prisma.chatMessage.findMany({
    where: { conversationId, externalId: { in: messages.map((m) => m.externalId) } },
    select: { externalId: true },
  });
  const have = new Set(existing.map((e) => e.externalId));
  const fresh = messages.filter((m) => !have.has(m.externalId));
  if (fresh.length === 0) return 0;
  await prisma.chatMessage.createMany({
    data: fresh.map((m) => ({
      conversationId,
      externalId: m.externalId,
      sender: m.sender,
      kind: m.kind,
      text: m.text,
      imageUrl: m.imageUrl,
      cardData: cards.get(m.externalId) ?? Prisma.JsonNull,
      sentAt: m.sentAt,
      status: "SENT" as const,
    })),
    skipDuplicates: true,
  });
  return fresh.filter((m) => m.sender === "BUYER").length;
}

/**
 * Time of the newest stored message, and a preview from the newest one worth
 * reading: TikTok's bot cards and notices would make every row say the same thing.
 */
async function latestStored(conversationId: string) {
  const select = { kind: true, text: true, sender: true, sentAt: true } as const;
  const order = [{ sentAt: "desc" as const }, { id: "desc" as const }];
  const [newest, meaningful] = await Promise.all([
    prisma.chatMessage.findFirst({ where: { conversationId }, orderBy: order, select }),
    prisma.chatMessage.findFirst({
      where: { conversationId, sender: { not: "SYSTEM" }, NOT: { sender: "ROBOT", kind: "OTHER" } },
      orderBy: order,
      select,
    }),
  ]);
  if (!newest) return null;
  const p = meaningful ?? newest;
  return { at: newest.sentAt, preview: previewFor(p.kind, p.text, p.sender) };
}

async function recentExternalIds(conversationId: string): Promise<Set<string>> {
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId, externalId: { not: null } },
    orderBy: { sentAt: "desc" },
    take: 30,
    select: { externalId: true },
  });
  return new Set(rows.map((r) => r.externalId as string));
}

export interface ChatSyncResult {
  ran: boolean;
  conversations: number;
  newBuyerMessages: number;
  error?: string;
}

type TikTokShop = Pick<
  ShopConnection,
  | "id"
  | "platform"
  | "shopId"
  | "shopName"
  | "accessToken"
  | "refreshToken"
  | "tokenExpiresAt"
  | "tokenErrorAt"
  | "shopCipher"
  | "chatAccessAt"
  | "isDemo"
>;

async function callerFor(shop: TikTokShop): Promise<TtCall> {
  const token = await ensureFreshToken(shop);
  return tiktokCaller({ accessToken: token, shopCipher: shop.shopCipher as string });
}

/** Takes the shop's "checking chats" slot if the last check was at least `minIntervalMs` ago. */
async function claimShopCheck(shopId: string, minIntervalMs: number, now: Date): Promise<boolean> {
  const res = await prisma.shopConnection.updateMany({
    where: {
      id: shopId,
      OR: [{ chatsCheckedAt: null }, { chatsCheckedAt: { lt: new Date(now.getTime() - minIntervalMs) } }],
    },
    data: { chatsCheckedAt: now },
  });
  return res.count === 1;
}

/**
 * Brings the shop's changed TikTok chats into Kyna Ops. Read-only on TikTok.
 * Throttled per shop, so many callers (open screens, webhooks, the tick) are fine.
 */
export async function syncTikTokChats(
  shop: TikTokShop,
  opts: { deadline: number; minIntervalMs?: number; now?: Date }
): Promise<ChatSyncResult> {
  const result: ChatSyncResult = { ran: false, conversations: 0, newBuyerMessages: 0 };
  if (shop.isDemo || shop.platform !== Platform.TIKTOK || !shop.accessToken || !shop.shopCipher) return result;
  const now = opts.now ?? new Date();
  if (!(await claimShopCheck(shop.id, opts.minIntervalMs ?? 15_000, now))) return result;
  result.ran = true;

  const firstImport = !shop.chatAccessAt;
  try {
    const call = await callerFor(shop);
    let pageToken: string | null = null;
    const maxPages = firstImport ? FIRST_IMPORT_CONVERSATION_PAGES : UPDATE_CONVERSATION_PAGES;

    for (let page = 0; page < maxPages && Date.now() < opts.deadline; page++) {
      const list = await listConversations(call, pageToken);
      const convs = list.conversations.map((c) => ({ raw: c, n: normalizeConversation(c) }));
      const stored = await prisma.chatConversation.findMany({
        where: { shopConnectionId: shop.id, externalId: { in: convs.map((c) => c.n.externalId) } },
        select: {
          id: true,
          externalId: true,
          lastMessageAt: true,
          unreadCount: true,
          canReply: true,
          orderSn: true,
          remoteCheckedAt: true,
        },
      });
      const byExt = new Map(stored.map((s) => [s.externalId, s]));
      let changedOnPage = 0;

      for (const { n } of convs) {
        if (Date.now() >= opts.deadline) break;
        const have = byExt.get(n.externalId);
        // A chat whose messages never finished loading (remoteCheckedAt unset) counts as changed.
        const changed =
          !have || !have.remoteCheckedAt || n.lastMessageAt.getTime() > have.lastMessageAt.getTime() + 999;
        if (!changed) {
          // Read elsewhere (Seller Center) or reply turned off: keep the badge honest.
          if (have.unreadCount !== n.unreadCount || have.canReply !== n.canReply) {
            await prisma.chatConversation.update({
              where: { id: have.id },
              data: { unreadCount: n.unreadCount, canReply: n.canReply },
            });
          }
          continue;
        }
        changedOnPage++;

        const conv =
          have ??
          (await prisma.chatConversation.upsert({
            where: { shopConnectionId_externalId: { shopConnectionId: shop.id, externalId: n.externalId } },
            create: {
              shopConnectionId: shop.id,
              platform: Platform.TIKTOK,
              externalId: n.externalId,
              buyerName: n.buyerName,
              buyerAvatarUrl: n.buyerAvatarUrl,
              lastMessageAt: n.lastMessageAt,
              unreadCount: n.unreadCount,
              canReply: n.canReply,
            },
            update: {},
            select: {
              id: true,
              externalId: true,
              lastMessageAt: true,
              unreadCount: true,
              canReply: true,
              orderSn: true,
              remoteCheckedAt: true,
            },
          }));
        const loadedBefore = Boolean(have?.remoteCheckedAt);

        const raw = await collectNewMessages(call, n.externalId, {
          knownIds: loadedBefore ? await recentExternalIds(conv.id) : new Set(),
          since: loadedBefore ? conv.lastMessageAt : null,
          maxPages: firstImport || !loadedBefore ? FIRST_IMPORT_MESSAGE_PAGES : UPDATE_MESSAGE_PAGES,
        });
        const normalized = raw.map(normalizeMessage).filter((m): m is NormalizedMessage => m !== null);
        const newBuyer = await saveMessages(conv.id, normalized);
        // Alert only for real news: not the first import, and not a chat's backlog.
        if (!firstImport) result.newBuyerMessages += loadedBefore ? newBuyer : Math.min(newBuyer, n.unreadCount);

        const latest = await latestStored(conv.id);
        await prisma.chatConversation.update({
          where: { id: conv.id },
          data: {
            buyerName: n.buyerName,
            buyerAvatarUrl: n.buyerAvatarUrl,
            lastMessageAt: latest && latest.at > n.lastMessageAt ? latest.at : n.lastMessageAt,
            lastMessagePreview: latest?.preview ?? "",
            unreadCount: n.unreadCount,
            canReply: n.canReply,
            orderSn: latestOrderSn(normalized) ?? conv.orderSn,
            remoteCheckedAt: new Date(),
          },
        });
        result.conversations++;
      }

      pageToken = list.nextPageToken;
      // Newest first: a page with nothing new means the rest is unchanged too.
      if (!pageToken || (!firstImport && changedOnPage === 0)) break;
    }

    if (firstImport) {
      await prisma.shopConnection.update({ where: { id: shop.id }, data: { chatAccessAt: new Date() } });
    }
    if (result.newBuyerMessages > 0) {
      await notifyNewBuyerMessage({ count: result.newBuyerMessages }).catch((err) =>
        console.error("[chats] alert", err instanceof Error ? err.message : err)
      );
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[chats] TikTok sync ${isTemporaryTikTokError(err) ? "(temporary)" : ""}`, result.error);
  }
  return result;
}

/** Fresh messages for one open chat. Throttled per chat. Returns true when it checked. */
export async function refreshTikTokConversation(
  conversationId: string,
  opts: { minIntervalMs?: number } = {}
): Promise<boolean> {
  const now = new Date();
  const claimed = await prisma.chatConversation.updateMany({
    where: {
      id: conversationId,
      platform: Platform.TIKTOK,
      shopConnection: { isDemo: false },
      OR: [
        { remoteCheckedAt: null },
        { remoteCheckedAt: { lt: new Date(now.getTime() - (opts.minIntervalMs ?? 4_000)) } },
      ],
    },
    data: { remoteCheckedAt: now },
  });
  if (claimed.count !== 1) return false;

  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: { id: true, externalId: true, lastMessageAt: true, orderSn: true, shopConnection: true },
  });
  if (!conv?.shopConnection.accessToken || !conv.shopConnection.shopCipher) return false;
  try {
    const call = await callerFor(conv.shopConnection);
    const raw = await collectNewMessages(call, conv.externalId, {
      knownIds: await recentExternalIds(conv.id),
      since: conv.lastMessageAt,
      maxPages: UPDATE_MESSAGE_PAGES,
    });
    const normalized = raw.map(normalizeMessage).filter((m): m is NormalizedMessage => m !== null);
    const newBuyer = await saveMessages(conv.id, normalized);
    if (normalized.length > 0) {
      const latest = await latestStored(conv.id);
      await prisma.chatConversation.update({
        where: { id: conv.id },
        data: {
          ...(latest ? { lastMessageAt: latest.at, lastMessagePreview: latest.preview } : {}),
          orderSn: latestOrderSn(normalized) ?? conv.orderSn,
        },
      });
    }
    // The owner is looking at this chat, so no Telegram alert for it.
    void newBuyer;
    return true;
  } catch (err) {
    console.error("[chats] TikTok refresh", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Chat sync for every connected TikTok shop (worker tick, webhooks). */
export async function syncAllTikTokChats(deadline: number, minIntervalMs = 60_000): Promise<ChatSyncResult[]> {
  const shops = await prisma.shopConnection.findMany({
    where: { platform: Platform.TIKTOK, isDemo: false, accessToken: { not: null }, shopCipher: { not: null } },
  });
  const out: ChatSyncResult[] = [];
  for (const shop of shops) out.push(await syncTikTokChats(shop, { deadline, minIntervalMs }));
  return out;
}
