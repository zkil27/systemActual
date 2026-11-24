import { z } from "zod";

/**
 * Chats assistant: topics, modes and the switches that decide what it may do.
 * Pure helpers here; database access is in settings-store.ts.
 */

export const AI_TOPICS = [
  { id: "order", label: "Order status & tracking", canAuto: true },
  { id: "shipping", label: "Shipping time", canAuto: true },
  { id: "cod", label: "COD & payment", canAuto: true },
  { id: "size", label: "Sizes & fit", canAuto: true },
  { id: "stock", label: "Stock & colors", canAuto: true },
  { id: "product", label: "Fabric & product details", canAuto: true },
  { id: "other", label: "Other questions", canAuto: true },
  // Money and complaints always go to a person; the assistant may only draft.
  { id: "returns", label: "Returns, refunds & complaints", canAuto: false },
] as const;

export type AiTopic = (typeof AI_TOPICS)[number]["id"];
export type AiMode = "off" | "draft" | "auto";
export const AI_TOPIC_IDS = AI_TOPICS.map((t) => t.id) as AiTopic[];

export function isAiTopic(v: unknown): v is AiTopic {
  return typeof v === "string" && (AI_TOPIC_IDS as string[]).includes(v);
}

/** Topics without a saved mode start as drafts. Topics that can't auto-send are capped at draft. */
export function topicMode(modes: unknown, topic: AiTopic): AiMode {
  const raw = modes && typeof modes === "object" ? (modes as Record<string, unknown>)[topic] : undefined;
  const mode: AiMode = raw === "off" || raw === "draft" || raw === "auto" ? raw : "draft";
  const def = AI_TOPICS.find((t) => t.id === topic);
  return mode === "auto" && !def?.canAuto ? "draft" : mode;
}

export const SHOP_ANSWER_TOPICS = [
  { id: "cod", label: "COD & payment" },
  { id: "shipping", label: "Shipping times" },
  { id: "returns", label: "Returns & refunds" },
  { id: "size", label: "Sizes & fit" },
  { id: "product", label: "Fabric & care" },
  { id: "live", label: "Live sales" },
  { id: "never", label: "Never say or promise" },
  { id: "other", label: "Other" },
] as const;
export type ShopAnswerTopic = (typeof SHOP_ANSWER_TOPICS)[number]["id"];

export const MAX_LABEL = 40;
export const MAX_HANDOVER = 300;
export const MAX_ANSWER = 1500;

export const aiSettingsInput = z.object({
  enabled: z.boolean().optional(),
  topicModes: z.record(z.string(), z.enum(["off", "draft", "auto"])).optional(),
  autoLabel: z.string().trim().min(1).max(MAX_LABEL).optional(),
  handoverText: z.string().trim().min(1).max(MAX_HANDOVER).optional(),
  eveningReservePct: z.number().int().min(0).max(60).optional(),
});
export type AiSettingsInput = z.infer<typeof aiSettingsInput>;

/** Keeps only known topics, and caps "auto" where it isn't allowed. */
export function cleanTopicModes(input: Record<string, string> | undefined, current: unknown): Record<AiTopic, AiMode> {
  const out = {} as Record<AiTopic, AiMode>;
  for (const t of AI_TOPIC_IDS) {
    const next = input?.[t];
    out[t] = topicMode({ [t]: next ?? topicMode(current, t) }, t);
  }
  return out;
}

export const shopAnswerInput = z.object({
  id: z.string().min(1).max(64).optional(),
  topic: z.enum(SHOP_ANSWER_TOPICS.map((t) => t.id) as [ShopAnswerTopic, ...ShopAnswerTopic[]]),
  title: z.string().trim().min(1).max(80),
  answer: z.string().trim().min(1).max(MAX_ANSWER),
  active: z.boolean().optional(),
});
export type ShopAnswerInput = z.infer<typeof shopAnswerInput>;

/**
 * AI_AUTOSEND_TIKTOK: unset or "off" = drafts only everywhere; "all" = may
 * auto-send in every TikTok chat; otherwise a comma list of TikTok
 * conversation ids (test buyers). Drafts never depend on this.
 */
export function aiAutosendSetting(raw: string | undefined = process.env.AI_AUTOSEND_TIKTOK): "off" | "all" | Set<string> {
  const v = raw?.trim();
  if (!v || v.toLowerCase() === "off") return "off";
  if (v.toLowerCase() === "all") return "all";
  return new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
}

export function mayAutoSendTo(
  conversationExternalId: string | null | undefined,
  setting: ReturnType<typeof aiAutosendSetting> = aiAutosendSetting()
): boolean {
  if (setting === "off" || !conversationExternalId) return false;
  return setting === "all" || setting.has(conversationExternalId);
}

/** Final yes/no for one automatic send. Every condition must hold. */
export function canAutoSend(opts: {
  enabled: boolean;
  mode: AiMode;
  topic: AiTopic;
  conversationExternalId: string | null | undefined;
  autosend?: ReturnType<typeof aiAutosendSetting>;
}): boolean {
  if (!opts.enabled) return false;
  if (topicMode({ [opts.topic]: opts.mode }, opts.topic) !== "auto") return false;
  return mayAutoSendTo(opts.conversationExternalId, opts.autosend ?? aiAutosendSetting());
}

/** "(Auto-reply) Salamat po…" — the label always goes first so it can't be cut off. */
export function withAutoLabel(text: string, label: string): string {
  const l = label.trim() || "(Auto-reply)";
  const t = text.trim();
  return t.startsWith(l) ? t : `${l} ${t}`;
}
