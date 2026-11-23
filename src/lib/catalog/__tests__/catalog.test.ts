import { Platform } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  computeStartingStock,
  findCrossShopTitleMatches,
  normalizeGarmentTitle,
  normalizeVariationLabel,
  pairVariations,
  shopeeModelLabel,
} from "@/lib/catalog/variants";
import { mapShopeeItem, mapTikTokProduct } from "@/lib/catalog/import-map";

describe("variation labels", () => {
  it("treats Shopee and TikTok spellings of the same size/colour as equal", () => {
    expect(normalizeVariationLabel("Black,M")).toBe(normalizeVariationLabel("Black, M"));
    expect(normalizeVariationLabel("M / Black")).toBe(normalizeVariationLabel("black m"));
    expect(normalizeVariationLabel("BLK, Medium")).toBe(normalizeVariationLabel("Black, M"));
    expect(normalizeVariationLabel("Freesize")).toBe(normalizeVariationLabel("FS"));
    expect(normalizeVariationLabel("Black,M")).not.toBe(normalizeVariationLabel("Black,L"));
    expect(normalizeVariationLabel(null)).toBe("");
  });

  it("normalizes titles and finds 1-to-1 Shopee ↔ TikTok twin listings", () => {
    expect(normalizeGarmentTitle("[COD] Korean Ribbed Cotton Baby Tee (Ready Stock)")).toBe("ribbed cotton baby tee");
    const matches = findCrossShopTitleMatches([
      {
        id: "g1",
        name: "[Ready Stock] Ribbed Cotton Baby Tee",
        platforms: [Platform.SHOPEE],
        listingKey: { shopConnectionId: "s1", listingId: "1001" },
      },
      {
        id: "g2",
        name: "Kyna Ribbed Cotton Baby Tee COD",
        platforms: [Platform.TIKTOK],
        listingKey: { shopConnectionId: "s2", listingId: "2001" },
      },
      {
        id: "g3",
        name: "Duplicate Skirt",
        platforms: [Platform.SHOPEE],
        listingKey: { shopConnectionId: "s1", listingId: "1002" },
      },
      {
        id: "g4",
        name: "Duplicate Skirt",
        platforms: [Platform.SHOPEE],
        listingKey: { shopConnectionId: "s1", listingId: "1003" },
      },
      {
        id: "g5",
        name: "Duplicate Skirt",
        platforms: [Platform.TIKTOK],
        listingKey: { shopConnectionId: "s2", listingId: "2002" },
      },
    ]);
    expect(matches).toEqual([
      {
        shopee: { shopConnectionId: "s1", listingId: "1001" },
        tiktok: { shopConnectionId: "s2", listingId: "2001" },
        normalizedTitle: "ribbed cotton baby tee",
      },
    ]);
  });

  it("builds a Shopee model name from its tier options", () => {
    const tiers = [{ option_list: [{ option: "Black" }, { option: "Beige" }] }, { option_list: [{ option: "S" }, { option: "M" }] }];
    expect(shopeeModelLabel(tiers, [1, 0])).toBe("Beige,S");
    expect(shopeeModelLabel(undefined, [0])).toBeNull();
  });
});

describe("pairVariations", () => {
  it("pairs matching sizes/colours and leaves the rest for the owner", () => {
    const res = pairVariations(
      [{ id: "s1", label: "Black,M" }, { id: "s2", label: "Black,L" }, { id: "s3", label: "Free size" }],
      [{ id: "t1", label: "Black, M" }, { id: "t2", label: "Black, L" }, { id: "t3", label: "One Size" }]
    );
    expect(res.pairs).toEqual([["s1", "t1"], ["s2", "t2"]]);
    expect(res.leftoverA.map((v) => v.id)).toEqual(["s3"]);
    expect(res.leftoverB.map((v) => v.id)).toEqual(["t3"]);
  });

  it("never auto-pairs an ambiguous label", () => {
    const res = pairVariations(
      [{ id: "s1", label: "Black" }, { id: "s2", label: "black" }],
      [{ id: "t1", label: "Black" }]
    );
    expect(res.pairs).toEqual([]);
  });
});

