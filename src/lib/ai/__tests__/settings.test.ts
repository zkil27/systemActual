import { describe, expect, it } from "vitest";
import {
  aiAutosendSetting,
  aiSettingsInput,
  canAutoSend,
  cleanTopicModes,
  mayAutoSendTo,
  shopAnswerInput,
  topicMode,
  withAutoLabel,
} from "@/lib/ai/settings";
import { toSettingsView } from "@/lib/ai/settings-store";
import { parseCommand } from "@/lib/telegram-commands";
import { isPublicPath } from "@/lib/public-paths";

const TEST_CHAT = "7711505717312651527";

describe("topic modes", () => {
  it("defaults to draft and never lets returns auto-send", () => {
    expect(topicMode({}, "order")).toBe("draft");
    expect(topicMode({ order: "auto" }, "order")).toBe("auto");
    expect(topicMode({ order: "nonsense" }, "order")).toBe("draft");
    expect(topicMode({ returns: "auto" }, "returns")).toBe("draft");
    expect(topicMode(null, "size")).toBe("draft");
  });

  it("cleans saved modes: known topics only, returns capped", () => {
    const out = cleanTopicModes({ order: "auto", returns: "auto", hacked: "auto" }, { size: "off" });
    expect(out.order).toBe("auto");
    expect(out.returns).toBe("draft");
    expect(out.size).toBe("off");
    expect(out).not.toHaveProperty("hacked");
  });
});

describe("AI_AUTOSEND_TIKTOK allowlist", () => {
  it("parses off, all and id lists", () => {
    expect(aiAutosendSetting("")).toBe("off");
    expect(aiAutosendSetting(" OFF ")).toBe("off");
    expect(aiAutosendSetting("all")).toBe("all");
    expect(aiAutosendSetting(`${TEST_CHAT}, 123`)).toEqual(new Set([TEST_CHAT, "123"]));
  });

  it("only listed chats may auto-send", () => {
    const only = aiAutosendSetting(TEST_CHAT);
    expect(mayAutoSendTo(TEST_CHAT, only)).toBe(true);
    expect(mayAutoSendTo("999", only)).toBe(false);
    expect(mayAutoSendTo(null, "all")).toBe(false);
    expect(mayAutoSendTo(TEST_CHAT, "off")).toBe(false);
  });

  it("needs the switch on, auto mode, an auto-capable topic and the allowlist", () => {
    const base = { enabled: true, mode: "auto" as const, topic: "order" as const, conversationExternalId: TEST_CHAT, autosend: aiAutosendSetting(TEST_CHAT) };
    expect(canAutoSend(base)).toBe(true);
    expect(canAutoSend({ ...base, enabled: false })).toBe(false);
    expect(canAutoSend({ ...base, mode: "draft" })).toBe(false);
    expect(canAutoSend({ ...base, topic: "returns" })).toBe(false);
    expect(canAutoSend({ ...base, conversationExternalId: "999" })).toBe(false);
    expect(canAutoSend({ ...base, autosend: "off" })).toBe(false);
  });
});

describe("labels and input checks", () => {
  it("puts the label first, once", () => {
    expect(withAutoLabel("Salamat po!", "(Auto-reply)")).toBe("(Auto-reply) Salamat po!");
    expect(withAutoLabel("(Auto-reply) Salamat po!", "(Auto-reply)")).toBe("(Auto-reply) Salamat po!");
    expect(withAutoLabel("Hi", "  ")).toBe("(Auto-reply) Hi");
  });

  it("validates settings and shop answers", () => {
    expect(aiSettingsInput.safeParse({ eveningReservePct: 90 }).success).toBe(false);
    expect(aiSettingsInput.safeParse({ autoLabel: "" }).success).toBe(false);
    expect(aiSettingsInput.safeParse({ enabled: true, topicModes: { order: "auto" } }).success).toBe(true);
    expect(shopAnswerInput.safeParse({ topic: "cod", title: "COD", answer: "Yes po" }).success).toBe(true);
    expect(shopAnswerInput.safeParse({ topic: "bogus", title: "x", answer: "y" }).success).toBe(false);
    expect(shopAnswerInput.safeParse({ topic: "cod", title: "x", answer: "a".repeat(1501) }).success).toBe(false);
  });

  it("starts switched off with safe defaults when nothing is saved", () => {
    const v = toSettingsView(null);
    expect(v.enabled).toBe(false);
    expect(v.topicModes.order).toBe("draft");
    expect(v.autoLabel).toBe("(Auto-reply)");
  });
});

describe("owner controls", () => {
  it("reads /aioff and /aion", () => {
    expect(parseCommand("/aioff")).toEqual({ cmd: "aioff", arg: "" });
    expect(parseCommand("/aion@KynaBot")).toEqual({ cmd: "aion", arg: "" });
  });

  it("keeps the assistant settings owner-only", () => {
    expect(isPublicPath("/settings/assistant")).toBe(false);
    expect(isPublicPath("/api/assistant")).toBe(false);
  });
});
