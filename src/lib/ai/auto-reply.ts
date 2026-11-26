import crypto from "crypto";
import { ChatDraftStatus, Platform } from "@prisma/client";
import { systemActor } from "@/lib/audit";
import { createChatReplyApproval } from "@/lib/approvals/service";
import { toCard } from "@/lib/chats/service";
import { sendChatMessage } from "@/lib/chats/service";
import { canSendFrom, resolveChatSendSetting } from "@/lib/chats/source";
import { prisma } from "@/lib/prisma";
import { expirePending, loadOrderPanel, NEEDS_CHECK_SUFFIX } from "./drafts";
import { needsAnswer, type GateMessage } from "./gate";
import { generateReply } from "./generate";
import { classifyIntents, isHoldingReply, needsOwner } from "./intent";
import type { PromptMessage } from "./prompt";
import type { CompletionDeps } from "./providers";
import {
  canAutoSend,
  resolveAutoSendSetting,
  topicMode,
  withAutoLabel,
  type AiMode,
  type AiTopic,
} from "./settings";
import { activeShopAnswers, getAiSettings } from "./settings-store";
import { chatListings } from "./suggest";

const ACTOR = systemActor("chat-assistant");
const WINDOW = 30;
const RECENT_BUYER_HOURS = 24;

export type ChatAutomationAction = "skip" | "auto_send" | "approval_queue" | "draft_only";

export interface DecideChatAutomationInput {
  settings: {
    enabled: boolean;
    chatSendEnabled: boolean;
    autoSendEnabled: boolean;
    approvalQueueEnabled: boolean;
    topicModes: Record<AiTopic, AiMode>;
  };
  platform: "SHOPEE" | "TIKTOK";
  isDemo: boolean;
  conversationExternalId: string | null | undefined;
  gate: {
    pending: boolean;
    hasMedia?: boolean;
    buyerText?: string;
    handoff?: boolean;
  };
  topics: AiTopic[];
  needsOwnerFlag: boolean;
  generatedNeedsCheck: boolean;
  chatSendOverride?: ReturnType<typeof resolveChatSendSetting>;
  autoSendOverride?: ReturnType<typeof resolveAutoSendSetting>;
}

/**
 * Pure policy router deciding whether an AI reply is skipped, auto-sent,
 * queued for owner approval (with Telegram 1-tap), or left as a chat draft.
 */
export function decideChatAutomation(
  input: DecideChatAutomationInput
): ChatAutomationAction {
  const { settings, platform, isDemo, gate, topics } = input;
  if (!settings.enabled || platform === "SHOPEE" || isDemo) return "skip";
  if (!gate.pending) return "skip";
  if (gate.hasMedia && !gate.buyerText) return "skip";
  if (topics.length === 0) return "skip";

  const sendSetting =
    input.chatSendOverride ?? resolveChatSendSetting(settings.chatSendEnabled);
  const autoSetting =
    input.autoSendOverride ?? resolveAutoSendSetting(settings.autoSendEnabled);

  const canSend = canSendFrom(
    { isDemo, platform },
    input.conversationExternalId ?? undefined,
    sendSetting
  );
  if (!canSend) return "draft_only";

  const primaryTopic: AiTopic = topics.includes("returns") ? "returns" : topics[0];
  const allTopicsAuto = topics.every(
    (t) => topicMode(settings.topicModes, t) === "auto"
  );

  const safeToAutoSend =
    allTopicsAuto &&
    !gate.hasMedia &&
    !gate.handoff &&
    !input.needsOwnerFlag &&
    !input.generatedNeedsCheck &&
    canAutoSend({
      enabled: settings.enabled,
      mode: topicMode(settings.topicModes, primaryTopic),
      topic: primaryTopic,
      conversationExternalId: input.conversationExternalId,
      autosend: autoSetting,
    });

  if (safeToAutoSend) return "auto_send";
  if (settings.approvalQueueEnabled) return "approval_queue";
  return "draft_only";
}

