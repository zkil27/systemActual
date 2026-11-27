import { describe, expect, it, vi } from "vitest";
import {
  isTemporaryShopeeChatError,
  listShopeeConversations,
  listShopeeMessages,
  markShopeeConversationRead,
  safeInt64Literal,
  sendShopeeImageMessage,
  sendShopeeTextMessage,
  type SpCall,
} from "@/lib/chats/shopee-api";
import {
  normalizeShopeeConversation,
  normalizeShopeeMessage,
  spTime,
} from "@/lib/chats/shopee-normalize";
import { collectNewShopeeMessages } from "@/lib/chats/shopee-sync";
import { canSendFrom, canSendPhotosFrom, chatSourceFor, isChatLive } from "@/lib/chats/source";

describe("Shopee Seller Chat API helpers", () => {
  it("preserves 18-digit conversation_id and to_id without float precision loss", async () => {
    const calls: Array<{ method: string; path: string; rawBody?: string }> = [];
    const call: SpCall = async (opts) => {
      calls.push({ method: opts.method, path: opts.path, rawBody: opts.rawBody });
      return { message_id: "998877665544332211" };
    };

    // 678159612343515082 exceeds Number.MAX_SAFE_INTEGER and would round to ...515100 via Number()
    await markShopeeConversationRead(call, "678159612343515082", "2448983838263017841");
    expect(calls[0]).toEqual({
      method: "POST",
      path: "/api/v2/sellerchat/read_conversation",
      rawBody: '{"conversation_id":678159612343515082,"last_read_message_id":"2448983838263017841"}',
    });

    const textId = await sendShopeeTextMessage(call, "157896339", "Hi po! Available po.");
    expect(textId).toBe("998877665544332211");
    expect(calls[1].rawBody).toBe('{"to_id":157896339,"message_type":"text","content":{"text":"Hi po! Available po."}}');

    const imgId = await sendShopeeImageMessage(call, "157896339", "https://down-sg.img.susercontent.com/abc");
    expect(imgId).toBe("998877665544332211");
    expect(calls[2].rawBody).toBe(
      '{"to_id":157896339,"message_type":"image","content":{"image_url":"https://down-sg.img.susercontent.com/abc"}}'
    );
  });

  it("rejects non-numeric int64 literals", () => {
    expect(() => safeInt64Literal("abc", "to_id")).toThrow(/Invalid Shopee to_id/);
    expect(() => safeInt64Literal("", "conversation_id")).toThrow(/Invalid Shopee conversation_id/);
  });

  it("lists conversations newest-first using direction=older and next_timestamp_nano", async () => {
    const call = vi.fn<SpCall>(async () => ({
      conversations: [{ conversation_id: "678159612343515082", to_name: "Maria" }],
      page_result: { more: true, next_cursor: { next_message_time_nano: "1795767878627107788" } },
    }));
    const res = await listShopeeConversations(call, "1795770000000000000");
    expect(call).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/v2/sellerchat/get_conversation_list",
      query: {
        direction: "older",
        type: "all",
        page_size: 25,
        next_timestamp_nano: "1795770000000000000",
      },
    });
    expect(res.nextTimestampNano).toBe("1795767878627107788");
    expect(res.more).toBe(true);
  });

  it("collects new messages oldest-first and stops at known IDs", async () => {
    const call = vi.fn<SpCall>(async () => ({
      messages: [
        { message_id: "m3", created_timestamp: 1795774951 },
        { message_id: "m2", created_timestamp: 1795774891 },
        { message_id: "m1", created_timestamp: 1795774800 },
      ],
      page_result: { next_offset: "m1" },
    }));
    const out = await collectNewShopeeMessages(call, "678159612343515082", {
      knownIds: new Set(["m2"]),
      since: null,
      maxPages: 3,
    });
    expect(out.map((m) => m.message_id)).toEqual(["m3"]);
    expect(await listShopeeMessages(call, "678159612343515082")).toMatchObject({ nextOffset: null });
  });
});

