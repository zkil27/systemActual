import { describe, expect, it } from "vitest";
import {
  buildCategoryBreadcrumbs,
  buildVariantMatrix,
  computeShopPublishStock,
  deriveCategoryPresets,
  deterministicSellerSku,
  formatPlainTextToTikTokHtml,
  mapShopeeModelsToVariants,
  mapTikTokSkusToVariants,
  validateCreateItemInput,
} from "../create-rules";

describe("buildVariantMatrix", () => {
  it("creates a single One size variant when no tiers are supplied", () => {
    const res = buildVariantMatrix([], 249, 15);
    expect(res).toEqual({
      ok: true,
      tiers: [],
      variants: [
        { label: "One size", tierValues: [], pricePhp: 249, stock: 15, skuCode: null },
      ],
    });
  });

  it("generates 2-tier Cartesian combinations and preserves existing edits", () => {
    const existing = new Map([
      ["Black, M", { pricePhp: 279, stock: 4, skuCode: "BLK-M" }],
    ]);
    const res = buildVariantMatrix(
      [
        { name: "Color", options: ["Black", "White", "black"] },
        { name: "Size", options: ["S", "M"] },
      ],
      199,
      10,
      existing
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tiers).toEqual([
      { name: "Color", options: ["Black", "White"] },
      { name: "Size", options: ["S", "M"] },
    ]);
    expect(res.variants.map((v) => v.label)).toEqual([
      "Black, S",
      "Black, M",
      "White, S",
      "White, M",
    ]);
    expect(res.variants[1]).toEqual({
      label: "Black, M",
      tierValues: ["Black", "M"],
      pricePhp: 279,
      stock: 4,
      skuCode: "BLK-M",
    });
  });

  it("rejects matrices exceeding 50 Shopee models", () => {
    const res = buildVariantMatrix(
      [
        { name: "Color", options: ["A", "B", "C", "D", "E", "F"] },
        { name: "Size", options: ["1", "2", "3", "4", "5", "6", "7", "8", "9"] },
      ],
      199,
      5
    );
    expect(res.ok).toBe(false);
  });
});

describe("validateCreateItemInput", () => {
  const baseValid = {
    title: "Ribbed Polo Dress",
    description: "Soft knit fabric",
    publishMode: "DRAFT" as const,
    imageUrls: ["/api/listings/photos/listing-photo-1-abc.jpg"],
    weightKg: 0.35,
    tiers: [{ name: "Size", options: ["S", "M"] }],
    variants: [
      { label: "S", tierValues: ["S"], pricePhp: 299, stock: 12 },
      { label: "M", tierValues: ["M"], pricePhp: 299, stock: 8 },
    ],
    targets: [
      { shopConnectionId: "sp1", platform: "SHOPEE" as const, categoryId: "100351" },
      { shopConnectionId: "tt1", platform: "TIKTOK" as const, categoryId: "601226" },
    ],
  };

  it("accepts a valid dual-shop input", () => {
    const res = validateCreateItemInput(baseValid);
    expect(res.ok).toBe(true);
  });

  it("enforces Shopee 120-char title limit when Shopee is targeted", () => {
    const res = validateCreateItemInput({
      ...baseValid,
      title: "A".repeat(121),
    });
    expect(res.ok).toBe(false);

    const tiktokOnly = validateCreateItemInput({
      ...baseValid,
      title: "A".repeat(150),
      targets: [{ shopConnectionId: "tt1", platform: "TIKTOK", categoryId: "601226" }],
    });
    expect(tiktokOnly.ok).toBe(true);
  });

  it("requires numeric Shopee category IDs and positive weights", () => {
    const badCat = validateCreateItemInput({
      ...baseValid,
      targets: [{ shopConnectionId: "sp1", platform: "SHOPEE", categoryId: "tops" }],
    });
    expect(badCat.ok).toBe(false);

    const badWeight = validateCreateItemInput({
      ...baseValid,
      weightKg: 0,
    });
    expect(badWeight.ok).toBe(false);
  });
});

