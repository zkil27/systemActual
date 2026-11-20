import { describe, expect, it } from "vitest";
import { mapShopeeOrder, mapTikTokOrder, shouldApplyOrderUpdate } from "@/lib/ledger/normalize";
import { nextSyncWindow, INITIAL_LOOKBACK_MS, MAX_WINDOW_MS, OVERLAP_MS } from "@/lib/ledger/window";
import {
  shopeeCancelledAfterPickup,
  shopeeCodOrder,
  tiktokCancelledAfterShip,
  tiktokTwoUnitOrder,
} from "./fixtures";

describe("mapShopeeOrder", () => {
  it("maps a COD order, merging the same model listed twice", () => {
    const o = mapShopeeOrder(shopeeCodOrder);
    expect(o).toMatchObject({
      orderSn: "251121ABCD1234",
      status: "READY_TO_SHIP",
      isCod: true,
      totalPhp: 398,
      shippedAt: null,
      cancelBy: null,
    });
    expect(o.createdAt.toISOString()).toBe(new Date(1795000000 * 1000).toISOString());
    expect(o.lines).toEqual([
      {
        listingId: "9001",
        variationId: "77",
        name: "Ribbed Top",
        variationName: "Black,M",
        imageUrl: "https://cf.shopee.ph/file/ribbed-black",
        quantity: 2,
        unitPricePhp: 199,
      },
    ]);
    expect(o.packages).toEqual([
      { packageNumber: "OFG1001", trackingNumber: null, carrier: "SPX Express", channelId: "48002", status: "LOGISTICS_READY" },
    ]);
  });

  it("keeps cancel and pickup details for failed-delivery detection", () => {
    const o = mapShopeeOrder(shopeeCancelledAfterPickup);
    expect(o.cancelBy).toBe("system");
    expect(o.cancelReason).toBe("Failed Delivery");
    expect(o.shippedAt?.getTime()).toBe(1794850000 * 1000);
    expect(o.lines[0]).toMatchObject({ variationId: "0", variationName: null });
  });
});

describe("mapTikTokOrder", () => {
  it("turns per-unit line items into one line with the right quantity", () => {
    const o = mapTikTokOrder(tiktokTwoUnitOrder);
    expect(o).toMatchObject({ orderSn: "577086512123755123", status: "AWAITING_SHIPMENT", isCod: true, totalPhp: 398 });
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0]).toMatchObject({ listingId: "1729582718312380123", variationId: "2729382476852921560", quantity: 2 });
    expect(o.packages).toEqual([
      {
        packageNumber: "1152321127278713123",
        trackingNumber: null,
        carrier: "J&T Express",
        channelId: "6617675021119438849",
        status: "TO_FULFILL",
      },
    ]);
  });

  it("reads the package tracking number and rts_time from line items", () => {
    const o = mapTikTokOrder(tiktokCancelledAfterShip);
    expect(o.cancelBy).toBe("SYSTEM");
    expect(o.shippedAt?.getTime()).toBe(1794850000 * 1000);
    expect(o.packages[0].trackingNumber).toBe("JT0012345678");
  });
});

describe("re-syncing is a no-op", () => {
  it("maps the same payload to the same result", () => {
    expect(mapShopeeOrder(shopeeCodOrder)).toEqual(mapShopeeOrder(structuredClone(shopeeCodOrder)));
    expect(mapTikTokOrder(tiktokTwoUnitOrder)).toEqual(mapTikTokOrder(structuredClone(tiktokTwoUnitOrder)));
  });

  it("ignores updates older than what's stored, accepts equal or newer", () => {
    const stored = new Date("2026-11-21T02:00:00Z");
    expect(shouldApplyOrderUpdate(stored, new Date("2026-11-21T01:59:59Z"))).toBe(false);
    expect(shouldApplyOrderUpdate(stored, stored)).toBe(true);
    expect(shouldApplyOrderUpdate(null, stored)).toBe(true);
  });
});

describe("nextSyncWindow", () => {
  const now = new Date("2026-11-21T02:00:00Z");

  it("starts 3 days back on the first sync, in 2-hour windows", () => {
    const w = nextSyncWindow(null, now);
    expect(w.from.getTime()).toBe(now.getTime() - INITIAL_LOOKBACK_MS);
    expect(w.to.getTime() - w.from.getTime()).toBe(MAX_WINDOW_MS);
    expect(w.last).toBe(false);
  });

  it("moves forward from the cursor with a small overlap", () => {
    const cursor = new Date(now.getTime() - 6 * 3600_000);
    const w = nextSyncWindow(cursor, now);
    expect(w.from.getTime()).toBe(cursor.getTime() - OVERLAP_MS);
    expect(w.to.getTime()).toBeGreaterThan(cursor.getTime());
  });

  it("stops at now and reports caught up", () => {
    const w = nextSyncWindow(new Date(now.getTime() - 60_000), now);
    expect(w.to.getTime()).toBe(now.getTime());
    expect(w.last).toBe(true);
  });

  it("always advances, so a long outage is eventually caught up", () => {
    let cursor: Date | null = new Date(now.getTime() - 20 * 3600_000);
    let windows = 0;
    for (;;) {
      const w = nextSyncWindow(cursor, now);
      expect(w.to.getTime()).toBeGreaterThan(cursor!.getTime());
      cursor = w.to;
      windows++;
      if (w.last) break;
    }
    expect(windows).toBe(11);
  });
});
