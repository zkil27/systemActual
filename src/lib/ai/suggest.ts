import { ChatDraftStatus, Platform } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tiktokRequest } from "@/lib/connectors/tiktok";
import { ensureFreshToken } from "@/lib/connectors/tokens";
import { getListingFacts, listingIdsForChat, type ListingFacts } from "./listing";
import { toCard } from "@/lib/chats/service";
import { buyerWritesEnglish, draftId, expirePending, fallbackDraft, loadOrderPanel, NEEDS_CHECK_SUFFIX, toView, type DraftView } from "./drafts";
import { needsAnswer, type GateMessage } from "./gate";
import { classifyIntents, isHoldingReply, needsOwner } from "./intent";
import { generateReply } from "./generate";
import type { PromptMessage } from "./prompt";
import type { CompletionDeps } from "./providers";
import { topicMode, type AiTopic } from "./settings";
import { activeShopAnswers, getAiSettings } from "./settings-store";

/**
 * The owner tapped "Suggest a reply": ask the free AI for a draft of the
 * shop's next message, check it, and save it as a draft. Never sends.
 */

const WINDOW = 30;

export type SuggestResult =
  | { ok: true; draft: DraftView }
  | {
      ok: false;
      reason: "off" | "not_found" | "not_pending" | "media" | "topics_off" | "no_keys" | "quota_out" | "failed" | "blocked";
      /** Plain words for the owner. */
      message: string;
    };

const MESSAGES: Record<Exclude<SuggestResult, { ok: true }>["reason"], string> = {
  off: "Turn on the Chats assistant in Settings first.",
  not_found: "This chat isn't here anymore.",
  not_pending: "There's no buyer question waiting in this chat.",
  media: "The buyer sent a photo or video. Please look at it and reply yourself.",
  topics_off: "You turned the assistant off for this kind of question.",
  no_keys: "The AI isn't set up yet.",
  quota_out: "The free AI replies are used up for now. Reply yourself, or try again later.",
  failed: "The AI didn't answer. Try again in a minute.",
  blocked: "The AI's reply broke a shop rule, so it wasn't shown. Try again or reply yourself.",
};

function fail(reason: Exclude<SuggestResult, { ok: true }>["reason"], message?: string): SuggestResult {
  return { ok: false, reason, message: message ?? MESSAGES[reason] };
}

function blockedMessage(label: string): string {
  return `The AI's reply wasn't shown because ${label}. Reply yourself, or try again.`;
}

async function logEvent(data: {
  conversationId: string;
  decision: string;
  intent?: string;
  provider?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  blockedReason?: string;
}) {
  await prisma.aiEvent.create({ data }).catch(() => {});
}

type ChatShop = Parameters<typeof ensureFreshToken>[0] & { isDemo: boolean; shopCipher: string | null };

