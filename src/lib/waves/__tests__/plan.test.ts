import { Platform } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  groupPickItems,
  matchParcelsForVariant,
  parsePickItemLabel,
  pickListPages,
  planWave,
  shipBlocker,
  shortenGarmentName,
  summarizeWave,
  type WaveCandidate,
  type WaveParcel,
} from "@/lib/waves/plan";
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

  it("separates multiple courier/shop groups with a divider line", () => {
    const multiGroup = planWave([
      cand("s1", { platform: Platform.SHOPEE, carrier: "SPX Express", channelId: "spx" }),
      cand("t1", { platform: Platform.TIKTOK, carrier: "J&T Express", channelId: "jt" }),
    ]);
    const pages = pickListPages(summarizeWave(multiGroup, skipped), now);
    expect(pages[0]).toContain("--------------------------------------------");
  });

  it("shortens long SEO garment names in 4x6 pick lists so variations stay visible", () => {
    const seoPlanned = planWave([
      cand("s1", {
        lines: [
          {
            key: "jb-emerald",
            label:
              "Kyna PH Jacquard Brocade Skorts for Women High Waist A-Line Mini Skirt with Elastic Waist Comfortable and Casual Summer Wear Machine Washable Basic Style Sleeveless Comfy Short Lingerie - JB Emerald, 2XL (39-42)",
            quantity: 1,
          },
          {
            key: "floral-38",
            label:
              "Women’s Casual Floral Skort Summer with inner short A-Line Mini Skirt Shorts - Print 38, XL (30-40)",
            quantity: 3,
          },
        ],
      }),
    ]);
    const pages = pickListPages(summarizeWave(seoPlanned, skipped), now);
    expect(pages.flat().every((l) => l.length <= 44)).toBe(true);
    expect(pages[0].some((l) => l.includes("Jacquard Brocade Skorts - JB"))).toBe(true);
    expect(pages[0].some((l) => l.includes("3 x Casual Floral Skort - Print 38"))).toBe(true);
  });
});

