import { ChatMessageKind, ChatSender, Platform, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ensureDemoConnections } from "@/lib/demo-simulator";
import { KYNA_FASHION_ITEMS } from "@/lib/demo-catalog";
import { previewFor, type ChatPlatform } from "@/lib/chats/types";
import type { SampleOrder } from "@/lib/chats/order-panel";

/**
 * Sample buyer chats for the two demo shops, so Chats can be tried before
 * Shopee or TikTok approve chat access. Everything here lives only in our
 * database and is removed with "Clear sample data".
 */

export interface DemoMessageSeed {
  externalId: string;
  sender: "BUYER" | "SELLER";
  kind: "TEXT" | "IMAGE" | "ORDER_CARD" | "PRODUCT_CARD";
  text?: string;
  imageUrl?: string;
  cardData?: { itemName: string; imageUrl: string; variation: string; orderSn?: string; pricePhp?: number };
  sentAt: Date;
}

export interface DemoChatSeed {
  externalId: string;
  buyerName: string;
  sampleOrder: SampleOrder;
  unreadCount: number;
  messages: DemoMessageSeed[];
  lastMessageAt: Date;
  lastMessagePreview: string;
}

type Line = Omit<DemoMessageSeed, "externalId" | "sentAt"> & { minutesAgo: number };

interface Scenario {
  key: string;
  buyerName: string;
  item: number;
  orderSn: string;
  statusLabel: string;
  carrier: string;
  trackingNumber: string | null;
  unread: number;
  lines: Line[];
}

function item(i: number) {
  return KYNA_FASHION_ITEMS[i % KYNA_FASHION_ITEMS.length];
}

function card(i: number, orderSn?: string) {
  const it = item(i);
  return {
    itemName: it.itemSummary,
    imageUrl: it.imageUrl,
    variation: it.variationName,
    ...(orderSn ? { orderSn } : { pricePhp: it.pricePhp }),
  };
}

const buyer = (text: string, minutesAgo: number): Line => ({ sender: "BUYER", kind: "TEXT", text, minutesAgo });
const seller = (text: string, minutesAgo: number): Line => ({ sender: "SELLER", kind: "TEXT", text, minutesAgo });

const DAY = 24 * 60;

function shopeeScenarios(): Scenario[] {
  return [
    {
      key: "where-order",
      buyerName: "mariel.cruz",
      item: 0,
      orderSn: "2611205HQ8K2TR",
      statusLabel: "On the way",
      carrier: "SPX Express",
      trackingNumber: "SPXPH045812736901",
      unread: 2,
      lines: [
        { sender: "BUYER", kind: "ORDER_CARD", cardData: card(0, "2611205HQ8K2TR"), minutesAgo: 41 },
        buyer("Hi po! Asan na po order ko? 3 days na po kasi", 40),
        buyer("Kailangan ko na po sana sa Sabado", 6),
      ],
    },
    {
      key: "sizing",
      buyerName: "jhen_delarosa",
      item: 6,
      orderSn: "2611183MWX01PB",
      statusLabel: "Completed",
      carrier: "SPX Express",
      trackingNumber: "SPXPH045799120334",
      unread: 1,
      lines: [
        { sender: "BUYER", kind: "PRODUCT_CARD", cardData: card(6), minutesAgo: 75 },
        { sender: "BUYER", kind: "IMAGE", imageUrl: item(6).imageUrl, minutesAgo: 74 },
        buyer("Kasya kaya sakin to? 5'2 po ako, 55kg. Medium po ba or Large?", 73),
      ],
    },
    {
      key: "cod",
      buyerName: "ann.santos",
      item: 4,
      orderSn: "2611220QZB7MNA",
      statusLabel: "Getting ready to ship",
      carrier: "J&T Express",
      trackingNumber: null,
      unread: 1,
      lines: [buyer("Pwede po COD? Wala po kasi akong card", 18)],
    },
    {
      key: "color-change",
      buyerName: "kimberly_r",
      item: 1,
      orderSn: "2611221T4CEXYV",
      statusLabel: "Getting ready to ship",
      carrier: "SPX Express",
      trackingNumber: null,
      unread: 0,
      lines: [
        { sender: "BUYER", kind: "ORDER_CARD", cardData: card(1, "2611221T4CEXYV"), minutesAgo: 190 },
        buyer("Pwede pa po ba palitan ng Black yung color? Kaka-order ko lang po", 189),
        seller("Hi po! Check lang po namin kung pwede pa, wait lang po", 170),
      ],
    },
    {
      key: "thanks",
      buyerName: "rose_ann.v",
      item: 2,
      orderSn: "2611167DKP0WQS",
      statusLabel: "Delivered",
      carrier: "SPX Express",
      trackingNumber: "SPXPH045730021987",
      unread: 0,
      lines: [
        buyer("Dumating na po! Ang ganda, sakto sa size. Salamat po", DAY + 300),
        seller("Salamat din po! Enjoy po sa short", DAY + 280),
      ],
    },
    {
      key: "return-question",
      buyerName: "loida.m",
      item: 3,
      orderSn: "2611104YHR3CJD",
      statusLabel: "Completed",
      carrier: "J&T Express",
      trackingNumber: "JT0123456789",
      unread: 0,
      lines: [
        buyer("Pano po mag return? Medyo maluwag po sakin", 9 * DAY + 120),
        seller("Hi po! Tap Return/Refund po sa order page within 7 days ng delivery", 9 * DAY + 100),
        buyer("Okay po, salamat", 9 * DAY + 90),
      ],
    },
  ];
}

