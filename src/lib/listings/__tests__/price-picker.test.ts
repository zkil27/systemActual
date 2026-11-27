import { describe, expect, it } from "vitest";
import { buildPriceVariantOptions } from "@/lib/listings/price-picker";
import type { UnifiedListingItemDto } from "@/lib/listings/service";

function makeItem(overrides?: Partial<UnifiedListingItemDto>): UnifiedListingItemDto {
  return {
    garmentId: "g1",
    garmentName: "High Waist Skort",
    imageUrl: null,
    sellingPricePhp: 199,
    hasPriceMismatch: true,
    totalOnShelf: 24,
    sourceProducts: [],
    publishes: [],
    variants: [
      {
        id: "v1",
        label: "Hera #1, 2XL (37-40)",
        onShelfCount: 10,
        listings: [
          {
            listingVariantId: "lv1",
            shopConnectionId: "s1",
            shopName: "Kyna TikTok",
            platform: "TIKTOK",
            listingId: "l1",
            variationId: "var1",
            variationName: "Hera #1, 2XL",
            pricePhp: 199,
            pricePushedPhp: 199,
            pricePushedAt: null,
            pricePushError: null,
            channelProduct: null,
          },
        ],
      },
      {
        id: "v2",
        label: "Hera #10, M (26-29)",
        onShelfCount: 14,
        listings: [
          {
            listingVariantId: "lv2",
            shopConnectionId: "s1",
            shopName: "Kyna TikTok",
            platform: "TIKTOK",
            listingId: "l1",
            variationId: "var2",
            variationName: "Hera #10, M",
            pricePhp: 199.5,
            pricePushedPhp: null,
            pricePushedAt: null,
            pricePushError: null,
            channelProduct: null,
          },
          {
            listingVariantId: "lv3",
            shopConnectionId: "s2",
            shopName: "Kyna Shopee",
            platform: "SHOPEE",
            listingId: "l2",
            variationId: "var3",
            variationName: "Hera #10, M",
            pricePhp: 215,
            pricePushedPhp: null,
            pricePushedAt: null,
            pricePushError: null,
            channelProduct: null,
          },
        ],
      },
      {
        id: "v3",
        label: "Hera #12, S",
        onShelfCount: 0,
        listings: [],
      },
    ],
    ...overrides,
  };
}

describe("buildPriceVariantOptions", () => {
  it("builds a pinned all-variants option with price range and per-variant options", () => {
    const options = buildPriceVariantOptions(makeItem());
    expect(options).toHaveLength(4);

    expect(options[0]).toMatchObject({
      value: "",
      label: "All sizes & colours",
      description: "3 variants",
      trailing: "₱199–₱215",
      pinned: true,
    });

    expect(options[1]).toMatchObject({
      value: "v1",
      label: "Hera #1, 2XL (37-40)",
      description: "TikTok · 10 on shelf",
      trailing: "₱199",
    });

    expect(options[2]).toMatchObject({
      value: "v2",
      label: "Hera #10, M (26-29)",
      description: "TikTok, Shopee (2 listings) · 14 on shelf",
      trailing: "₱199.50 / ₱215",
    });

    expect(options[3]).toMatchObject({
      value: "v3",
      label: "Hera #12, S",
      description: "No linked listing · 0 on shelf",
      trailing: "No price",
    });
  });

  it("falls back to garment sellingPricePhp when listings have no synced price", () => {
    const options = buildPriceVariantOptions(
      makeItem({
        sellingPricePhp: 185,
        variants: [
          { id: "v1", label: "Black M", onShelfCount: 5, listings: [] },
        ],
      })
    );
    expect(options[0].description).toBe("1 variant");
    expect(options[0].trailing).toBe("₱185");
  });
});
