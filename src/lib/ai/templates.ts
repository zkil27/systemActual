import type { OrderPanel } from "@/lib/chats/types";
import type { AiTopic } from "./settings";

/**
 * Replies written from Kyna Ops data and the owner's shop answers. No AI,
 * no cost. Returns null when there's nothing reliable to say.
 */

export interface TemplateAnswer {
  topic: string;
  title: string;
  answer: string;
}

/** Shop-answer topics that can answer each question topic. */
const ANSWER_TOPICS: Record<AiTopic, string[]> = {
  order: [],
  shipping: ["shipping"],
  cod: ["cod"],
  size: ["size"],
  stock: [],
  product: ["product"],
  other: [],
  returns: ["returns"],
};

export function answerTopicsFor(topic: AiTopic): string[] {
  return ANSWER_TOPICS[topic];
}

const GREETS = /^(hi|hello|good|magandang|salamat|thank)/i;

function hi(text: string): string {
  const t = text.trim();
  return GREETS.test(t) ? t : `Hi po! ${t}`;
}

function itemPart(order: OrderPanel): string {
  const name = order.itemName && order.itemName !== "Order" ? order.itemName : null;
  return name ? `Your order (${name})` : `Your order ${order.orderSn}`;
}

/** Order status and tracking from the order linked to the chat. */
export function orderTemplate(order: OrderPanel | null): string {
  if (!order) {
    return "Hi po! Para ma-check namin, pakisend po ng order number. Makikita po ito sa TikTok app under My Orders.";
  }
  const status = order.statusLabel.toLowerCase();
  const what = itemPart(order);
  if (status.includes("cancel")) {
    return `Hi po! ${what} shows as cancelled po. If you didn't cancel it, our team will check and reply shortly.`;
  }
  if (status.includes("return")) {
    return `Hi po! ${what} has a return request po. Our team will check it and reply shortly.`;
  }
  if (status === "delivered" || status === "completed") {
    return `Hi po! ${what} shows as delivered po. If you haven't received it yet, please tell us and our team will check right away.`;
  }
  if (order.trackingNumber) {
    const courier = order.carrier ? `${order.carrier}, ` : "";
    return `Hi po! ${what} is ${status} po. Courier: ${courier}tracking no. ${order.trackingNumber}. You can follow it in the TikTok app under My Orders.`;
  }
  return `Hi po! ${what} is ${status} po. We'll share the tracking number once the courier picks it up.`;
}

/** The owner's own answer for the topic (at most two, joined). */
export function shopAnswerTemplate(topic: AiTopic, answers: TemplateAnswer[]): string | null {
  const wanted = answerTopicsFor(topic);
  const picked = answers.filter((a) => wanted.includes(a.topic)).slice(0, 2);
  if (picked.length === 0) return null;
  return hi(picked.map((a) => a.answer.trim()).join(" "));
}

export interface TemplateDraft {
  text: string;
  /** Where the facts came from, shown to the owner. */
  basis: "order" | "shop_answer" | "order+shop_answer";
  /** Topics the draft answers, and the ones it couldn't (need AI or a person). */
  covered: AiTopic[];
  missing: AiTopic[];
}

/**
 * One draft for several questions asked together ("COD po?" + "pa-check order ko").
 * Null when none of them can be answered from data or shop answers.
 */
export function templateDraftFor(opts: {
  topics: AiTopic[];
  order: OrderPanel | null;
  answers: TemplateAnswer[];
}): TemplateDraft | null {
  const parts: string[] = [];
  const covered: AiTopic[] = [];
  const missing: AiTopic[] = [];
  let usedOrder = false;
  let usedAnswers = false;
  for (const topic of opts.topics) {
    const t = templateDraft({ topic, order: opts.order, answers: opts.answers });
    if (!t) {
      missing.push(topic);
      continue;
    }
    covered.push(topic);
    if (t.basis === "order") usedOrder = true;
    else usedAnswers = true;
    // Only the first part keeps its "Hi po!".
    parts.push(parts.length ? t.text.replace(/^Hi po!\s*/, "") : t.text);
  }
  if (parts.length === 0) return null;
  return {
    text: parts.join(" "),
    basis: usedOrder && usedAnswers ? "order+shop_answer" : usedOrder ? "order" : "shop_answer",
    covered,
    missing,
  };
}

/** A free draft for this question, or null if the AI (or a person) is needed. */
export function templateDraft(opts: {
  topic: AiTopic;
  order: OrderPanel | null;
  answers: TemplateAnswer[];
}): { text: string; basis: "order" | "shop_answer" } | null {
  if (opts.topic === "order") return { text: orderTemplate(opts.order), basis: "order" };
  const text = shopAnswerTemplate(opts.topic, opts.answers);
  return text ? { text, basis: "shop_answer" } : null;
}