function tiktokScenarios(): Scenario[] {
  return [
    {
      key: "where-order",
      buyerName: "Trisha Mae",
      item: 5,
      orderSn: "577104219834661021",
      statusLabel: "On the way",
      carrier: "J&T Express",
      trackingNumber: "JT0987112354",
      unread: 3,
      lines: [
        { sender: "BUYER", kind: "ORDER_CARD", cardData: card(5, "577104219834661021"), minutesAgo: 12 },
        buyer("Hello po, kelan po darating?", 11),
        buyer("Nag order po ako nung live kahapon", 10),
      ],
    },
    {
      key: "live-stock",
      buyerName: "Bea Lim",
      item: 7,
      orderSn: "577103887120456339",
      statusLabel: "Delivered",
      carrier: "Flash Express",
      trackingNumber: "PH2414890077A",
      unread: 1,
      lines: [
        { sender: "BUYER", kind: "PRODUCT_CARD", cardData: card(7), minutesAgo: 34 },
        buyer("May Navy Blue Small pa po? Hindi ko na-checkout sa live", 33),
      ],
    },
    {
      key: "sizing",
      buyerName: "Camille Reyes",
      item: 0,
      orderSn: "577102993005117824",
      statusLabel: "Completed",
      carrier: "J&T Express",
      trackingNumber: "JT0987009871",
      unread: 1,
      lines: [
        { sender: "BUYER", kind: "IMAGE", imageUrl: item(0).imageUrl, minutesAgo: 58 },
        buyer("Ganito po ba talaga kahaba? Mukhang mas maikli sa video", 57),
      ],
    },
    {
      key: "cancel",
      buyerName: "Joyce A.",
      item: 4,
      orderSn: "577104655231009876",
      statusLabel: "Getting ready to ship",
      carrier: "J&T Express",
      trackingNumber: null,
      unread: 0,
      lines: [
        buyer("Pwede ko pa po ba i-cancel? Nadoble po order ko", 150),
        seller("Hi po! Pwede po, tap Cancel lang po sa isa", 140),
        buyer("Done na po, thank you!", 135),
      ],
    },
    {
      key: "thanks",
      buyerName: "Nica Tan",
      item: 2,
      orderSn: "577100342178820013",
      statusLabel: "Delivered",
      carrier: "Flash Express",
      trackingNumber: "PH2414770312A",
      unread: 0,
      lines: [
        buyer("Ang bilis ng delivery! Order ulit ako next live", 2 * DAY + 200),
        seller("Thank you po! See you sa live", 2 * DAY + 190),
      ],
    },
    {
      key: "fabric",
      buyerName: "Marjorie D.",
      item: 3,
      orderSn: "577096101934002210",
      statusLabel: "Completed",
      carrier: "J&T Express",
      trackingNumber: "JT0986551022",
      unread: 0,
      lines: [
        buyer("Manipis po ba yung tela? Pang-office po sana", 12 * DAY + 60),
        seller("Hi po! Medyo makapal po sya, hindi see-through", 12 * DAY + 40),
      ],
    },
  ];
}

