import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockState = vi.hoisted(() => ({
  settings: { id: "default", telegramChatId: "12345" } as { id: string; telegramChatId: string } | null,
  staleCount: 0,
  printDeviceCount: 1,
  sentMessages: [] as Array<{ chatId: string; text: string; replyMarkup?: Record<string, unknown> }>,
  editedMessages: [] as Array<{ chatId: string; messageId: number; text: string; replyMarkup?: Record<string, unknown> }>,
  callbackAnswers: [] as Array<{ id: string; text: string }>,
  aiEnabledCalls: [] as boolean[],
  auditCalls: [] as Array<Record<string, unknown>>,
  manualTickCount: 0,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (fn: () => void | Promise<void>) => {
      void fn();
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSettings: {
      findUnique: vi.fn(async () => mockState.settings),
    },
    shopConnection: {
      count: vi.fn(async () => mockState.staleCount),
    },
    printDevice: {
      updateMany: vi.fn(async () => ({ count: mockState.printDeviceCount })),
    },
  },
}));

vi.mock("@/lib/telegram", () => ({
  sendTelegramMessage: vi.fn(async (chatId: string, text: string, replyMarkup?: Record<string, unknown>) => {
    mockState.sentMessages.push({ chatId, text, replyMarkup });
    return true;
  }),
  editTelegramMessageText: vi.fn(
    async (chatId: string, messageId: number, text: string, replyMarkup?: Record<string, unknown>) => {
      mockState.editedMessages.push({ chatId, messageId, text, replyMarkup });
      return true;
    }
  ),
  answerTelegramCallback: vi.fn(async (id: string, text: string) => {
    mockState.callbackAnswers.push({ id, text });
    return true;
  }),
  buildTelegramReply: vi.fn(async () => "ok"),
}));

vi.mock("@/lib/ai/settings-store", () => ({
  setAiEnabled: vi.fn(async (on: boolean) => {
    mockState.aiEnabledCalls.push(on);
  }),
}));

vi.mock("@/lib/audit", () => ({
  systemActor: (job: string) => ({ type: "SYSTEM", id: job, name: job }),
  recordAudit: vi.fn(async (entry: Record<string, unknown>) => {
    mockState.auditCalls.push(entry);
  }),
}));

vi.mock("@/lib/worker/tick", () => ({
  runTick: vi.fn(async () => {
    mockState.manualTickCount += 1;
    return { ran: true };
  }),
}));

import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { POST as telegramWebhookPost } from "@/app/api/telegram/webhook/route";
import { createOwnerToken, OWNER_COOKIE, STAFF_COOKIE, verifyOwnerToken } from "@/lib/auth";
import { parseOpsCallbackData } from "@/lib/telegram-commands";

