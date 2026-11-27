import crypto from "crypto";
import { ChatDraftStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildOrderPanel } from "@/lib/chats/order-panel";
import type { OrderPanel } from "@/lib/chats/types";
import { needsAnswer, type GateMessage, type GateResult } from "./gate";
import { classifyIntents } from "./intent";
import { replyLanguage } from "./prompt";
import { configuredProviders } from "./providers/catalog";
import { topicMode, type AiTopic } from "./settings";
import { activeShopAnswers, getAiSettings } from "./settings-store";
import { answerTopicsFor, templateDraftFor } from "./templates";

/** The buyer's newest question is in English. */
export function buyerWritesEnglish(buyerTexts: string[]): boolean {
  const last = buyerTexts[buyerTexts.length - 1];
  return Boolean(last) && replyLanguage([{ sender: "BUYER", kind: "TEXT", text: last, card: null }]) === "English";
}

/** Chats with a buyer question newer than this get an AI suggestion as soon as they're opened. */
const AUTO_SUGGEST_MAX_AGE_MS = 3 * 24 * 3600_000;

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

/** AI drafts that couldn't answer everything keep this on their model name. */
export const NEEDS_CHECK_SUFFIX = "#check";

/** "From your shop answers. Doesn't answer: stock" */
export function basisLabel(_provider: string | null, model: string | null, source: string = "TEMPLATE"): string {
  if (source === "AI") {
    return model?.endsWith(NEEDS_CHECK_SUFFIX) ? "AI reply. Needs your check" : "AI reply from your shop answers";
  }
  // Saved answers are picked by keywords, so they may not fit the question.
  const base = "Saved answer (AI was busy). Check it fits";
  const missing = model?.startsWith("missing:") ? model.slice(8).split(",").filter(Boolean) : [];
  if (missing.length === 0) return base;
  return `${base}. Doesn't answer: ${missing.map((m) => TOPIC_WORDS[m] ?? m).join(", ")}`;
}

export function toView(d: {
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
    basis: basisLabel(d.provider, d.model, d.source),
    rating: d.rating === "good" || d.rating === "bad" ? d.rating : null,
  };
}

export async function loadOrderPanel(conv: {
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

export async function expirePending(conversationId: string, exceptId?: string) {
  await prisma.chatDraft.updateMany({
    where: { conversationId, status: ChatDraftStatus.PENDING, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { status: ChatDraftStatus.EXPIRED },
  });
}

export interface RefreshResult {
  draft: DraftView | null;
  gate: GateResult | { pending: false; reason: "off" };
  topic?: AiTopic;
  /** The owner may ask the AI for a reply (no draft yet, or only a saved-answer fallback). */
  canSuggest: boolean;
  /** Nothing was suggested for this buyer message yet: the screen asks the AI right away. */
  autoSuggest?: boolean;
}

/** No draft, or only a saved-answer fallback: the AI may (re)try. */
function suggestable(draft: { source: string } | null): boolean {
  return !draft || draft.source === "TEMPLATE";
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
    return { draft: null, gate: { pending: false, reason: "off" }, canSuggest: false };
  }
  const aiReady = configuredProviders().some((p) => p.spec.privateOk);

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
  if (!conv) return { draft: null, gate: { pending: false, reason: "no_buyer" }, canSuggest: false };

  const messages: GateMessage[] = [...conv.messages].reverse();
  const gate = needsAnswer(messages, { pausedUntil: conv.aiPausedUntil, canReply: conv.canReply, now });
  if (!gate.pending) {
    await expirePending(conversationId);
    return { draft: null, gate, canSuggest: false };
  }

  // Already handled this buyer message (pending, used, dismissed or sent)?
  const existing = await prisma.chatDraft.findFirst({
    where: { conversationId, basedOnMessageId: gate.lastBuyerMessageId },
    orderBy: { createdAt: "desc" },
  });
  await expirePending(conversationId, existing?.status === ChatDraftStatus.PENDING ? existing.id : undefined);
  if (existing) {
    const pending = existing.status === ChatDraftStatus.PENDING;
    return {
      draft: pending ? toView(existing) : null,
      gate,
      topic: existing.intent as AiTopic,
      canSuggest: aiReady && suggestable(pending ? existing : null),
    };
  }

  // Photos and videos need a person to look; no draft.
  if (gate.hasMedia && !gate.buyerText) return { draft: null, gate, canSuggest: false };

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
  if (topics.length === 0) return { draft: null, gate, canSuggest: false };
  // Money and complaints decide who answers, so they lead.
  const topic: AiTopic = topics.includes("returns") ? "returns" : topics[0];

  // The AI writes every suggestion: it reads the whole message, while saved answers
  // are picked by keywords and answered "you sent the wrong size" with the size guide.
  // Saved answers are only a fallback, used when the AI can't answer (no keys here,
  // or quota/errors in suggest.ts). Older chats wait for a tap, to save free AI use.
  if (aiReady) {
    const fresh = now.getTime() - gate.lastBuyerAt.getTime() < AUTO_SUGGEST_MAX_AGE_MS;
    return { draft: null, gate, topic, canSuggest: true, autoSuggest: fresh };
  }
  if (buyerWritesEnglish(gate.buyerTexts)) return { draft: null, gate, topic, canSuggest: false };

  const t = await fallbackDraft(topics, order, conv.platform);
  if (!t) return { draft: null, gate, topic, canSuggest: false };

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
    return { draft: toView(row), gate, topic, canSuggest: aiReady && suggestable(row) };
  } catch (err) {
    // A parallel poll made the same draft first.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const row = await prisma.chatDraft.findUnique({ where: { id } });
      const pending = row && row.status === ChatDraftStatus.PENDING ? row : null;
      return { draft: pending ? toView(pending) : null, gate, topic, canSuggest: aiReady && suggestable(pending) };
    }
    throw err;
  }
}

/** The saved-answer reply for these topics, or null. Only used when the AI can't answer. */
export async function fallbackDraft(
  topics: AiTopic[],
  order: OrderPanel | null,
  platform: "SHOPEE" | "TIKTOK" = "TIKTOK"
) {
  const answers = await activeShopAnswers([...new Set(topics.flatMap(answerTopicsFor))]);
  return templateDraftFor({ topics, order, answers, platform });
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
