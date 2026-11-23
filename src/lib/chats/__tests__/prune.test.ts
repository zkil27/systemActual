import { describe, expect, it, vi } from "vitest";
import { CHAT_RETENTION_DAYS, isOwnChatBlob, pruneOldChats } from "@/lib/chats/prune";

describe("pruneOldChats", () => {
  const now = new Date("2026-11-24T02:00:00Z");

  it("deletes messages older than 90 days and the chat photos we stored for them", async () => {
    const deps = {
      findOldMessages: vi.fn<(cutoff: Date, take: number) => Promise<Array<{ id: string; imageUrl: string | null }>>>(async () => [
        { id: "m1", imageUrl: null },
        { id: "m2", imageUrl: "https://abc.public.blob.vercel-storage.com/chat-photos/chat-photo-1-aa.jpg" },
        { id: "m3", imageUrl: "data:image/svg+xml;utf8,<svg/>" },
        { id: "m4", imageUrl: "https://down-ph.img.susercontent.com/buyer.jpg" },
      ]),
      deleteMessages: vi.fn(async (ids: string[]) => ids.length),
      deleteOldConversations: vi.fn(async () => 2),
      deleteBlobs: vi.fn(async () => {}),
    };
    const res = await pruneOldChats(now, deps);
    const cutoff = deps.findOldMessages.mock.calls[0][0];
    expect(now.getTime() - cutoff.getTime()).toBe(CHAT_RETENTION_DAYS * 24 * 3600_000);
    expect(deps.deleteBlobs).toHaveBeenCalledWith([
      "https://abc.public.blob.vercel-storage.com/chat-photos/chat-photo-1-aa.jpg",
    ]);
    expect(deps.deleteMessages).toHaveBeenCalledWith(["m1", "m2", "m3", "m4"]);
    expect(res).toEqual({ messages: 4, conversations: 2, blobs: 1 });
  });

  it("still deletes rows when there's no Blob store (local dev)", async () => {
    const deps = {
      findOldMessages: async () => [{ id: "m1", imageUrl: "/api/chats/photos/chat-photo-1-aa.jpg" }],
      deleteMessages: vi.fn(async (ids: string[]) => ids.length),
      deleteOldConversations: async () => 0,
      deleteBlobs: null,
    };
    expect(await pruneOldChats(now, deps)).toEqual({ messages: 1, conversations: 0, blobs: 0 });
  });

  it("only treats our own uploads as chat blobs", () => {
    expect(isOwnChatBlob("https://x.blob.vercel-storage.com/chat-photos/a.jpg")).toBe(true);
    expect(isOwnChatBlob("https://x.blob.vercel-storage.com/return-proofs/a.jpg")).toBe(false);
    expect(isOwnChatBlob(null)).toBe(false);
  });
});
