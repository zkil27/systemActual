import crypto from "crypto";
import { ChatDraftStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildOrderPanel } from "@/lib/chats/order-panel";
import type { OrderPanel } from "@/lib/chats/types";
import { needsAnswer, type GateMessage, type GateResult } from "./gate";
import { classifyIntents } from "./intent";
import { topicMode, type AiTopic } from "./settings";
import { activeShopAnswers, getAiSettings } from "./settings-store";
import { answerTopicsFor, templateDraftFor } from "./templates";

/** Messages the gate looks at (newest). */
const GATE_WINDOW = 30;

export interface DraftView {
  id: string;
  text: string;
  source: "TEMPLATE" | "AI" | "SAVED";
  intent: string;
  /** Plain words for the owner: where the facts came from. */
  basis: string;
  rating: "good" | "bad" | null;
}

/** Same chat + same buyer message + same source → same id, so parallel polls can't double it. */
export function draftId(conversationId: string, buyerMessageId: string, source: string): string {
  return "d_" + crypto.createHash("sha1").update(`${conversationId}:${buyerMessageId}:${source}`).digest("hex").slice(0, 24);
}

const BASIS: Record<string, string> = {
  order: "From the order details",
  shop_answer: "From your shop answers",
  "order+shop_answer": "From the order and your shop answers",
};

const TOPIC_WORDS: Record<string, string> = {
  order: "the order",
  shipping: "shipping time",
  cod: "COD",
  size: "size",
  stock: "stock",
  product: "the product",
  other: "another question",
  returns: "a return or complaint",
};

/** "From your shop answers. Doesn't answer: stock" */
export function basisLabel(provider: string | null, model: string | null): string {
  const base = BASIS[provider ?? ""] ?? "Suggested reply";
  const missing = model?.startsWith("missing:") ? model.slice(8).split(",").filter(Boolean) : [];
  if (missing.length === 0) return base;
  return `${base}. Doesn't answer: ${missing.map((m) => TOPIC_WORDS[m] ?? m).join(", ")}`;
}

function toView(d: {
  id: string;
  text: string;
  source: string;
  intent: string;
  provider: string | null;
  model: string | null;
  rating: string | null;
}): DraftView {
  return {
    id: d.id,
    text: d.text,
    source: (d.source as DraftView["source"]) ?? "TEMPLATE",
    intent: d.intent,
    basis: basisLabel(d.provider, d.model),
    rating: d.rating === "good" || d.rating === "bad" ? d.rating : null,
  };
}

async function loadOrderPanel(conv: {
  platform: "SHOPEE" | "TIKTOK";
  orderSn: string | null;
  sampleOrder: Prisma.JsonValue;
  isDemo: boolean;
}): Promise<OrderPanel | null> {
  if (conv.isDemo) return buildOrderPanel({ sampleOrder: conv.sampleOrder });
  if (!conv.orderSn) return null;
  const order = await prisma.order.findUnique({
    where: { platform_orderSn: { platform: conv.platform, orderSn: conv.orderSn } },
    select: {
      orderSn: true,
      status: true,
      cancelRequested: true,
      lines: { select: { name: true, variationName: true, imageUrl: true, quantity: true } },
      packages: { select: { trackingNumber: true, carrier: true } },
    },
  });
  return buildOrderPanel({ order });
}

