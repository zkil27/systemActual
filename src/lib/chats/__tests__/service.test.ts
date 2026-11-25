import { describe, expect, it, vi } from "vitest";
import { listChats, markChatRead, sumUnread } from "@/lib/chats/service";

describe("listChats", () => {
  it("lists no Shopee chats while Shopee is coming soon", async () => {
    expect(await listChats("SHOPEE")).toEqual({ items: [], nextCursor: null, comingSoon: true });
  });
});

describe("sumUnread", () => {
  it("counts real TikTok chats only", () => {
    const totals = sumUnread([
      { platform: "SHOPEE", isDemo: false, unread: 2 }, // coming soon
      { platform: "SHOPEE", isDemo: true, unread: 1 },
      { platform: "TIKTOK", isDemo: true, unread: 5 }, // sample shop
      { platform: "TIKTOK", isDemo: false, unread: 4 },
    ]);
    expect(totals).toEqual({ SHOPEE: 0, TIKTOK: 4, total: 4 });
  });
});

describe("markChatRead", () => {
  const conv = {
    id: "c1",
    externalId: "x",
    platform: "TIKTOK" as const,
    shopConnectionId: "s",
    shopConnection: { isDemo: true },
  };

  it("clears unread and tells the shop once", async () => {
    let unread = 3;
    const markRead = vi.fn(async () => {});
    const deps = {
      load: vi.fn(async () => ({ ...conv, unreadCount: unread })),
      clear: vi.fn(async () => {
        const had = unread > 0 ? 1 : 0;
        unread = 0;
        return had;
      }),
      sourceFor: () => ({ send: vi.fn(), markRead }),
    };
    expect(await markChatRead("c1", deps as never)).toBe(true);
    expect(unread).toBe(0);
    expect(await markChatRead("c1", deps as never)).toBe(true);
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(deps.clear).toHaveBeenCalledTimes(1);
  });

  it("returns false for a chat that doesn't exist", async () => {
    const deps = { load: async () => null, clear: vi.fn(), sourceFor: vi.fn() };
    expect(await markChatRead("nope", deps as never)).toBe(false);
    expect(deps.clear).not.toHaveBeenCalled();
  });
});
