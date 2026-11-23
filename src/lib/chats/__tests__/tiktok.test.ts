import { describe, expect, it, vi } from "vitest";
import {
  latestOrderSn,
  normalizeConversation,
  normalizeMessage,
  senderFor,
  ttTime,
} from "@/lib/chats/tiktok-normalize";
import { collectNewMessages } from "@/lib/chats/tiktok-sync";
import {
  isTemporaryTikTokError,
  sendImageMessage,
  sendTextMessage,
  uploadChatImage,
  type TtCall,
  type TtMessage,
} from "@/lib/chats/tiktok-api";
import { isChatWebhook } from "@/lib/chats/webhook";
import { canSendFrom, isChatLive, tiktokSendSetting } from "@/lib/chats/source";
import { replyState } from "@/lib/chats/service";
import { previewFor } from "@/lib/chats/types";

const msg = (over: Partial<TtMessage>): TtMessage => ({
  id: "m1",
  type: "TEXT",
  content: JSON.stringify({ content: "Hello po" }),
  create_time: 1795400000,
  is_visible: true,
  sender: { role: "BUYER" },
  ...over,
});

describe("normalizeMessage (formats seen on the live shop)", () => {
  it("reads buyer text", () => {
    const m = normalizeMessage(msg({}))!;
    expect(m).toMatchObject({ externalId: "m1", sender: "BUYER", kind: "TEXT", text: "Hello po" });
    expect(m.sentAt.toISOString()).toBe(new Date(1795400000 * 1000).toISOString());
  });

  it("maps every sender role", () => {
    expect(senderFor("BUYER")).toBe("BUYER");
    expect(senderFor("SHOP")).toBe("SELLER");
    expect(senderFor("CUSTOMER_SERVICE")).toBe("SELLER");
    expect(senderFor("ROBOT")).toBe("ROBOT");
    expect(senderFor("SYSTEM")).toBe("SYSTEM");
    expect(senderFor(undefined)).toBe("SYSTEM");
  });

  it("turns order and delivery cards into order cards with the order number", () => {
    const order = normalizeMessage(msg({ type: "ORDER_CARD", content: '{"order_id":"577104219834661021"}' }))!;
    expect(order).toMatchObject({ kind: "ORDER_CARD", orderSn: "577104219834661021", logistics: false });
    const delivery = normalizeMessage(
      msg({ type: "LOGISTICS_CARD", content: '{"order_id":"5771","package_id":"1150"}', sender: { role: "SYSTEM" } })
    )!;
    expect(delivery).toMatchObject({ kind: "ORDER_CARD", orderSn: "5771", packageId: "1150", logistics: true });
  });

  it("shows notices as system lines and hides invisible ones", () => {
    expect(
      normalizeMessage(msg({ type: "ALLOCATED_SERVICE", content: '{"content":"Assigned to agent"}', sender: { role: "SHOP" } }))
    ).toMatchObject({ sender: "SYSTEM", text: "Assigned to agent" });
    expect(normalizeMessage(msg({ type: "NOTIFICATION", is_visible: false }))).toBeNull();
  });

  it("handles photos, stickers and odd content safely", () => {
    expect(normalizeMessage(msg({ type: "IMAGE", content: '{"url":"https://p16.tiktokcdn.com/a.jpg"}' }))).toMatchObject({
      kind: "IMAGE",
      imageUrl: "https://p16.tiktokcdn.com/a.jpg",
    });
    expect(normalizeMessage(msg({ type: "IMAGE", content: "{}" }))).toMatchObject({ kind: "OTHER" });
    expect(
      normalizeMessage(
        msg({ type: "OTHER", content: '{"content":"[Other] Please check this message in seller center of TikTok shop."}' })
      )
    ).toMatchObject({ kind: "OTHER", text: null });
    expect(normalizeMessage(msg({ content: "not json" }))).toMatchObject({ text: "not json" });
    expect(normalizeMessage(msg({ id: "" }))).toBeNull();
  });

  it("finds the newest order mentioned", () => {
    const a = normalizeMessage(msg({ id: "a", type: "ORDER_CARD", content: '{"order_id":"1"}', create_time: 100 }))!;
    const b = normalizeMessage(msg({ id: "b", type: "LOGISTICS_CARD", content: '{"order_id":"2"}', create_time: 200 }))!;
    expect(latestOrderSn([b, a])).toBe("2");
    expect(latestOrderSn([])).toBeNull();
  });

  it("accepts seconds or milliseconds", () => {
    expect(ttTime(1795400000).getTime()).toBe(1795400000000);
    expect(ttTime(1795400000123).getTime()).toBe(1795400000123);
    expect(ttTime("x").getTime()).toBe(0);
  });
});