describe("route handlers & session integration", () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
    process.env.TELEGRAM_WEBHOOK_SECRET = "test-tg-secret-32-chars-minimum!!";
    mockState.settings = { id: "default", telegramChatId: "12345" };
    mockState.staleCount = 0;
    mockState.printDeviceCount = 1;
    mockState.sentMessages = [];
    mockState.editedMessages = [];
    mockState.callbackAnswers = [];
    mockState.aiEnabledCalls = [];
    mockState.auditCalls = [];
    mockState.manualTickCount = 0;
  });

  it("preserves tokenVersion (tv) in owner JWTs shared across auth and session-edge", async () => {
    const token = await createOwnerToken({
      role: "owner",
      userId: "u1",
      email: "owner@example.com",
      name: "Owner",
      tv: 4,
    });
    const verified = await verifyOwnerToken(token);
    expect(verified).toMatchObject({ role: "owner", userId: "u1", tv: 4 });
  });

  it("POST /api/auth/logout clears staff cookie only for scope=staff and both cookies otherwise", async () => {
    const staffOnly = await logoutPost(new NextRequest("http://localhost/api/auth/logout?scope=staff", { method: "POST" }));
    expect(staffOnly.status).toBe(200);
    const staffCookies = staffOnly.headers.getSetCookie().join(";");
    expect(staffCookies).toContain(`${STAFF_COOKIE}=`);
    expect(staffCookies).not.toContain(`${OWNER_COOKIE}=`);

    const both = await logoutPost(new NextRequest("http://localhost/api/auth/logout", { method: "POST" }));
    expect(both.status).toBe(200);
    const allCookies = both.headers.getSetCookie().join(";");
    expect(allCookies).toContain(`${OWNER_COOKIE}=`);
    expect(allCookies).toContain(`${STAFF_COOKIE}=`);
  });

  it("POST /api/telegram/webhook rejects requests with a wrong secret", async () => {
    const req = new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": "wrong",
      },
      body: JSON.stringify({ message: { chat: { id: 12345 }, text: "/pause" } }),
    });
    const res = await telegramWebhookPost(req);
    expect(res.status).toBe(401);
  });

  it("Telegram /pause asks for confirmation first, then executes with an Undo button", async () => {
    const askReq = new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET!,
      },
      body: JSON.stringify({ message: { chat: { id: 12345 }, text: "/pause" } }),
    });
    const askRes = await telegramWebhookPost(askReq);
    expect(askRes.status).toBe(200);
    expect(mockState.sentMessages).toHaveLength(1);
    expect(mockState.sentMessages[0].text).toContain("Pause label printing");
    expect(JSON.stringify(mockState.sentMessages[0].replyMarkup)).toContain("ops:confirm:pause");
    expect(mockState.auditCalls).toHaveLength(0);

    // Confirm tap executes pause and offers Undo.
    const confirmReq = new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET!,
      },
      body: JSON.stringify({
        callback_query: {
          id: "cb1",
          data: "ops:confirm:pause",
          message: { chat: { id: 12345 }, message_id: 99, text: "Pause?" },
        },
      }),
    });
    await telegramWebhookPost(confirmReq);
    expect(mockState.auditCalls).toHaveLength(1);
    expect(mockState.editedMessages[0].text).toContain("PRINTING PAUSED");
    expect(JSON.stringify(mockState.editedMessages[0].replyMarkup)).toContain("ops:undo:pause");

    // Undo tap resumes printing and clears keyboard.
    const undoReq = new NextRequest("http://localhost/api/telegram/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET!,
      },
      body: JSON.stringify({
        callback_query: {
          id: "cb2",
          data: "ops:undo:pause",
          message: { chat: { id: 12345 }, message_id: 99, text: "PRINTING PAUSED" },
        },
      }),
    });
    await telegramWebhookPost(undoReq);
    expect(mockState.auditCalls).toHaveLength(2);
    expect(mockState.editedMessages[1].text).toContain("Undone");
    expect(mockState.editedMessages[1].replyMarkup).toEqual({ inline_keyboard: [] });
  });

  it("Telegram cancel callback makes no changes and confirm:sync triggers manual tick", async () => {
    expect(parseOpsCallbackData("ops:cancel:aioff")).toEqual({ action: "cancel", cmd: "aioff" });
    expect(parseOpsCallbackData("ops:bogus:pause")).toBeNull();

    await telegramWebhookPost(
      new NextRequest("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET!,
        },
        body: JSON.stringify({
          callback_query: {
            id: "cb3",
            data: "ops:cancel:aioff",
            message: { chat: { id: 12345 }, message_id: 101, text: "Turn off?" },
          },
        }),
      })
    );
    expect(mockState.aiEnabledCalls).toHaveLength(0);
    expect(mockState.editedMessages[0].text).toContain("Cancelled");

    await telegramWebhookPost(
      new NextRequest("http://localhost/api/telegram/webhook", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-telegram-bot-api-secret-token": process.env.TELEGRAM_WEBHOOK_SECRET!,
        },
        body: JSON.stringify({
          callback_query: {
            id: "cb4",
            data: "ops:confirm:sync",
            message: { chat: { id: 12345 }, message_id: 102, text: "Sync?" },
          },
        }),
      })
    );
    expect(mockState.manualTickCount).toBe(1);
    expect(mockState.editedMessages[1].text).toContain("Syncing both shops");
  });
});