describe("pick list readability helpers", () => {
  const SCREENSHOT_LABELS = [
    {
      label:
        "Kyna Palda Short Corduroy Korean Inspired Skort for Women - Trendy and Comfortable Bottoms for Daily Wear - Blouse - Taupe, Medium 26-30",
      qty: 1,
    },
    {
      label:
        "Kyna PH Jacquard Brocade Skorts for Women High Waist A-Line Mini Skirt with Elastic Waist Comfortable and Casual Summer Wear Machine Washable Basic Style Sleeveless Comfy Short Lingerie - JB Emerald, 2XL (39-42)",
      qty: 1,
    },
    {
      label:
        "Kyna PH Jacquard Brocade Skorts for Women High Waist A-Line Mini Skirt with Elastic Waist Comfortable and Casual Summer Wear Machine Washable Basic Style Sleeveless Comfy Short Lingerie - JB Maroon, 2XL (39-42)",
      qty: 1,
    },
    {
      label:
        "Kyna Top Skirt Coords - Floral Print, Short Sleeve, Round Neck, Casual Style, Perfect for Daily Wear - RB olive stripe, M (27-32)",
      qty: 1,
    },
    {
      label:
        "Kyna Top Skirt Coords - Floral Print, Short Sleeve, Round Neck, Casual Style, Perfect for Daily Wear - RB Print 3, M (27-32)",
      qty: 1,
    },
    {
      label:
        "Women’s Casual Floral Skort Summer with inner short A-Line Mini Skirt Shorts - Print 38, XL (30-40)",
      qty: 3,
    },
    {
      label:
        "Women’s Casual Floral Skort Summer with inner short A-Line Mini Skirt Shorts - print 7, XL (30-40)",
      qty: 1,
    },
  ];

  it("strips SEO filler and brand prefixes in shortenGarmentName", () => {
    expect(
      shortenGarmentName(
        "Kyna Palda Short Corduroy Korean Inspired Skort for Women - Trendy and Comfortable Bottoms for Daily Wear"
      )
    ).toBe("Palda Short Corduroy Skort");
    expect(
      shortenGarmentName(
        "Kyna PH Jacquard Brocade Skorts for Women High Waist A-Line Mini Skirt with Elastic Waist Comfortable and Casual Summer Wear Machine Washable Basic Style Sleeveless Comfy Short Lingerie"
      )
    ).toBe("Jacquard Brocade Skorts");
    expect(
      shortenGarmentName(
        "Kyna Top Skirt Coords - Floral Print, Short Sleeve, Round Neck, Casual Style, Perfect for Daily Wear"
      )
    ).toBe("Top Skirt Coords");
    expect(
      shortenGarmentName("Women’s Casual Floral Skort Summer with inner short A-Line Mini Skirt Shorts")
    ).toBe("Casual Floral Skort");
    expect(shortenGarmentName("[COD] Kyna PH - Ribbed Cotton Top (Ready Stock)")).toBe("Ribbed Cotton Top");
    expect(shortenGarmentName("Top")).toBe("Top");
  });

  it("parses colour, size, and short qualifiers cleanly in parsePickItemLabel", () => {
    expect(parsePickItemLabel(SCREENSHOT_LABELS[0].label)).toMatchObject({
      shortGarmentName: "Palda Short Corduroy Skort",
      variation: "Blouse - Taupe, Medium 26-30",
      color: "Blouse - Taupe",
      size: "Medium 26-30",
    });
    expect(parsePickItemLabel(SCREENSHOT_LABELS[1].label)).toMatchObject({
      shortGarmentName: "Jacquard Brocade Skorts",
      variation: "JB Emerald, 2XL (39-42)",
      color: "JB Emerald",
      size: "2XL (39-42)",
    });
    expect(parsePickItemLabel(SCREENSHOT_LABELS[3].label)).toMatchObject({
      shortGarmentName: "Top Skirt Coords",
      variation: "RB olive stripe, M (27-32)",
      color: "RB olive stripe",
      size: "M (27-32)",
    });
    expect(parsePickItemLabel(SCREENSHOT_LABELS[5].label)).toMatchObject({
      shortGarmentName: "Casual Floral Skort",
      variation: "Print 38, XL (30-40)",
      color: "Print 38",
      size: "XL (30-40)",
    });
    expect(
      parsePickItemLabel(
        "Kyna Top Skirt Coords - Floral Print, Short Sleeve, Round Neck, Casual Style, Perfect for Daily Wear"
      )
    ).toMatchObject({
      shortGarmentName: "Top Skirt Coords",
      variation: null,
      color: null,
      size: null,
    });
    expect(parsePickItemLabel("Ribbed Top - Free size")).toMatchObject({
      shortGarmentName: "Ribbed Top",
      variation: "Free size",
      color: "Free size",
      size: null,
    });
  });

  it("groups repeated variations under one garment header in first-appearance order", () => {
    const grouped = groupPickItems(SCREENSHOT_LABELS);
    expect(grouped.map((g) => ({ shortName: g.shortName, totalQty: g.totalQty, count: g.variants.length }))).toEqual([
      { shortName: "Palda Short Corduroy Skort", totalQty: 1, count: 1 },
      { shortName: "Jacquard Brocade Skorts", totalQty: 2, count: 2 },
      { shortName: "Top Skirt Coords", totalQty: 2, count: 2 },
      { shortName: "Casual Floral Skort", totalQty: 4, count: 2 },
    ]);
    expect(grouped[3].variants).toEqual([
      {
        label: SCREENSHOT_LABELS[5].label,
        variation: "Print 38, XL (30-40)",
        color: "Print 38",
        size: "XL (30-40)",
        qty: 3,
      },
      {
        label: SCREENSHOT_LABELS[6].label,
        variation: "print 7, XL (30-40)",
        color: "print 7",
        size: "XL (30-40)",
        qty: 1,
      },
    ]);
  });

  it("matches parcels for a pick-list variant within the same group in print order", () => {
    const makeParcel = (
      id: string,
      position: number,
      groupKey: string,
      labels: Array<{ label: string; qty?: number }>
    ): WaveParcel => ({
      id,
      packageId: `pkg-${id}`,
      orderId: `ord-${id}`,
      orderSn: `SN-${id}`,
      platform: "TIKTOK",
      shopName: "Kyna TikTok",
      groupKey,
      position,
      totalInWave: 4,
      status: "READY",
      orderStatus: "AWAITING_SHIPMENT",
      error: null,
      courier: "J&T Express",
      trackingNumber: null,
      packageNumber: `P-${id}`,
      isCod: true,
      totalPhp: 299,
      createdAt: "2026-11-21T02:00:00.000Z",
      shippedAt: null,
      totalPieces: labels.reduce((s, l) => s + (l.qty ?? 1), 0),
      lines: labels.map((l, idx) => ({
        id: `${id}-l${idx}`,
        key: `${id}-k${idx}`,
        label: l.label,
        name: l.label,
        shortName: l.label,
        variationName: null,
        color: null,
        size: null,
        imageUrl: null,
        quantity: l.qty ?? 1,
        unitPricePhp: 299,
      })),
    });

    const parcels: WaveParcel[] = [
      makeParcel("p3", 3, "TIKTOK|jt", [
        { label: "Palda Short Corduroy Skort - Blouse - Maroon, Medium 27-31 waist", qty: 1 },
        { label: "Jacquard Brocade Skorts - JB Black, XL (35-38)", qty: 1 },
      ]),
      makeParcel("p1", 1, "TIKTOK|jt", [
        { label: "Palda Short Corduroy Skort - Blouse - Maroon, Medium 27-31 waist", qty: 1 },
      ]),
      makeParcel("p2", 2, "SHOPEE|spx", [
        { label: "Palda Short Corduroy Skort - Blouse - Maroon, Medium 27-31 waist", qty: 1 },
      ]),
      makeParcel("p4", 4, "TIKTOK|jt", [
        { label: "Jacquard Brocade Skorts - JB Black, XL (35-38)", qty: 2 },
      ]),
    ];

    // Exact match within groupKey, sorted ascending by position, excluding other groups.
    const maroonMatches = matchParcelsForVariant(
      parcels,
      "TIKTOK|jt",
      "Palda Short Corduroy Skort - Blouse - Maroon, Medium 27-31 waist"
    );
    expect(maroonMatches.map((p) => p.id)).toEqual(["p1", "p3"]);

    // Multi-item parcel p3 is matched for both of its items.
    const jbMatches = matchParcelsForVariant(
      parcels,
      "TIKTOK|jt",
      "Jacquard Brocade Skorts - JB Black, XL (35-38)"
    );
    expect(jbMatches.map((p) => p.id)).toEqual(["p3", "p4"]);

    // Fallback normalized matching (e.g. if listing prefix changed after preview snapshot).
    const fallbackMatches = matchParcelsForVariant(
      parcels,
      "TIKTOK|jt",
      "Kyna PH Jacquard Brocade Skorts for Women High Waist - JB Black, XL (35-38)"
    );
    expect(fallbackMatches.map((p) => p.id)).toEqual(["p3", "p4"]);
  });
});