describe("computeShopPublishStock & formatters", () => {
  it("subtracts garment or global safety buffer without going below zero", () => {
    expect(computeShopPublishStock(10, null, 2)).toBe(8);
    expect(computeShopPublishStock(10, 4, 2)).toBe(6);
    expect(computeShopPublishStock(2, 5, 0)).toBe(0);
  });

  it("escapes plain text into safe TikTok HTML paragraphs", () => {
    expect(formatPlainTextToTikTokHtml("100% Cotton <Soft>\nSize S-L\n\nShips daily"))
      .toBe("<p>100% Cotton &lt;Soft&gt;<br/>Size S-L</p><p>Ships daily</p>");
  });
});

describe("SKU & model mapping helpers", () => {
  it("maps Shopee init_tier_variation models back via tier_index", () => {
    const mapped = mapShopeeModelsToVariants(
      [
        { garmentVariantId: "gv1", tierValues: ["Black", "S"], pricePhp: 199, stock: 5, label: "Black, S" },
        { garmentVariantId: "gv2", tierValues: ["Black", "M"], pricePhp: 199, stock: 7, label: "Black, M" },
      ],
      [
        { name: "Color", options: ["Black"] },
        { name: "Size", options: ["S", "M"] },
      ],
      [
        { model_id: 9002, tier_index: [0, 1] },
        { model_id: 9001, tier_index: [0, 0] },
      ]
    );
    expect(mapped[0].variationId).toBe("9001");
    expect(mapped[1].variationId).toBe("9002");
  });

  it("maps TikTok created SKUs back via deterministic seller_sku", () => {
    const sku1 = deterministicSellerSku("clx0000011111");
    const sku2 = deterministicSellerSku("clx0000022222", "CUSTOM-2");
    const mapped = mapTikTokSkusToVariants(
      [
        { garmentVariantId: "clx0000011111", pricePhp: 250, stock: 3, label: "Red", tierValues: ["Red"] },
        { garmentVariantId: "clx0000022222", skuCode: "CUSTOM-2", pricePhp: 250, stock: 4, label: "Blue", tierValues: ["Blue"] },
      ],
      [
        { id: "tt-sku-2", seller_sku: sku2 },
        { id: "tt-sku-1", seller_sku: sku1 },
      ],
      "wh-1"
    );
    expect(mapped[0].variationId).toBe("tt-sku-1");
    expect(mapped[1].variationId).toBe("tt-sku-2");
    expect(mapped[0].warehouseId).toBe("wh-1");
  });
});

describe("category helpers", () => {
  it("builds leaf breadcrumbs and guards against parent cycles", () => {
    const leaves = buildCategoryBreadcrumbs([
      { id: "1", parentId: null, name: "Women", isLeaf: false },
      { id: "2", parentId: "1", name: "Tops", isLeaf: true },
      { id: "3", parentId: "4", name: "Cycle A", isLeaf: false },
      { id: "4", parentId: "3", name: "Cycle B", isLeaf: true },
    ]);
    expect(leaves).toEqual([
      { id: "4", name: "Cycle B", path: "Cycle A > Cycle B", isLeaf: true },
      { id: "2", name: "Tops", path: "Women > Tops", isLeaf: true },
    ]);
  });

  it("derives paired Shopee + TikTok presets sorted by frequency", () => {
    const { presets, recentByPlatform } = deriveCategoryPresets([
      {
        products: [
          { platform: "SHOPEE", categoryId: "1001", categoryName: "Dresses" },
          { platform: "TIKTOK", categoryId: "6001", categoryName: "Women Dresses" },
        ],
      },
      {
        products: [
          { platform: "SHOPEE", categoryId: "1001", categoryName: null },
          { platform: "TIKTOK", categoryId: "6001", categoryName: "Women Dresses" },
        ],
      },
      {
        products: [
          { platform: "SHOPEE", categoryId: "1002", categoryName: "Tops" },
          { platform: "TIKTOK", categoryId: "6002", categoryName: "Blouses" },
        ],
      },
    ]);
    expect(presets[0]).toMatchObject({
      shopeeCategoryId: "1001",
      tiktokCategoryId: "6001",
      count: 2,
    });
    expect(recentByPlatform.SHOPEE).toHaveLength(2);
    expect(recentByPlatform.TIKTOK).toHaveLength(2);
  });
});
