import { Platform, Prisma, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { normalizeCourierName } from "@/lib/connectors/normalizer";
import { isHoldingReply } from "@/lib/ai/intent";
import { notifyNewBuyerMessage } from "./notify";
import {
  isTemporaryShopeeChatError,
  listShopeeConversations,
  listShopeeMessages,
  shopeeChatCaller,
  type SpCall,
  type SpMessage,
} from "./shopee-api";
import {
  latestOrderSn,
  normalizeShopeeConversation,
  normalizeShopeeMessage,
  spTime,
  type NormalizedMessage,
} from "./shopee-normalize";
import type { ChatSyncResult } from "./tiktok-sync";
import { previewFor } from "./types";

/** Recent chats loaded the first time (3 × 25 = 75 conversations). */
export const SP_FIRST_IMPORT_CONVERSATION_PAGES = 3;
export const SP_FIRST_IMPORT_MESSAGE_PAGES = 1;
export const SP_UPDATE_CONVERSATION_PAGES = 4;
export const SP_UPDATE_MESSAGE_PAGES = 3;

/**
 * Reads a Shopee chat's messages newest-first until it hits ones we already have.
 * Returns them oldest-first. Pure apart from `call`.
 */
export async function collectNewShopeeMessages(
  call: SpCall,
  conversationId: string,
  opts: { knownIds: Set<string>; since: Date | null; maxPages: number }
): Promise<SpMessage[]> {
  const out: SpMessage[] = [];
  let offset: string | null = null;
  for (let page = 0; page < opts.maxPages; page++) {
    const res = await listShopeeMessages(call, conversationId, offset);
    let reachedKnown = false;
    for (const m of res.messages) {
      const id = String(m.message_id);
      const sentMs = spTime(m.created_timestamp).getTime();
      if (opts.knownIds.has(id) || (opts.since && sentMs > 0 && sentMs < opts.since.getTime() - 60_000)) {
        reachedKnown = true;
        break;
      }
      out.push(m);
    }
    offset = res.nextOffset;
    if (reachedKnown || !offset) break;
  }
  return out.reverse();
}

type CardData = Prisma.InputJsonValue;

async function buildShopeeCards(messages: NormalizedMessage[]): Promise<Map<string, CardData>> {
  const orderSns = [...new Set(messages.map((m) => m.orderSn).filter((s): s is string => Boolean(s)))];
  const productIds = [...new Set(messages.map((m) => m.productId).filter((s): s is string => Boolean(s)))];
  const [orders, listings] = await Promise.all([
    orderSns.length
      ? prisma.order.findMany({
          where: { platform: Platform.SHOPEE, orderSn: { in: orderSns } },
          select: {
            orderSn: true,
            lines: { select: { name: true, variationName: true, imageUrl: true }, take: 1 },
            packages: { select: { packageNumber: true, trackingNumber: true, carrier: true } },
          },
        })
      : [],
    productIds.length
      ? prisma.listingVariant.findMany({
          where: { platform: Platform.SHOPEE, listingId: { in: productIds } },
          select: { listingId: true, name: true, imageUrl: true, pricePhp: true },
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
      const pkg = o?.packages.find((p) => p.trackingNumber);
      const variation =
        line?.variationName ??
        ([pkg?.carrier ? normalizeCourierName(pkg.carrier) : null, pkg?.trackingNumber].filter(Boolean).join(" · ") ||
          null);
      cards.set(m.externalId, {
        itemName: line?.name ?? "Order",
        imageUrl: line?.imageUrl ?? null,
        variation,
        orderSn: m.orderSn,
      });
    } else if (m.kind === "PRODUCT_CARD") {
      const l = m.productId ? listingById.get(m.productId) : undefined;
      cards.set(m.externalId, {
        itemName: l?.name ?? "Product",
        imageUrl: l?.imageUrl ?? null,
        pricePhp: l?.pricePhp !== null && l?.pricePhp !== undefined ? Number(l.pricePhp) : null,
        productId: m.productId,
      });
    }
  }
  return cards;
}

async function saveShopeeMessages(conversationId: string, messages: NormalizedMessage[]): Promise<number> {
  if (messages.length === 0) return 0;
  const cards = await buildShopeeCards(messages);
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
  const from = p.sender === "SELLER" && p.kind === "TEXT" && isHoldingReply(p.text) ? "ROBOT" : p.sender;
  return { at: newest.sentAt, preview: previewFor(p.kind, p.text, from) };
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

type ShopeeShop = Pick<
  ShopConnection,
  | "id"
  | "platform"
  | "shopId"
  | "shopName"
  | "accessToken"
  | "refreshToken"
  | "tokenExpiresAt"
  | "tokenErrorAt"
  | "chatAccessAt"
  | "isDemo"
>;

async function callerFor(shop: ShopeeShop): Promise<SpCall> {
  const token = await ensureFreshToken(shop);
  return shopeeChatCaller({ shopId: shop.shopId, accessToken: token });
}

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
 * Brings changed Shopee Seller Chat conversations into Kyna Ops (read-only on Shopee).
 */
export async function syncShopeeChats(
  shop: ShopeeShop,
  opts: { deadline: number; minIntervalMs?: number; now?: Date }
): Promise<ChatSyncResult> {
  const result: ChatSyncResult = { ran: false, conversations: 0, newBuyerMessages: 0 };
  if (shop.isDemo || shop.platform !== Platform.SHOPEE || !shop.accessToken) return result;
  const now = opts.now ?? new Date();
  if (!(await claimShopCheck(shop.id, opts.minIntervalMs ?? 15_000, now))) return result;
  result.ran = true;

  const firstImport = !shop.chatAccessAt;
  try {
    const call = await callerFor(shop);
    let nextNano: string | null = null;
    const maxPages = firstImport ? SP_FIRST_IMPORT_CONVERSATION_PAGES : SP_UPDATE_CONVERSATION_PAGES;

    for (let page = 0; page < maxPages && Date.now() < opts.deadline; page++) {
      const list = await listShopeeConversations(call, nextNano);
      const convs = list.conversations.map((c) => ({ raw: c, n: normalizeShopeeConversation(c) }));
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
        const changed =
          !have || !have.remoteCheckedAt || n.lastMessageAt.getTime() > have.lastMessageAt.getTime() + 999;
        if (!changed) {
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
              platform: Platform.SHOPEE,
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

        const raw = await collectNewShopeeMessages(call, n.externalId, {
          knownIds: loadedBefore ? await recentExternalIds(conv.id) : new Set(),
          since: loadedBefore ? conv.lastMessageAt : null,
          maxPages: firstImport || !loadedBefore ? SP_FIRST_IMPORT_MESSAGE_PAGES : SP_UPDATE_MESSAGE_PAGES,
        });
        const normalized = raw
          .map((m) => normalizeShopeeMessage(m, shop.shopId))
          .filter((m): m is NormalizedMessage => m !== null);
        const newBuyer = await saveShopeeMessages(conv.id, normalized);
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

      nextNano = list.nextTimestampNano;
      if (!nextNano || (!firstImport && changedOnPage === 0)) break;
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
    console.error(`[chats] Shopee sync ${isTemporaryShopeeChatError(err) ? "(temporary)" : ""}`, result.error);
  }
  return result;
}

/** Fresh messages for one open Shopee chat (throttled per chat). */
export async function refreshShopeeConversation(
  conversationId: string,
  opts: { minIntervalMs?: number } = {}
): Promise<boolean> {
  const now = new Date();
  const claimed = await prisma.chatConversation.updateMany({
    where: {
      id: conversationId,
      platform: Platform.SHOPEE,
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
  if (!conv?.shopConnection.accessToken) return false;
  try {
    const call = await callerFor(conv.shopConnection);
    const raw = await collectNewShopeeMessages(call, conv.externalId, {
      knownIds: await recentExternalIds(conv.id),
      since: conv.lastMessageAt,
      maxPages: SP_UPDATE_MESSAGE_PAGES,
    });
    const normalized = raw
      .map((m) => normalizeShopeeMessage(m, conv.shopConnection.shopId))
      .filter((m): m is NormalizedMessage => m !== null);
    await saveShopeeMessages(conv.id, normalized);
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
    return true;
  } catch (err) {
    console.error("[chats] Shopee refresh", err instanceof Error ? err.message : err);
    return false;
  }
}

/** Chat sync for every connected Shopee shop (worker tick, Chats screen, webhooks). */
export async function syncAllShopeeChats(deadline: number, minIntervalMs = 60_000): Promise<ChatSyncResult[]> {
  const shops = await prisma.shopConnection.findMany({
    where: { platform: Platform.SHOPEE, isDemo: false, accessToken: { not: null } },
  });
  const out: ChatSyncResult[] = [];
  for (const shop of shops) out.push(await syncShopeeChats(shop, { deadline, minIntervalMs }));
  return out;
}