describe("Shopee chat normalization", () => {
  it("converts nanosecond, millisecond, and second timestamps accurately", () => {
    expect(spTime("1795774951207014100").toISOString()).toBe("2026-11-27T10:22:31.207Z");
    expect(spTime(1795774951000).toISOString()).toBe("2026-11-27T10:22:31.000Z");
    expect(spTime(1795774951).toISOString()).toBe("2026-11-27T10:22:31.000Z");
  });

  it("normalizes conversation metadata", () => {
    const c = normalizeShopeeConversation({
      conversation_id: "678159612343515082",
      to_name: "anitabravo",
      to_avatar: "https://cf.shopee.ph/file/abc",
      unread_count: 2,
      last_message_timestamp: 1795774951207014100,
    });
    expect(c).toEqual({
      externalId: "678159612343515082",
      buyerName: "anitabravo",
      buyerAvatarUrl: "https://cf.shopee.ph/file/abc",
      lastMessageAt: new Date("2026-11-27T10:22:31.207Z"),
      unreadCount: 2,
      canReply: true,
    });
  });

  it("normalizes buyer text, seller replies, bot auto-replies, photos, order/product cards, and system notices", () => {
    const shopId = "180383119";

    const buyerText = normalizeShopeeMessage(
      {
        message_id: "m1",
        message_type: "text",
        from_shop_id: 157894345,
        to_shop_id: 180383119,
        created_timestamp: 1795774891,
        content: { text: "Available pa po?" },
        source: "ios",
        source_content: { order_sn: "261127CSFB14SC" },
      },
      shopId
    );
    expect(buyerText).toMatchObject({
      sender: "BUYER",
      kind: "TEXT",
      text: "Available pa po?",
      orderSn: "261127CSFB14SC",
    });

    const sellerReply = normalizeShopeeMessage(
      {
        message_id: "m2",
        message_type: "text",
        from_shop_id: 180383119,
        created_timestamp: 1795774951,
        content: { text: "Yes po!" },
        source: "openapi",
      },
      shopId
    );
    expect(sellerReply).toMatchObject({ sender: "SELLER", kind: "TEXT", text: "Yes po!" });

    const serverAuto = normalizeShopeeMessage(
      {
        message_id: "m3",
        message_type: "text",
        from_shop_id: 180383119,
        created_timestamp: 1795774891,
        content: { text: "Thanks for messaging!" },
        source: "server",
      },
      shopId
    );
    expect(serverAuto).toMatchObject({ sender: "ROBOT", kind: "TEXT" });

    const imageWithText = normalizeShopeeMessage(
      {
        message_id: "m4",
        message_type: "image_with_text",
        from_shop_id: 999,
        created_timestamp: 1795774891,
        content: { image_url: "https://cf.shopee.ph/img.jpg", text: "This one po" },
      },
      shopId
    );
    expect(imageWithText).toMatchObject({
      sender: "BUYER",
      kind: "IMAGE",
      imageUrl: "https://cf.shopee.ph/img.jpg",
      text: "This one po",
    });

    const orderCard = normalizeShopeeMessage(
      {
        message_id: "m5",
        message_type: "order",
        from_shop_id: 999,
        created_timestamp: 1795774891,
        content: { order_sn: "261127ORDER1" },
      },
      shopId
    );
    expect(orderCard).toMatchObject({ kind: "ORDER_CARD", orderSn: "261127ORDER1" });

    const itemCard = normalizeShopeeMessage(
      {
        message_id: "m6",
        message_type: "variation_card",
        from_shop_id: 999,
        created_timestamp: 1795774891,
        content: { item_id: 12345678 },
      },
      shopId
    );
    expect(itemCard).toMatchObject({ kind: "PRODUCT_CARD", productId: "12345678" });

    const notice = normalizeShopeeMessage(
      {
        message_id: "m7",
        message_type: "notification",
        from_shop_id: 180383119,
        created_timestamp: 1795774891,
        content: { notification_for_sender: "Buyer confirmed receipt" },
        source: "server",
      },
      shopId
    );
    expect(notice).toMatchObject({ sender: "SYSTEM", kind: "TEXT", text: "Buyer confirmed receipt" });
  });

  it("enables live chat, sending, photos, and chatSourceFor for Shopee", () => {
    const shopee = { isDemo: false, platform: "SHOPEE", accessToken: "t", chatAccessAt: new Date() };
    expect(isChatLive(shopee)).toBe(true);
    expect(canSendFrom(shopee, "c1", "all")).toBe(true);
    expect(canSendFrom(shopee, "c1", "off")).toBe(false);
    expect(canSendPhotosFrom(shopee)).toBe(true);
    expect(chatSourceFor(shopee)).toBeDefined();
    expect(isTemporaryShopeeChatError(new Error("system busy"))).toBe(true);
  });
});
