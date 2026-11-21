import { Platform } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { pickListPages, planWave, shipBlocker, summarizeWave, type WaveCandidate } from "@/lib/waves/plan";
import { mapShopeeOrder, mapTikTokOrder } from "@/lib/ledger/normalize";

const now = new Date("2026-11-21T02:00:00Z");
const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000);

const order = (over: Partial<Parameters<typeof shipBlocker>[0]> = {}) => ({
  platform: Platform.SHOPEE,
  status: "READY_TO_SHIP",
  cancelRequested: false,
  platformCreatedAt: twoHoursAgo,
  packageCount: 1,
  ...over,
});
const pkg = (over: Partial<Parameters<typeof shipBlocker>[1]> = {}) => ({
  status: "LOGISTICS_READY",
  trackingNumber: null,
  inActiveWave: false,
  ...over,
});

describe("shipBlocker", () => {
  it("ships ready orders older than 1 hour", () => {
    expect(shipBlocker(order(), pkg(), now)).toBeNull();
    expect(shipBlocker(order({ platform: Platform.TIKTOK, status: "AWAITING_SHIPMENT" }), pkg({ status: "TO_FULFILL" }), now)).toBeNull();
    expect(shipBlocker(order(), pkg({ status: null }), now)).toBeNull();
  });

  it("never ships cancelled or cancel-requested orders", () => {
    expect(shipBlocker(order({ cancelRequested: true }), pkg(), now)).toBe("cancelled");
    expect(shipBlocker(order({ status: "IN_CANCEL" }), pkg(), now)).toBe("cancelled");
    expect(shipBlocker(order({ status: "CANCELLED" }), pkg(), now)).toBe("cancelled");
  });

  it("waits an hour after the order was placed", () => {
    expect(shipBlocker(order({ platformCreatedAt: new Date(now.getTime() - 59 * 60_000) }), pkg(), now)).toBe("tooNew");
  });

  it("skips already-arranged, split and in-another-wave packages", () => {
    expect(shipBlocker(order({ status: "PROCESSED" }), pkg(), now)).toBe("notReady");
    expect(shipBlocker(order(), pkg({ status: "LOGISTICS_REQUEST_CREATED" }), now)).toBe("notReady");
    expect(shipBlocker(order({ packageCount: 2 }), pkg(), now)).toBe("split");
    expect(shipBlocker(order(), pkg({ inActiveWave: true }), now)).toBe("alreadyInWave");
  });
});

describe("cancel requests are read from both shops", () => {
  it("Shopee IN_CANCEL and TikTok is_buyer_request_cancel", () => {
    expect(mapShopeeOrder({ order_sn: "A", order_status: "IN_CANCEL" }).cancelRequested).toBe(true);
    expect(mapShopeeOrder({ order_sn: "A", order_status: "READY_TO_SHIP" }).cancelRequested).toBe(false);
    expect(mapTikTokOrder({ id: "1", status: "AWAITING_SHIPMENT", is_buyer_request_cancel: true }).cancelRequested).toBe(true);
  });
});

const cand = (sn: string, over: Partial<WaveCandidate> = {}): WaveCandidate => ({
  packageId: `pkg-${sn}`,
  orderId: `o-${sn}`,
  orderSn: sn,
  platform: Platform.SHOPEE,
  carrier: "SPX Express",
  channelId: "48002",
  createdAt: twoHoursAgo,
  lines: [{ key: "top-black-m", label: "Ribbed Top - Black, M", quantity: 1 }],
  ...over,
});

describe("planWave", () => {
  it("orders by shop, courier, singles first, then item", () => {
    const planned = planWave([
      cand("tt1", { platform: Platform.TIKTOK, carrier: "J&T Express", channelId: "tt-jt" }),
      cand("multi", { lines: [{ key: "a", label: "Ribbed Top - Black, M", quantity: 2 }] }),
      cand("pants", { lines: [{ key: "p", label: "Wide Leg Pants - Beige, L", quantity: 1 }] }),
      cand("top", {}),
      cand("jt", { carrier: "J&T Express", channelId: "48006" }),
    ]);
    expect(planned.map((p) => p.orderSn)).toEqual(["jt", "top", "pants", "multi", "tt1"]);
    expect(planned.map((p) => p.position)).toEqual([0, 1, 2, 3, 4]);
    expect(planned[1]).toMatchObject({ groupKey: "SHOPEE|48002", groupTitle: "Shopee · SPX Express", single: true, pieces: 1 });
    expect(planned[3]).toMatchObject({ single: false, pieces: 2 });
  });

  it("keeps the same item together across orders", () => {
    const planned = planWave([
      cand("b1", { lines: [{ key: "b", label: "B item", quantity: 1 }] }),
      cand("a1", { lines: [{ key: "a", label: "A item", quantity: 1 }] }),
      cand("b2", { lines: [{ key: "b", label: "B item", quantity: 1 }] }),
    ]);
    expect(planned.map((p) => p.orderSn)).toEqual(["a1", "b1", "b2"]);
  });
});

describe("summary and pick list", () => {
  const planned = planWave([
    cand("1"),
    cand("2"),
    cand("3", { lines: [{ key: "p", label: "Wide Leg Pants - Beige, L", quantity: 1 }, { key: "top-black-m", label: "Ribbed Top - Black, M", quantity: 1 }] }),
  ]);
  const skipped = { tooNew: 4, cancelled: 1, notReady: 0, split: 0, alreadyInWave: 0, notRechecked: 0 };

  it("totals pieces per item per courier group", () => {
    const s = summarizeWave(planned, skipped);
    expect(s).toMatchObject({ total: 3, singles: 2, multis: 1 });
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].items).toEqual([
      { label: "Ribbed Top - Black, M", qty: 3 },
      { label: "Wide Leg Pants - Beige, L", qty: 1 },
    ]);
  });

  it("lays the pick list out on numbered 4x6 pages", () => {
    const pages = pickListPages(summarizeWave(planned, skipped), now);
    expect(pages).toHaveLength(1);
    expect(pages[0][0]).toBe("Page 1/1");
    expect(pages[0]).toContain("  3 x Ribbed Top - Black, M");
    expect(pages[0].some((l) => l.startsWith("SHOPEE · SPX EXPRESS (3 parcels)"))).toBe(true);
  });

  it("splits long lists over pages and shortens long names", () => {
    const many = planWave(
      Array.from({ length: 60 }, (_, i) =>
        cand(`o${i}`, { lines: [{ key: `k${i}`, label: `Item ${String(i).padStart(2, "0")} with a really long garment name here`, quantity: 1 }] })
      )
    );
    const pages = pickListPages(summarizeWave(many, skipped), now);
    expect(pages.length).toBe(3);
    expect(pages.every((p) => p.length <= 25)).toBe(true);
    expect(pages.flat().every((l) => l.length <= 44)).toBe(true);
    expect(pages[2][0]).toBe("Page 3/3");
  });
});
