import { describe, expect, it } from "vitest";
import {
  checkReplyText,
  MAX_REPLY_CHARS,
  ReplyKeyConflictError,
  sendReply,
  type ReplyStore,
  type StoredReply,
} from "@/lib/chats/send";
import type { ChatSource } from "@/lib/chats/source";

const conv = { id: "c1", externalId: "x1", platform: "TIKTOK" as const, shopConnectionId: "s1" };

function memoryStore() {
  const rows = new Map<string, StoredReply>();
  const touched: string[] = [];
  let seq = 0;
  const store: ReplyStore = {
    async findByClientKey(key) {
      return [...rows.values()].find((r) => r.clientKey === key) ?? null;
    },
    async create(data) {
      const row: StoredReply = { id: `m${++seq}`, status: "SENDING", ...data };
      rows.set(row.id, row);
      return row;
    },
    async claimForRetry(id) {
      const row = rows.get(id);
      if (!row || row.status !== "FAILED") return false;
      row.status = "SENDING";
      return true;
    },
    async finish(id, result) {
      const row = rows.get(id)!;
      row.status = result.status;
      return { ...row };
    },
    async touchConversation(_id, _at, preview) {
      touched.push(preview);
    },
  };
  return { store, rows, touched };
}

function source(failTimes = 0): ChatSource & { sent: number } {
  let fails = failTimes;
  const s = {
    sent: 0,
    async send() {
      if (fails > 0) {
        fails--;
        throw new Error("shop said no");
      }
      s.sent++;
      return { externalId: `ext-${s.sent}`, sentAt: new Date() };
    },
    async markRead() {},
  };
  return s;
}

describe("checkReplyText", () => {
  it("trims and rejects empty or too-long replies", () => {
    expect(checkReplyText("  hi po  ")).toEqual({ ok: true, text: "hi po" });
    expect(checkReplyText("   ").ok).toBe(false);
    expect(checkReplyText(undefined).ok).toBe(false);
    expect(checkReplyText("a".repeat(MAX_REPLY_CHARS)).ok).toBe(true);
    expect(checkReplyText("a".repeat(MAX_REPLY_CHARS + 1)).ok).toBe(false);
  });
});

describe("sendReply", () => {
  it("sends once and updates the chat preview", async () => {
    const { store, rows, touched } = memoryStore();
    const src = source();
    const res = await sendReply({ conversation: conv, clientKey: "key-1", content: { text: "Hello po" } }, { store, source: src });
    expect(res.status).toBe("SENT");
    expect(rows.size).toBe(1);
    expect(src.sent).toBe(1);
    expect(touched).toEqual(["You: Hello po"]);
  });

  it("never posts twice for the same clientKey", async () => {
    const { store, rows } = memoryStore();
    const src = source();
    await sendReply({ conversation: conv, clientKey: "key-1", content: { text: "Hello" } }, { store, source: src });
    const again = await sendReply({ conversation: conv, clientKey: "key-1", content: { text: "Hello" } }, { store, source: src });
    expect(again.status).toBe("SENT");
    expect(rows.size).toBe(1);
    expect(src.sent).toBe(1);
  });

  it("marks a failed send FAILED, then a retry sends the stored text", async () => {
    const { store, rows } = memoryStore();
    const src = source(1);
    const first = await sendReply({ conversation: conv, clientKey: "key-2", content: { text: "Salamat po" } }, { store, source: src });
    expect(first.status).toBe("FAILED");
    // The retry may carry different content; the stored text is what goes out.
    const retry = await sendReply({ conversation: conv, clientKey: "key-2", content: { text: "" } }, { store, source: src });
    expect(retry.status).toBe("SENT");
    expect(retry.text).toBe("Salamat po");
    expect(rows.size).toBe(1);
  });

  it("stores photos as IMAGE replies", async () => {
    const { store, touched } = memoryStore();
    const res = await sendReply(
      { conversation: conv, clientKey: "key-3", content: { imageUrl: "https://x/chat-photos/a.jpg" } },
      { store, source: source() }
    );
    expect(res.kind).toBe("IMAGE");
    expect(touched).toEqual(["You: Photo"]);
  });

  it("refuses a clientKey that belongs to another chat", async () => {
    const { store } = memoryStore();
    await sendReply({ conversation: conv, clientKey: "key-4", content: { text: "a" } }, { store, source: source() });
    await expect(
      sendReply({ conversation: { ...conv, id: "c2" }, clientKey: "key-4", content: { text: "a" } }, { store, source: source() })
    ).rejects.toBeInstanceOf(ReplyKeyConflictError);
  });
});
