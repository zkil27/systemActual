import { describe, expect, it } from "vitest";
import { decideChatAutomation } from "../auto-reply";
import { AI_TOPIC_IDS, type AiMode, type AiTopic } from "../settings";

function makeModes(overrides: Partial<Record<AiTopic, AiMode>> = {}): Record<AiTopic, AiMode> {
  const out = {} as Record<AiTopic, AiMode>;
  for (const t of AI_TOPIC_IDS) out[t] = "draft";
  return { ...out, ...overrides };
}

describe("decideChatAutomation", () => {
  const base = {
    settings: {
      enabled: true,
      chatSendEnabled: true,
      autoSendEnabled: true,
      approvalQueueEnabled: true,
      topicModes: makeModes({ order: "auto", size: "auto", cod: "auto" }),
    },
    platform: "TIKTOK" as const,
    isDemo: false,
    conversationExternalId: "7711505717312651527",
    gate: { pending: true, hasMedia: false, buyerText: "Available pa ba M?", handoff: false },
    topics: ["size"] as AiTopic[],
    needsOwnerFlag: false,
    generatedNeedsCheck: false,
    chatSendOverride: "all" as const,
    autoSendOverride: "all" as const,
  };

  it("processes Shopee chats with the same safety rules as TikTok", () => {
    expect(decideChatAutomation({ ...base, platform: "SHOPEE" })).toBe("auto_send");
    expect(decideChatAutomation({ ...base, platform: "SHOPEE", topics: ["returns"] })).toBe("approval_queue");
  });

  it("auto-sends safe topics when all switches and rules allow it", () => {
    expect(decideChatAutomation(base)).toBe("auto_send");
  });

  it("auto-sends only for an allowlisted test buyer (kkkeewl) while global autoSendEnabled is off", () => {
    const testOnly = new Set(["7711505717312651527"]);
    expect(
      decideChatAutomation({
        ...base,
        settings: { ...base.settings, autoSendEnabled: false },
        autoSendOverride: testOnly,
      })
    ).toBe("auto_send");

    expect(
      decideChatAutomation({
        ...base,
        conversationExternalId: "999999999",
        settings: { ...base.settings, autoSendEnabled: false },
        autoSendOverride: testOnly,
      })
    ).toBe("approval_queue");
  });

  it("never auto-sends returns, needsCheck, handoff, or needsOwner; queues for approval instead", () => {
    expect(
      decideChatAutomation({
        ...base,
        topics: ["returns"],
        settings: { ...base.settings, topicModes: makeModes({ returns: "auto" }) },
      })
    ).toBe("approval_queue");

    expect(decideChatAutomation({ ...base, generatedNeedsCheck: true })).toBe("approval_queue");
    expect(decideChatAutomation({ ...base, gate: { ...base.gate, handoff: true } })).toBe("approval_queue");
    expect(decideChatAutomation({ ...base, needsOwnerFlag: true })).toBe("approval_queue");
  });

  it("falls back to draft_only when approvalQueueEnabled or chat sending is off", () => {
    expect(
      decideChatAutomation({
        ...base,
        topics: ["shipping"], // draft
        settings: { ...base.settings, approvalQueueEnabled: false },
      })
    ).toBe("draft_only");

    expect(
      decideChatAutomation({
        ...base,
        chatSendOverride: "off",
      })
    ).toBe("draft_only");
  });
});
