import { describe, expect, it } from "vitest";
import { buildDemoChats } from "@/lib/demo-chats";
import { sampleOrderSchema } from "@/lib/chats/order-panel";

const NOW = new Date("2026-11-24T02:00:00Z");

describe("buildDemoChats", () => {
  it("gives both shops a handful of sample chats with an order card each", () => {
    for (const platform of ["SHOPEE", "TIKTOK"] as const) {
      const chats = buildDemoChats(platform, NOW);
      expect(chats.length).toBeGreaterThanOrEqual(5);
      for (const c of chats) {
        expect(sampleOrderSchema.safeParse(c.sampleOrder).success, c.externalId).toBe(true);
        expect(c.messages.length).toBeGreaterThan(0);
        expect(c.lastMessageAt).toEqual(c.messages[c.messages.length - 1].sentAt);
      }
      expect(chats.some((c) => c.unreadCount > 0)).toBe(true);
      expect(chats.some((c) => c.unreadCount === 0)).toBe(true);
      expect(chats.some((c) => c.messages.some((m) => m.kind === "IMAGE"))).toBe(true);
    }
  });

  it("uses the same ids every run, so refreshing replaces instead of duplicating", () => {
    const ids = (d: Date) =>
      buildDemoChats("TIKTOK", d).flatMap((c) => [c.externalId, ...c.messages.map((m) => m.externalId)]);
    const first = ids(NOW);
    expect(ids(new Date(NOW.getTime() + 3600_000))).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
    // Shopee and TikTok sample ids never collide.
    const shopee = buildDemoChats("SHOPEE", NOW).map((c) => c.externalId);
    expect(shopee.some((id) => first.includes(id))).toBe(false);
  });

  it("keeps messages in time order within each chat", () => {
    for (const c of buildDemoChats("SHOPEE", NOW)) {
      const times = c.messages.map((m) => m.sentAt.getTime());
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(times.every((t) => t <= NOW.getTime())).toBe(true);
    }
  });
});
