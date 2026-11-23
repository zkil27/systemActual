import { describe, expect, it } from "vitest";
import {
  CHAT_ALERT_WINDOW_MS,
  chatAlertText,
  notifyNewBuyerMessage,
  planChatAlert,
  type ChatAlertState,
} from "@/lib/chats/notify";

function fakeDeps(start = new Date("2026-11-24T02:00:00Z"), sendOk = true) {
  let state: ChatAlertState = { lastSentAt: null, pending: 0 };
  let now = start;
  const sent: string[] = [];
  return {
    sent,
    get state() {
      return state;
    },
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
    deps: {
      load: async () => state,
      save: async (s: ChatAlertState) => {
        state = s;
      },
      send: async (text: string) => {
        sent.push(text);
        return sendOk;
      },
      now: () => now,
      baseUrl: "https://kyna.example/",
    },
  };
}

describe("planChatAlert", () => {
  const now = new Date("2026-11-24T02:00:00Z");

  it("sends right away when no alert went out recently", () => {
    expect(planChatAlert({ lastSentAt: null, pending: 0 }, 1, now)).toEqual({
      sendCount: 1,
      next: { lastSentAt: now, pending: 0 },
    });
  });

  it("holds messages inside the 2-minute window, then sends them together", () => {
    const held = planChatAlert({ lastSentAt: new Date(now.getTime() - 30_000), pending: 1 }, 2, now);
    expect(held).toEqual({ sendCount: null, next: { lastSentAt: new Date(now.getTime() - 30_000), pending: 3 } });
    const later = new Date(now.getTime() + CHAT_ALERT_WINDOW_MS);
    expect(planChatAlert(held.next, 0, later).sendCount).toBe(3);
  });
});

describe("notifyNewBuyerMessage", () => {
  it("groups a burst into one alert per 2 minutes", async () => {
    const f = fakeDeps();
    expect(await notifyNewBuyerMessage({}, f.deps)).toBe(true);
    f.advance(20_000);
    expect(await notifyNewBuyerMessage({}, f.deps)).toBe(false);
    f.advance(20_000);
    expect(await notifyNewBuyerMessage({}, f.deps)).toBe(false);
    expect(f.sent).toHaveLength(1);
    f.advance(CHAT_ALERT_WINDOW_MS);
    // The tick flushes what was held back.
    expect(await notifyNewBuyerMessage({ count: 0 }, f.deps)).toBe(true);
    expect(f.sent[1]).toBe("2 new buyer messages. Open Chats: https://kyna.example/chats");
  });

  it("doesn't alert for sample messages unless asked", async () => {
    const f = fakeDeps();
    expect(await notifyNewBuyerMessage({ sample: true }, f.deps)).toBe(false);
    expect(f.sent).toHaveLength(0);
    expect(await notifyNewBuyerMessage({ sample: true, includeSample: true }, f.deps)).toBe(true);
  });

  it("keeps messages pending when Telegram isn't set up", async () => {
    const f = fakeDeps(undefined, false);
    expect(await notifyNewBuyerMessage({}, f.deps)).toBe(false);
    expect(f.state.pending).toBe(1);
  });

  it("writes one message in plain words", () => {
    expect(chatAlertText(1, null)).toBe("1 new buyer message. Open Chats in Kyna Ops.");
  });
});