/** Pure: the sample chats for one shop, timed relative to `now`. Same ids every time. */
export function buildDemoChats(platform: ChatPlatform, now: Date = new Date()): DemoChatSeed[] {
  const scenarios = platform === "SHOPEE" ? shopeeScenarios() : tiktokScenarios();
  const prefix = `demo-${platform.toLowerCase()}`;
  return scenarios.map((s) => {
    const messages: DemoMessageSeed[] = s.lines.map((l, i) => {
      const { minutesAgo, ...rest } = l;
      return { ...rest, externalId: `${prefix}-${s.key}-m${i + 1}`, sentAt: new Date(now.getTime() - minutesAgo * 60_000) };
    });
    const last = messages[messages.length - 1];
    const it = item(s.item);
    return {
      externalId: `${prefix}-${s.key}`,
      buyerName: s.buyerName,
      unreadCount: s.unread,
      sampleOrder: {
        orderSn: s.orderSn,
        photoUrl: it.imageUrl,
        itemName: it.itemSummary,
        variation: it.variationName,
        moreItems: 0,
        statusLabel: s.statusLabel,
        carrier: s.carrier,
        trackingNumber: s.trackingNumber,
      },
      messages,
      lastMessageAt: last.sentAt,
      lastMessagePreview: previewFor(last.kind, last.text ?? null, last.sender === "SELLER"),
    };
  });
}

/**
 * Writes the sample chats for both demo shops. Running it again replaces them
 * (same ids), so nothing is duplicated.
 */
export async function generateDemoChats(now: Date = new Date()): Promise<number> {
  const { shopee, tiktok } = await ensureDemoConnections();
  let created = 0;
  for (const [shop, platform] of [
    [shopee, "SHOPEE"],
    [tiktok, "TIKTOK"],
  ] as const) {
    const seeds = buildDemoChats(platform, now);
    await prisma.$transaction(async (tx) => {
      await tx.chatConversation.deleteMany({
        where: { shopConnectionId: shop.id, externalId: { in: seeds.map((s) => s.externalId) } },
      });
      for (const seed of seeds) {
        await tx.chatConversation.create({
          data: {
            shopConnectionId: shop.id,
            platform: platform as Platform,
            externalId: seed.externalId,
            buyerName: seed.buyerName,
            sampleOrder: seed.sampleOrder as Prisma.InputJsonValue,
            orderSn: seed.sampleOrder.orderSn,
            unreadCount: seed.unreadCount,
            lastMessageAt: seed.lastMessageAt,
            lastMessagePreview: seed.lastMessagePreview,
            messages: {
              create: seed.messages.map((m) => ({
                externalId: m.externalId,
                sender: m.sender as ChatSender,
                kind: m.kind as ChatMessageKind,
                text: m.text ?? null,
                imageUrl: m.imageUrl ?? null,
                cardData: m.cardData ? (m.cardData as Prisma.InputJsonValue) : Prisma.JsonNull,
                sentAt: m.sentAt,
                status: "SENT",
              })),
            },
          },
        });
        created++;
      }
    });
  }
  return created;
}

const INCOMING_LINES = [
  "Hello po, available pa po ba ito?",
  "Pwede po ba mag-order ng 2 tapos iba ibang kulay?",
  "Kelan po next live nyo?",
  "Ilang araw po bago dumating sa Cebu?",
  "Salamat po sa mabilis na reply!",
  "Pa-check naman po ng order ko please",
  "May size chart po ba kayo?",
  "Okay na po, nareceive ko na",
];

/** Adds one buyer message to a sample chat, as if the buyer just wrote. Returns the chat id. */
export async function addDemoBuyerMessage(
  platform: ChatPlatform,
  conversationId?: string | null,
  random: () => number = Math.random
): Promise<string | null> {
  const where: Prisma.ChatConversationWhereInput = {
    platform: platform as Platform,
    shopConnection: { isDemo: true },
    ...(conversationId ? { id: conversationId } : {}),
  };
  const convs = await prisma.chatConversation.findMany({ where, select: { id: true }, take: 50 });
  if (convs.length === 0) return null;
  const conv = convs[Math.floor(random() * convs.length)];
  const now = new Date();
  const asPhoto = random() < 0.2;
  const text = INCOMING_LINES[Math.floor(random() * INCOMING_LINES.length)];
  const photo = KYNA_FASHION_ITEMS[Math.floor(random() * KYNA_FASHION_ITEMS.length)].imageUrl;

  await prisma.$transaction([
    prisma.chatMessage.create({
      data: {
        conversationId: conv.id,
        externalId: `demo-in-${now.getTime()}-${Math.floor(random() * 1e6)}`,
        sender: "BUYER",
        kind: asPhoto ? "IMAGE" : "TEXT",
        text: asPhoto ? null : text,
        imageUrl: asPhoto ? photo : null,
        sentAt: now,
        status: "SENT",
      },
    }),
    prisma.chatConversation.update({
      where: { id: conv.id },
      data: {
        unreadCount: { increment: 1 },
        lastMessageAt: now,
        lastMessagePreview: previewFor(asPhoto ? "IMAGE" : "TEXT", asPhoto ? null : text, false),
      },
    }),
  ]);
  return conv.id;
}