function autoClientKey(conversationId: string, buyerMessageId: string): string {
  return (
    "auto_" +
    crypto
      .createHash("sha1")
      .update(`${conversationId}:${buyerMessageId}`)
      .digest("hex")
      .slice(0, 24)
  );
}

export interface AutoReplyRunResult {
  checked: number;
  autoSent: number;
  queued: number;
  drafted: number;
}

/**
 * Processes recent unread real TikTok buyer conversations in the background:
 * auto-sends only safe "Auto" topics, and routes uncertain or Draft topics
 * to the owner Approval Queue (with Telegram 1-tap buttons).
 */
export async function processPendingChatReplies(
  deadline: number,
  opts: { maxConversations?: number; now?: Date; deps?: CompletionDeps } = {}
): Promise<AutoReplyRunResult> {
  const out: AutoReplyRunResult = { checked: 0, autoSent: 0, queued: 0, drafted: 0 };
  const now = opts.now ?? new Date();
  const settings = await getAiSettings();
  const autoSetting = resolveAutoSendSetting(settings.autoSendEnabled);
  if (!settings.enabled || (autoSetting === "off" && !settings.approvalQueueEnabled)) {
    return out;
  }

  const maxConversations = opts.maxConversations ?? 5;
  const recentCutoff = new Date(now.getTime() - RECENT_BUYER_HOURS * 3600_000);

  const conversations = await prisma.chatConversation.findMany({
    where: {
      platform: Platform.TIKTOK,
      shopConnection: { isDemo: false },
      unreadCount: { gt: 0 },
      canReply: true,
      lastMessageAt: { gte: recentCutoff },
      OR: [{ aiPausedUntil: null }, { aiPausedUntil: { lte: now } }],
    },
    orderBy: { lastMessageAt: "desc" },
    take: maxConversations,
    select: {
      id: true,
      externalId: true,
      platform: true,
      buyerName: true,
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
        select: {
          id: true,
          sender: true,
          kind: true,
          text: true,
          sentAt: true,
          cardData: true,
          clientKey: true,
        },
      },
    },
  });

  if (!conversations.length) return out;
  const answers = await activeShopAnswers();

  for (const conv of conversations) {
    if (Date.now() >= deadline - 4_000) break;

    const rows = [...conv.messages].reverse();
    const gate = needsAnswer(rows as GateMessage[], {
      pausedUntil: conv.aiPausedUntil,
      canReply: conv.canReply,
      now,
    });
    if (!gate.pending || (gate.hasMedia && !gate.buyerText)) continue;

    // Skip if this buyer message already produced a draft or an approval request.
    const [existingDraft, existingApproval] = await Promise.all([
      prisma.chatDraft.findFirst({
        where: { conversationId: conv.id, basedOnMessageId: gate.lastBuyerMessageId },
        select: { id: true },
      }),
      prisma.actionRequest.findUnique({
        where: { dedupeKey: `chat.reply:${conv.id}:${gate.lastBuyerMessageId}` },
        select: { id: true },
      }),
    ]);
    if (existingDraft || existingApproval) continue;

    const order = await loadOrderPanel({
      platform: conv.platform,
      orderSn: conv.orderSn,
      sampleOrder: conv.sampleOrder,
      isDemo: conv.shopConnection.isDemo,
    });
    const topics = classifyIntents(gate.buyerTexts, { hasOrder: Boolean(order) }).filter(
      (t) => topicMode(settings.topicModes, t) !== "off"
    );
    if (topics.length === 0) continue;
    const topic: AiTopic = topics.includes("returns") ? "returns" : topics[0];

    out.checked++;

    const promptMessages: PromptMessage[] = rows.map((m) => ({
      sender: m.sender,
      kind: m.kind,
      text: m.text,
      card: toCard(m.cardData),
      holding:
        m.sender === "SELLER" &&
        m.kind === "TEXT" &&
        !m.clientKey &&
        isHoldingReply(m.text),
    }));

    const listings = await chatListings(
      conv.shopConnection,
      conv.platform,
      conv.orderSn,
      promptMessages
    );

    const generated = await generateReply(
      {
        answers,
        order,
        messages: promptMessages,
        listings,
        reservePct: settings.eveningReservePct,
      },
      opts.deps
    );

    for (const b of generated.blocked) {
      await prisma.aiEvent
        .create({
          data: {
            conversationId: conv.id,
            decision: "blocked",
            intent: topic,
            blockedReason: b.reason,
            ...b.usage,
          },
        })
        .catch(() => {});
    }

    if (!generated.ok) {
      if (generated.reason !== "blocked") {
        await prisma.aiEvent
          .create({
            data: {
              conversationId: conv.id,
              decision: generated.reason === "quota_out" ? "quota_out" : "ai_failed",
              intent: topic,
            },
          })
          .catch(() => {});
      }
      continue;
    }

    const needsOwnerFlag = needsOwner(gate.buyerTexts);
    const check =
      generated.needsCheck ||
      topic === "returns" ||
      gate.handoff ||
      needsOwnerFlag;

    const action = decideChatAutomation({
      settings,
      platform: conv.platform === Platform.SHOPEE ? "SHOPEE" : "TIKTOK",
      isDemo: conv.shopConnection.isDemo,
      conversationExternalId: conv.externalId,
      gate,
      topics,
      needsOwnerFlag,
      generatedNeedsCheck: generated.needsCheck,
    });

    if (action === "skip") continue;

    if (action === "auto_send") {
      const labeledText = withAutoLabel(generated.text, settings.autoLabel);
      try {
        const sent = await sendChatMessage(
          conv.id,
          autoClientKey(conv.id, gate.lastBuyerMessageId),
          { text: labeledText },
          { isAutoReply: true }
        );
        if (sent.status !== "SENT") {
          throw new Error("Reply send returned FAILED.");
        }
        await prisma.chatDraft.create({
          data: {
            conversationId: conv.id,
            text: labeledText,
            source: "AI",
            intent: topic,
            provider: generated.usage.provider,
            model: generated.usage.model,
            basedOnMessageId: gate.lastBuyerMessageId,
            status: ChatDraftStatus.SENT,
          },
        });
        await expirePending(conv.id);
        await prisma.aiEvent
          .create({
            data: {
              conversationId: conv.id,
              decision: "auto_sent",
              intent: topic,
              ...generated.usage,
            },
          })
          .catch(() => {});
        const { recordAudit } = await import("@/lib/audit");
        await recordAudit({
          actor: ACTOR,
          action: "chat.auto_replied",
          entity: "ChatConversation",
          entityId: conv.id,
          after: {
            topic,
            messageId: sent.id,
            preview: labeledText.slice(0, 120),
          },
        });
        out.autoSent++;
      } catch (err) {
        console.error(
          "[ai] auto-send failed",
          conv.id,
          err instanceof Error ? err.message : err
        );
      }
      continue;
    }

    const draftRow = await prisma.chatDraft.create({
      data: {
        conversationId: conv.id,
        text: generated.text,
        source: "AI",
        intent: topic,
        provider: generated.usage.provider,
        model: check
          ? `${generated.usage.model}${NEEDS_CHECK_SUFFIX}`
          : generated.usage.model,
        basedOnMessageId: gate.lastBuyerMessageId,
      },
    });
    await expirePending(conv.id, draftRow.id);

    if (action === "approval_queue") {
      await prisma.aiEvent
        .create({
          data: {
            conversationId: conv.id,
            decision: "approval_queued",
            intent: topic,
            ...generated.usage,
          },
        })
        .catch(() => {});
      await createChatReplyApproval({
        conversationId: conv.id,
        draftId: draftRow.id,
        buyerName: conv.buyerName,
        buyerMessageId: gate.lastBuyerMessageId,
        buyerPreview: gate.buyerText || "Buyer question",
        replyText: generated.text,
        topic,
        needsCheck: check,
        proposedBy: `assistant:${generated.usage.provider}`,
      });
      out.queued++;
    } else {
      await prisma.aiEvent
        .create({
          data: {
            conversationId: conv.id,
            decision: "ai_draft",
            intent: topic,
            ...generated.usage,
          },
        })
        .catch(() => {});
      out.drafted++;
    }
  }

  return out;
}