/** The TikTok listings this chat is about, read live from the shop. Sample chats have none. */
export async function chatListings(
  shop: ChatShop,
  platform: string,
  orderSn: string | null,
  messages: PromptMessage[]
): Promise<ListingFacts[]> {
  if (shop.isDemo || platform !== Platform.TIKTOK) return [];
  try {
    const cards = messages
      .filter((m) => m.kind === "PRODUCT_CARD" && m.card)
      .map((m) => ({ productId: m.card!.productId ?? null, itemName: m.card!.itemName }));
    const ids = await listingIdsForChat({ shopConnectionId: shop.id, cards, orderSn });
    if (ids.length === 0) return [];
    let token: string | null = null;
    try {
      token = await ensureFreshToken(shop);
    } catch {
      // Reconnect needed: the stored copy still has sizes and the last stock.
    }
    const fetcher = token
      ? (productId: string) =>
          tiktokRequest({
            method: "GET",
            path: `/product/202309/products/${encodeURIComponent(productId)}`,
            accessToken: token!,
            shopCipher: shop.shopCipher,
          })
      : null;
    const facts = await Promise.all(ids.map((productId) => getListingFacts({ shopConnectionId: shop.id, productId, fetcher })));
    return facts.filter((f): f is ListingFacts => Boolean(f));
  } catch (err) {
    console.error("[assistant] listings", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function suggestReply(conversationId: string, deps: CompletionDeps = {}): Promise<SuggestResult> {
  const settings = await getAiSettings();
  if (!settings.enabled) return fail("off");

  const conv = await prisma.chatConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      platform: true,
      orderSn: true,
      sampleOrder: true,
      canReply: true,
      aiPausedUntil: true,
      shopConnection: {
        select: {
          id: true,
          isDemo: true,
          platform: true,
          shopId: true,
          shopName: true,
          shopCipher: true,
          accessToken: true,
          refreshToken: true,
          tokenExpiresAt: true,
          tokenErrorAt: true,
        },
      },
      messages: {
        orderBy: [{ sentAt: "desc" }, { id: "desc" }],
        take: WINDOW,
        select: { id: true, sender: true, kind: true, text: true, sentAt: true, cardData: true, clientKey: true },
      },
    },
  });
  if (!conv) return fail("not_found");

  const rows = [...conv.messages].reverse();
  const gate = needsAnswer(rows as GateMessage[], { pausedUntil: conv.aiPausedUntil, canReply: conv.canReply });
  if (!gate.pending) return fail("not_pending");
  if (gate.hasMedia && !gate.buyerText) return fail("media");

  // Already suggested for this buyer message and still waiting: show that one.
  const waiting = await prisma.chatDraft.findFirst({
    where: { conversationId, basedOnMessageId: gate.lastBuyerMessageId, source: "AI", status: ChatDraftStatus.PENDING },
  });
  if (waiting) return { ok: true, draft: toView(waiting) };

  const order = await loadOrderPanel({
    platform: conv.platform,
    orderSn: conv.orderSn,
    sampleOrder: conv.sampleOrder,
    isDemo: conv.shopConnection.isDemo,
  });
  const allTopics = classifyIntents(gate.buyerTexts, { hasOrder: Boolean(order) });
  const topics = allTopics.filter((t) => topicMode(settings.topicModes, t) !== "off");
  if (topics.length === 0) return fail("topics_off");
  const topic: AiTopic = topics.includes("returns") ? "returns" : topics[0];

  const answers = await activeShopAnswers();
  const messages: PromptMessage[] = rows.map((m) => ({
    sender: m.sender,
    kind: m.kind,
    text: m.text,
    card: toCard(m.cardData),
    holding: m.sender === "SELLER" && m.kind === "TEXT" && !m.clientKey && isHoldingReply(m.text),
  }));

  const listings = await chatListings(conv.shopConnection, conv.platform, conv.orderSn, messages);
  const result = await generateReply({ answers, order, messages, listings, reservePct: settings.eveningReservePct }, deps);
  for (const b of result.blocked) {
    await logEvent({ conversationId, decision: "blocked", intent: topic, blockedReason: b.reason, ...b.usage });
  }
  if (!result.ok) {
    if (result.reason === "blocked") return fail("blocked", blockedMessage(result.label ?? "it broke a shop rule"));
    await logEvent({ conversationId, decision: result.reason === "quota_out" ? "quota_out" : "ai_failed", intent: topic });
    // AI busy or down: offer the saved answer instead, labelled so the owner checks it fits.
    const saved = buyerWritesEnglish(gate.buyerTexts) ? null : await fallbackDraft(topics, order);
    if (saved) {
      const row = await prisma.chatDraft.create({
        data: {
          id: draftId(conversationId, gate.lastBuyerMessageId, "TEMPLATE"),
          conversationId,
          text: saved.text,
          source: "TEMPLATE",
          intent: topic,
          provider: saved.basis,
          model: saved.missing.length ? `missing:${saved.missing.join(",")}` : null,
          basedOnMessageId: gate.lastBuyerMessageId,
        },
      }).catch(() => null);
      if (row) {
        await expirePending(conversationId, row.id);
        return { ok: true, draft: toView(row) };
      }
    }
    return fail(result.reason);
  }

  const { text, usage } = result;
  // Returns, complaints, "I want a person" and requests only a person can grant always need the owner's eye.
  const check = result.needsCheck || topic === "returns" || gate.handoff || needsOwner(gate.buyerTexts);

  const row = await prisma.chatDraft.create({
    data: {
      conversationId,
      text,
      source: "AI",
      intent: topic,
      provider: usage.provider,
      model: check ? `${usage.model}${NEEDS_CHECK_SUFFIX}` : usage.model,
      basedOnMessageId: gate.lastBuyerMessageId,
    },
  });
  await expirePending(conversationId, row.id);
  await logEvent({ conversationId, decision: "ai_draft", intent: topic, ...usage });
  return { ok: true, draft: toView(row) };
}