describe("normalizeConversation", () => {
  it("takes the buyer from the participants, not the shop or agent", () => {
    const c = normalizeConversation({
      id: "c1",
      create_time: 1795300000,
      can_send_message: true,
      unread_count: 2,
      participants: [
        { role: "SHOP", nickname: "Kyna" },
        { role: "CUSTOMER_SERVICE", nickname: "Agent" },
        { role: "BUYER", nickname: "Trisha", avatar: "https://x/a.jpg" },
      ],
      latest_message: msg({ create_time: 1795400000 }),
    });
    expect(c).toMatchObject({ externalId: "c1", buyerName: "Trisha", buyerAvatarUrl: "https://x/a.jpg", unreadCount: 2, canReply: true });
    expect(c.lastMessageAt.getTime()).toBe(1795400000000);
    expect(normalizeConversation({ id: "c2", create_time: 1, can_send_message: false }).buyerName).toBe("TikTok buyer");
    expect(normalizeConversation({ id: "c2", create_time: 1, can_send_message: false }).canReply).toBe(false);
  });
});

describe("collectNewMessages", () => {
  // TikTok: newest first, 10 per page.
  function fakeCall(all: TtMessage[]): TtCall & { calls: number } {
    const f = vi.fn(async (opts: { query?: Record<string, string> }) => {
      const start = Number(opts.query?.page_token ?? 0);
      const page = all.slice(start, start + 10);
      return { messages: page, next_page_token: start + 10 < all.length ? String(start + 10) : "" };
    }) as unknown as TtCall & { calls: number };
    return f;
  }
  const history = Array.from({ length: 25 }, (_, i) => msg({ id: `m${25 - i}`, create_time: 1795400000 - i * 60 }));

  it("stops at the first message we already have and returns oldest first", async () => {
    const call = fakeCall(history);
    const out = await collectNewMessages(call, "c1", { knownIds: new Set(["m22"]), since: null, maxPages: 5 });
    expect(out.map((m) => m.id)).toEqual(["m23", "m24", "m25"]);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("reads at most maxPages on a first import", async () => {
    const call = fakeCall(history);
    const out = await collectNewMessages(call, "c1", { knownIds: new Set(), since: null, maxPages: 2 });
    expect(out).toHaveLength(20);
    expect(out[0].id).toBe("m6");
    expect(out[19].id).toBe("m25");
  });

  it("stops at messages older than the last one we saw, with a minute of overlap", async () => {
    const call = fakeCall(history);
    const since = new Date((1795400000 - 3 * 60) * 1000);
    const out = await collectNewMessages(call, "c1", { knownIds: new Set(), since, maxPages: 5 });
    // m21 is exactly a minute before `since`: kept, and skipped on save if we have it.
    expect(out.map((m) => m.id)).toEqual(["m21", "m22", "m23", "m24", "m25"]);
  });
});

describe("sendTextMessage", () => {
  it("posts TikTok's TEXT format and returns the message id", async () => {
    const call = vi.fn(async () => ({ message_id: "7711506144343590420" }));
    expect(await sendTextMessage(call as unknown as TtCall, "c1", "Hi po")).toBe("7711506144343590420");
    expect(call).toHaveBeenCalledWith({
      method: "POST",
      path: "/customer_service/202309/conversations/c1/messages",
      body: { type: "TEXT", content: '{"content":"Hi po"}' },
    });
  });
});

describe("photos to TikTok", () => {
  it("uploads, then sends TikTok's IMAGE format", async () => {
    const upload = vi.fn(async () => ({ url: "https://p16-oec-sg.ibyteimg.com/a.png", width: 400, height: 300 }));
    const img = await uploadChatImage(upload, new Blob(["x"]), "a.png");
    expect(img).toEqual({ url: "https://p16-oec-sg.ibyteimg.com/a.png", width: 400, height: 300 });
    const call = vi.fn(async () => ({ message_id: "77115" }));
    expect(await sendImageMessage(call as unknown as TtCall, "c1", img)).toBe("77115");
    expect(call).toHaveBeenCalledWith({
      method: "POST",
      path: "/customer_service/202309/conversations/c1/messages",
      body: { type: "IMAGE", content: '{"url":"https://p16-oec-sg.ibyteimg.com/a.png","width":400,"height":300}' },
    });
  });

  it("fails clearly when TikTok returns no photo", async () => {
    await expect(uploadChatImage(async () => ({}), new Blob(["x"]), "a.png")).rejects.toThrow(/didn't return/);
  });

  it("reads TikTok's photo messages back (url, width, height)", () => {
    const m = normalizeMessage(
      msg({ type: "IMAGE", content: '{"url":"https://p16-oec-sg.ibyteimg.com/a.png","width":400,"height":400}', sender: { role: "CUSTOMER_SERVICE" } })
    );
    expect(m).toMatchObject({ kind: "IMAGE", sender: "SELLER", imageUrl: "https://p16-oec-sg.ibyteimg.com/a.png" });
  });
});

describe("TikTok chat webhooks and switches", () => {
  it("tells chat events from order events", () => {
    expect(isChatWebhook({ conversation_id: "123", message_id: "9" })).toBe(true);
    expect(isChatWebhook({ order_id: "5771", order_status: "AWAITING_SHIPMENT" })).toBe(false);
    expect(isChatWebhook({ conversation_id: "", order_id: "1" })).toBe(false);
    expect(isChatWebhook(null)).toBe(false);
  });

  it("shows real TikTok chats only after the first load, and keeps sending off", () => {
    const real = { isDemo: false, platform: "TIKTOK", accessToken: "t" };
    expect(isChatLive(real)).toBe(false);
    expect(isChatLive({ ...real, chatAccessAt: new Date() })).toBe(true);
    expect(isChatLive({ ...real, platform: "SHOPEE", chatAccessAt: new Date() })).toBe(false);
    // Explicit setting: the test must not depend on the local .env.
    expect(canSendFrom(real, "c1", "off")).toBe(false);
    expect(canSendFrom({ isDemo: true, platform: "TIKTOK" }, undefined, "off")).toBe(true);
  });

  it("sends to real TikTok chats only where CHAT_SEND_TIKTOK allows", () => {
    const real = { isDemo: false, platform: "TIKTOK" };
    expect(tiktokSendSetting("")).toBe("off");
    expect(tiktokSendSetting(" OFF ")).toBe("off");
    expect(tiktokSendSetting("all")).toBe("all");
    const only = tiktokSendSetting("7711505717312651527, 123");
    expect(canSendFrom(real, "7711505717312651527", only)).toBe(true);
    expect(canSendFrom(real, "999", only)).toBe(false);
    expect(canSendFrom(real, undefined, only)).toBe(false);
    expect(canSendFrom(real, "999", "all")).toBe(true);
    expect(canSendFrom({ ...real, platform: "SHOPEE" }, "x", "all")).toBe(false);
    expect(canSendFrom(real, "7711505717312651527", "off")).toBe(false);
    // Allowed chat: text and photos. Not allowed: neither.
    expect(replyState(true, real, "123", only)).toEqual({ canReply: true, canSendPhotos: true, replyNote: null });
    expect(replyState(true, real, "999", only).canSendPhotos).toBe(false);
  });

  it("explains why the reply box is hidden", () => {
    expect(replyState(true, { isDemo: true, platform: "TIKTOK" })).toEqual({ canReply: true, canSendPhotos: true, replyNote: null });
    expect(replyState(true, { isDemo: false, platform: "TIKTOK" }, "x", "off").replyNote).toMatch(/Seller Center/);
    expect(replyState(false, { isDemo: true, platform: "TIKTOK" }).replyNote).toMatch(/doesn't allow/);
  });

  it("treats a burst of 'access denied' as temporary", () => {
    expect(isTemporaryTikTokError(new Error("Access denied. This app has not been granted any access scope"))).toBe(true);
    expect(isTemporaryTikTokError(new Error("Invalid API version"))).toBe(false);
  });

  it("labels auto-replies in the chat list", () => {
    expect(previewFor("TEXT", "Thanks for your message", "ROBOT")).toBe("Auto-reply: Thanks for your message");
    expect(previewFor("TEXT", "hi", "SELLER")).toBe("You: hi");
    expect(previewFor("OTHER", null, "BUYER")).toBe("Other message");
  });
});
