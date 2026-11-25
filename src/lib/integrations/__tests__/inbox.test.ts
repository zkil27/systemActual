import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "@prisma/client";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    integrationEvent: {
      createMany: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  EVENT_CLAIM_TIMEOUT_MS,
  MAX_EVENT_ATTEMPTS,
  eventFields,
  eventKey,
  isClaimable,
  processEvent,
  storeEvent,
} from "../inbox";

describe("eventKey", () => {
  it("uses TikTok's notification id, so a resend with a new timestamp is still a duplicate", () => {
    expect(eventKey(Platform.TIKTOK, { tts_notification_id: "7327" }, "a")).toBe("tiktok:n:7327");
    expect(eventKey(Platform.TIKTOK, { tts_notification_id: "7327" }, "b")).toBe("tiktok:n:7327");
  });

  it("hashes the exact body otherwise", () => {
    const a = eventKey(Platform.SHOPEE, {}, '{"code":3}');
    expect(a).toMatch(/^shopee:h:[0-9a-f]{64}$/);
    expect(eventKey(Platform.SHOPEE, {}, '{"code":3}')).toBe(a);
    expect(eventKey(Platform.SHOPEE, {}, '{"code":4}')).not.toBe(a);
  });
});

describe("eventFields", () => {
  it("reads a Shopee cancellation", () => {
    expect(eventFields(Platform.SHOPEE, { code: 3, shop_id: 123, data: { ordersn: "2611X", status: "in_cancel" } })).toEqual({
      eventType: "3",
      orderSn: "2611X",
      shopExternalId: "123",
      isChat: false,
      isCancel: true,
      cancelStatus: "IN_CANCEL",
    });
  });

  it("reads a TikTok order update and a TikTok chat", () => {
    expect(
      eventFields(Platform.TIKTOK, { type: 1, shop_id: "s1", data: { order_id: "577", order_status: "AWAITING_SHIPMENT" } })
    ).toMatchObject({ eventType: "1", orderSn: "577", isChat: false, isCancel: false });
    expect(eventFields(Platform.TIKTOK, { type: 13, data: { conversation_id: "c1" } })).toMatchObject({
      isChat: true,
      orderSn: null,
    });
    expect(
      eventFields(Platform.TIKTOK, { data: { order_id: "577", cancel_status: "BUYER_CANCEL_REQUEST" } })
    ).toMatchObject({ isCancel: true, cancelStatus: "BUYER_CANCEL_REQUEST" });
  });
});

describe("isClaimable", () => {
  const now = new Date("2026-11-26T00:10:00Z");
  it("takes new events and abandoned claims, never done or worn-out ones", () => {
    expect(isClaimable({ processedAt: null, claimedAt: null, attempts: 0 }, now)).toBe(true);
    expect(
      isClaimable({ processedAt: null, claimedAt: new Date(now.getTime() - EVENT_CLAIM_TIMEOUT_MS - 1), attempts: 1 }, now)
    ).toBe(true);
    expect(isClaimable({ processedAt: null, claimedAt: new Date(now.getTime() - 1000), attempts: 1 }, now)).toBe(false);
    expect(isClaimable({ processedAt: now, claimedAt: null, attempts: 1 }, now)).toBe(false);
    expect(isClaimable({ processedAt: null, claimedAt: null, attempts: MAX_EVENT_ATTEMPTS }, now)).toBe(false);
  });
});

describe("storeEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null for a push already stored", async () => {
    mockPrisma.integrationEvent.createMany.mockResolvedValue({ count: 0 });
    expect(await storeEvent(Platform.SHOPEE, { code: 3 }, "{}")).toBeNull();
    expect(mockPrisma.integrationEvent.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it("returns the new id", async () => {
    mockPrisma.integrationEvent.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.integrationEvent.findUnique.mockResolvedValue({ id: "e1" });
    expect(await storeEvent(Platform.SHOPEE, { code: 3 }, "{}")).toBe("e1");
  });
});

describe("processEvent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when another function holds the event", async () => {
    mockPrisma.integrationEvent.updateMany.mockResolvedValue({ count: 0 });
    const handler = vi.fn();
    expect(await processEvent("e1", handler)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it("marks the event done after the handler succeeds", async () => {
    mockPrisma.integrationEvent.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.integrationEvent.findUnique.mockResolvedValue({ platform: Platform.SHOPEE, payload: { data: { ordersn: "A" } } });
    mockPrisma.integrationEvent.update.mockResolvedValue({});
    const handler = vi.fn().mockResolvedValue(undefined);
    expect(await processEvent("e1", handler)).toBe(true);
    expect(handler).toHaveBeenCalledWith(Platform.SHOPEE, expect.objectContaining({ orderSn: "A" }));
    expect(mockPrisma.integrationEvent.update.mock.calls[0][0].data).toMatchObject({ error: null });
  });

  it("keeps the error and releases the claim so the tick retries", async () => {
    mockPrisma.integrationEvent.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.integrationEvent.findUnique.mockResolvedValue({ platform: Platform.TIKTOK, payload: {} });
    mockPrisma.integrationEvent.update.mockResolvedValue({});
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await processEvent("e1", vi.fn().mockRejectedValue(new Error("Shopee timeout")))).toBe(false);
    expect(mockPrisma.integrationEvent.update.mock.calls[0][0].data).toEqual({ error: "Shopee timeout", claimedAt: null });
    spy.mockRestore();
  });
});