describe("computeStartingStock", () => {
  it("adds back pieces on unshipped orders (both shops showed the same synced number)", () => {
    const v = computeStartingStock(
      [
        { platform: Platform.SHOPEE, availableStock: 18 },
        { platform: Platform.TIKTOK, availableStock: 18 },
      ],
      4
    );
    expect(v).toEqual({ byPlatform: { SHOPEE: 22, TIKTOK: 22 }, suggested: 22, conflict: false });
  });

  it("flags shops that disagree and suggests the lower number", () => {
    const v = computeStartingStock(
      [
        { platform: Platform.SHOPEE, availableStock: 20 },
        { platform: Platform.TIKTOK, availableStock: 17 },
      ],
      3
    );
    expect(v.conflict).toBe(true);
    expect(v.suggested).toBe(20);
    expect(v.byPlatform).toEqual({ SHOPEE: 23, TIKTOK: 20 });
  });

  it("works for an item sold on one shop only, and when no stock was read yet", () => {
    expect(computeStartingStock([{ platform: Platform.SHOPEE, availableStock: 5 }], 0).suggested).toBe(5);
    expect(computeStartingStock([{ platform: Platform.SHOPEE, availableStock: null }], 2)).toEqual({
      byPlatform: {},
      suggested: null,
      conflict: false,
    });
  });
});

describe("stock import mapping", () => {
  it("Shopee item with variations: one row per model, unavailable models skipped", () => {
    const rows = mapShopeeItem(
      { item_id: 9001, item_name: "Ribbed Top", has_model: true, image: { image_url_list: ["https://cf.shopee.ph/file/main"] } },
      {
        tier_variation: [
          { option_list: [{ option: "Black", image: { image_url: "https://cf.shopee.ph/file/black" } }, { option: "Beige" }] },
          { option_list: [{ option: "M" }, { option: "L" }] },
        ],
        model: [
          { model_id: 77, tier_index: [0, 0], stock_info_v2: { summary_info: { total_available_stock: 12 } } },
          { model_id: 78, tier_index: [1, 1], stock_info_v2: { summary_info: { total_available_stock: 0 } } },
          { model_id: 79, tier_index: [1, 0], model_status: "MODEL_UNAVAILABLE" },
        ],
      }
    );
    expect(rows).toEqual([
      { listingId: "9001", variationId: "77", name: "Ribbed Top", variationName: "Black,M", imageUrl: "https://cf.shopee.ph/file/black", availableStock: 12, warehouseId: null },
      { listingId: "9001", variationId: "78", name: "Ribbed Top", variationName: "Beige,L", imageUrl: "https://cf.shopee.ph/file/main", availableStock: 0, warehouseId: null },
    ]);
  });

  it("Shopee item without variations uses model 0, like order lines", () => {
    const rows = mapShopeeItem(
      { item_id: 9002, item_name: "Tote Bag", has_model: false, stock_info_v2: { summary_info: { total_available_stock: 40 } } },
      null
    );
    expect(rows).toEqual([
      { listingId: "9002", variationId: "0", name: "Tote Bag", variationName: null, imageUrl: null, availableStock: 40, warehouseId: null },
    ]);
  });

  it("TikTok product: SKU label from sales attributes, stock summed across warehouses", () => {
    const rows = mapTikTokProduct({
      id: "1729582718312380123",
      title: "Ribbed Top",
      main_images: [{ urls: ["https://p16.tiktokcdn.com/main"] }],
      skus: [
        {
          id: "2729382476852921560",
          sales_attributes: [{ name: "Color", value_name: "Black" }, { name: "Size", value_name: "M" }],
          inventory: [{ warehouse_id: "w1", quantity: 10 }, { warehouse_id: "w2", quantity: 2 }],
        },
      ],
    });
    expect(rows).toEqual([
      {
        listingId: "1729582718312380123",
        variationId: "2729382476852921560",
        name: "Ribbed Top",
        variationName: "Black, M",
        imageUrl: "https://p16.tiktokcdn.com/main",
        // Only the warehouse we update counts; w2's pieces can't be sold through our pushes.
        availableStock: 10,
        warehouseId: "w1",
      },
    ]);
  });

  it("keeps the TikTok warehouse already linked to a SKU", () => {
    const product = {
      id: "p1",
      title: "Ribbed Top",
      skus: [{ id: "sku1", inventory: [{ warehouse_id: "w1", quantity: 10 }, { warehouse_id: "w2", quantity: 2 }] }],
    };
    const [row] = mapTikTokProduct(product, new Map([["sku1", "w2"]]));
    expect(row).toMatchObject({ availableStock: 2, warehouseId: "w2" });
    // A linked warehouse that's gone falls back to the first one.
    expect(mapTikTokProduct(product, new Map([["sku1", "w9"]]))[0]).toMatchObject({ availableStock: 10, warehouseId: "w1" });
  });
});
