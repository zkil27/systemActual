import { isAckOrGreeting, isHandoffNotice, isHoldingReply, normalizeText } from "./intent";

/** The few fields the gate needs, oldest first. */
export interface GateMessage {
  id: string;
  sender: "BUYER" | "SELLER" | "ROBOT" | "SYSTEM";
  kind: "TEXT" | "IMAGE" | "ORDER_CARD" | "PRODUCT_CARD" | "OTHER";
  text: string | null;
  sentAt: Date;
}

export type GateResult =
  | { pending: false; reason: "no_buyer" | "answered" | "ack" | "paused" | "cant_reply" }
  | {
      pending: true;
      /** Newest buyer message; a draft is "for" this message. */
      lastBuyerMessageId: string;
      lastBuyerAt: Date;
      /** The buyer's waiting messages, joined, oldest first (at most 6). */
      buyerText: string;
      /** The same messages one by one (greetings and "ok" left out). */
      buyerTexts: string[];
      /** Photo, video or sticker in the turn: a person should look. */
      hasMedia: boolean;
      /** TikTok said the buyer asked for a person. */
      handoff: boolean;
      /** A product card is part of the question. */
      hasProductCard: boolean;
    };

export const MAX_TURN_MESSAGES = 6;

/** A real reply from the shop side: not Duoke's "please wait" message. */
function isRealShopReply(m: GateMessage): boolean {
  return m.sender === "SELLER" && !(m.kind === "TEXT" && isHoldingReply(m.text));
}

/**
 * Does this chat have a buyer question waiting for an answer?
 * Pure: the caller loads the recent messages.
 */
export function needsAnswer(
  messages: GateMessage[],
  opts: { pausedUntil?: Date | null; canReply?: boolean; now?: Date } = {}
): GateResult {
  const now = opts.now ?? new Date();
  if (opts.canReply === false) return { pending: false, reason: "cant_reply" };
  if (opts.pausedUntil && opts.pausedUntil.getTime() > now.getTime()) return { pending: false, reason: "paused" };

  let lastBuyer = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].sender === "BUYER") {
      lastBuyer = i;
      break;
    }
  }
  if (lastBuyer < 0) return { pending: false, reason: "no_buyer" };
  if (messages.slice(lastBuyer + 1).some(isRealShopReply)) return { pending: false, reason: "answered" };

  // The buyer's turn: their messages since the last real shop reply.
  const turn: GateMessage[] = [];
  for (let i = lastBuyer; i >= 0; i--) {
    const m = messages[i];
    if (isRealShopReply(m)) break;
    if (m.sender === "BUYER") turn.unshift(m);
  }
  const recent = turn.slice(-MAX_TURN_MESSAGES);
  const texts = recent.filter((m) => m.kind === "TEXT").map((m) => normalizeText(m.text)).filter(Boolean);
  const hasMedia = recent.some((m) => m.kind === "IMAGE" || m.kind === "OTHER");
  const hasProductCard = recent.some((m) => m.kind === "PRODUCT_CARD");
  const handoff = messages.slice(lastBuyer + 1).some((m) => m.sender === "SYSTEM" && isHandoffNotice(m.text));

  if (!hasMedia && texts.every(isAckOrGreeting)) {
    // Only "ok po" / "hi" / a card on its own, and no request for a person.
    if (!handoff) return { pending: false, reason: "ack" };
  }

  const last = messages[lastBuyer];
  const questions = texts.filter((t) => !isAckOrGreeting(t));
  return {
    pending: true,
    lastBuyerMessageId: last.id,
    lastBuyerAt: last.sentAt,
    buyerText: questions.join("\n") || texts.join("\n"),
    buyerTexts: questions.length ? questions : texts,
    hasMedia,
    handoff,
    hasProductCard,
  };
}
