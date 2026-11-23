import { describe, expect, it } from "vitest";
import {
  chatDayLabel,
  chatListTime,
  defaultShop,
  parseShopParam,
  shopParam,
  withDaySeparators,
} from "@/lib/chats/format";

// Tue Nov 24 2026, 10:00 AM in Manila.
const NOW = new Date("2026-11-24T02:00:00.000Z");

describe("chatListTime", () => {
  it("shows the Manila clock for today", () => {
    expect(chatListTime("2026-11-24T00:14:00.000Z", NOW)).toMatch(/^8:14\s?AM$/i);
  });

  it("uses Manila day boundaries, not UTC", () => {
    // 11:30 PM Nov 23 UTC is 7:30 AM Nov 24 in Manila: still today.
    expect(chatListTime("2026-11-23T23:30:00.000Z", NOW)).toMatch(/7:30/);
    // 3:00 PM Nov 23 UTC is 11:00 PM Nov 23 in Manila: yesterday.
    expect(chatListTime("2026-11-23T15:00:00.000Z", NOW)).toBe("Yesterday");
  });

  it("shows the weekday within a week, then the date", () => {
    expect(chatListTime("2026-11-20T04:00:00.000Z", NOW)).toBe("Fri");
    expect(chatListTime("2026-06-03T04:00:00.000Z", NOW)).toBe("Jun 3");
    expect(chatListTime("2025-06-03T04:00:00.000Z", NOW)).toBe("Jun 3, 2025");
  });

  it("returns blank for bad input", () => {
    expect(chatListTime("not a date", NOW)).toBe("");
  });
});

describe("withDaySeparators", () => {
  it("adds one separator per Manila day", () => {
    const rows = withDaySeparators(
      [
        { id: "a", sentAt: "2026-11-23T10:00:00.000Z" }, // Nov 23, 6 PM Manila
        { id: "b", sentAt: "2026-11-23T15:59:00.000Z" }, // Nov 23, 11:59 PM Manila
        { id: "c", sentAt: "2026-11-23T16:01:00.000Z" }, // Nov 24, 12:01 AM Manila
      ],
      NOW
    );
    expect(rows.map((r) => (r.type === "day" ? `day:${r.label}` : r.message.id))).toEqual([
      "day:Yesterday",
      "a",
      "b",
      "day:Today",
      "c",
    ]);
  });

  it("labels older days with the weekday and date", () => {
    expect(chatDayLabel("2026-11-18T04:00:00.000Z", NOW)).toBe("Wed, Nov 18");
  });
});

describe("shop param", () => {
  it("parses and writes the URL value", () => {
    expect(parseShopParam("shopee")).toBe("SHOPEE");
    expect(parseShopParam("TikTok")).toBe("TIKTOK");
    expect(parseShopParam("lazada")).toBeNull();
    expect(parseShopParam(null)).toBeNull();
    expect(shopParam("SHOPEE")).toBe("shopee");
    expect(shopParam("TIKTOK")).toBe("tiktok");
  });

  it("opens the shop with more unread chats, TikTok on a tie", () => {
    expect(defaultShop({ SHOPEE: 3, TIKTOK: 1 })).toBe("SHOPEE");
    expect(defaultShop({ SHOPEE: 1, TIKTOK: 3 })).toBe("TIKTOK");
    expect(defaultShop({ SHOPEE: 0, TIKTOK: 0 })).toBe("TIKTOK");
    expect(defaultShop(null)).toBe("TIKTOK");
  });
});
