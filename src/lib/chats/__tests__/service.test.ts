import { describe, expect, it, vi } from "vitest";
import { chatVisibility, markChatRead, sumUnread } from "@/lib/chats/service";

describe("chatVisibility", () => {
  const demoShops = [
    { platform: "SHOPEE", isDemo: true, accessToken: null },
    { platform: "TIKTOK", isDemo: true, accessToken: null },
  ];

  it("shows sample chats while no real shop has live chats", () => {
    const vis = chatVisibility([...demoShops, { platform: "TIKTOK", isDemo: false, accessToken: "t" }]);
    expect(vis).toEqual({ SHOPEE: { sample: true }, TIKTOK: { sample: true } });
  });

  it("hides sample chats only for the platform whose real shop is live", () => {
    const live = (s: { isDemo: boolean; platform: string }) => !s.isDemo && s.platform === "TIKTOK";
    const vis = chatVisibility([...demoShops, { platform: "TIKTOK", isDemo: false, accessToken: "t" }], live);
    expect(vis).toEqual({ SHOPEE: { sample: true }, TIKTOK: { sample: false } });
  });
});

describe("sumUnread", () => {
  it("counts only the chats shown for each platform", () => {
    const vis = { SHOPEE: { sample: true }, TIKTOK: { sample: false } };
    const totals = sumUnread(
      [
        { platform: "SHOPEE", isDemo: true, unread: 2 },
        { platform: "SHOPEE", isDemo: true, unread: 1 },
        { platform: "TIKTOK", isDemo: true, unread: 5 }, // hidden: TikTok is live
        { platform: "TIKTOK", isDemo: false, unread: 4 },
      ],
      vis
    );
    expect(totals).toEqual({ SHOPEE: 3, TIKTOK: 4, total: 7 });
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