async function expirePending(conversationId: string, exceptId?: string) {
  await prisma.chatDraft.updateMany({
    where: { conversationId, status: ChatDraftStatus.PENDING, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { status: ChatDraftStatus.EXPIRED },
  });
}

export interface RefreshResult {
  draft: DraftView | null;
  gate: GateResult | { pending: false; reason: "off" };
  topic?: AiTopic;
}

/**
 * Makes sure the chat's draft matches its newest buyer question: creates a
 * free template draft when one fits, and retires drafts that are out of date.
 * Never sends anything.
 */
export async function refreshDraft(conversationId: string, now: Date = new Date()): Promise<RefreshResult> {
  const settings = await getAiSettings();
  if (!settings.enabled) {
    await expirePending(conversationId);
    return { draft: null, gate: { pending: false, reason: "off" } };
  }

  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      platform: true,
      orderSn: true,
      sampleOrder: true,
      canReply: true,
      aiPausedUntil: true,
      shopConnection: { select: { isDemo: true } },
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: GATE_WINDOW,
        select: { id: true, sender: true, kind: true, text: true, sentAt: true },
      },
    },
  });
  if (!conv) return { draft: null, gate: { pending: false, reason: "no_buyer" } };

  const messages: GateMessage[] = [...conv.messages].reverse();
  const gate = needsAnswer(messages, { pausedUntil: conv.aiPausedUntil, canReply: conv.canReply, now });
  if (!gate.pending) {
    await expirePending(conversationId);
    return { draft: null, gate };
  }

  // Already handled this buyer message (pending, used, dismissed or sent)?
  const existing = await prisma.chatDraft.findFirst({
    where: { conversationId, basedOnMessageId: gate.lastBuyerMessageId },
    orderBy: { createdAt: "desc" },
  });
  await expirePending(conversationId, existing?.status === ChatDraftStatus.PENDING ? existing.id : undefined);
  if (existing) {
    return {
      draft: existing.status === ChatDraftStatus.PENDING ? toView(existing) : null,
      gate,
      topic: existing.intent as AiTopic,
    };
  }

  // Photos and videos need a person to look; no draft.
  if (gate.hasMedia && !gate.buyerText) return { draft: null, gate };

  const order = await loadOrderPanel({
    platform: conv.platform,
    orderSn: conv.orderSn,
    sampleOrder: conv.sampleOrder,
    isDemo: conv.shopConnection.isDemo,
  });
  // Every question in the burst, minus topics the owner switched off.
  const topics = classifyIntents(gate.buyerTexts, { hasOrder: Boolean(order) }).filter(
    (t) => topicMode(settings.topicModes, t) !== "off"
  );
  if (topics.length === 0) return { draft: null, gate };
  // Money and complaints decide who answers, so they lead.
  const topic: AiTopic = topics.includes("returns") ? "returns" : topics[0];

  const answers = await activeShopAnswers([...new Set(topics.flatMap(answerTopicsFor))]);
  const t = templateDraftFor({ topics, order, answers });
  if (!t) return { draft: null, gate, topic };

  const id = draftId(conversationId, gate.lastBuyerMessageId, "TEMPLATE");
  try {
    const row = await prisma.chatDraft.create({
      data: {
        id,
        conversationId,
        text: t.text,
        source: "TEMPLATE",
        intent: topic,
        provider: t.basis,
        // Questions the draft doesn't answer, shown to the owner.
        model: t.missing.length ? `missing:${t.missing.join(",")}` : null,
        basedOnMessageId: gate.lastBuyerMessageId,
      },
    });
    await prisma.aiEvent
      .create({ data: { conversationId, decision: "template", intent: topic, provider: t.basis } })
      .catch(() => {});
    return { draft: toView(row), gate, topic };
  } catch (err) {
    // A parallel poll made the same draft first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const row = await prisma.chatDraft.findUnique({ where: { id } });
      return { draft: row && row.status === ChatDraftStatus.PENDING ? toView(row) : null, gate, topic };
    }
    throw err;
  }
}

/** The owner used, dismissed or rated a draft. */
export async function updateDraft(
  conversationId: string,
  id: string,
  action: "use" | "dismiss" | "rate",
  rating?: "good" | "bad"
): Promise<boolean> {
  const data =
    action === "use"
      ? { status: ChatDraftStatus.USED }
      : action === "dismiss"
        ? { status: ChatDraftStatus.DISMISSED }
        : { rating: rating ?? null };
  const res = await prisma.chatDraft.updateMany({ where: { id, conversationId }, data });
  if (res.count > 0 && action !== "rate") {
    await prisma.aiEvent
      .create({ data: { conversationId, decision: action === "use" ? "draft_used" : "draft_dismissed" } })
      .catch(() => {});
  }
  return res.count > 0;
}
