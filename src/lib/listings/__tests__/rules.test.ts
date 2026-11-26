import { describe, expect, it } from "vitest";
import {
  mapShopeeChannelProduct,
  mapTikTokChannelProduct,
} from "@/lib/catalog/import-map";
import {
  buildListingCopyPreview,
  derivePriceChangeStatus,
  formatPriceChangeApprovalCard,
  validateProposedPrice,
} from "../rules";

describe("validateProposedPrice", () => {
  it("accepts positive PHP prices up to 100,000 and rounds to 2 decimals", () => {
    expect(validateProposedPrice(199.456)).toEqual({ ok: true, value: 199.46 });
    expect(validateProposedPrice(0).ok).toBe(false);
    expect(validateProposedPrice(-10).ok).toBe(false);
    expect(validateProposedPrice(200_000).ok).toBe(false);
  });
});

describe("derivePriceChangeStatus", () => {
  it("distinguishes PUSHED, PARTIAL, and FAILED across shop results", () => {
    expect(derivePriceChangeStatus([{ status: "OK" }, { status: "OK" }])).toBe("PUSHED");
    expect(derivePriceChangeStatus([{ status: "OK" }, { status: "SKIPPED" }])).toBe("PARTIAL");
    expect(derivePriceChangeStatus([{ status: "OK" }, { status: "FAILED" }])).toBe("PARTIAL");
    expect(derivePriceChangeStatus([{ status: "FAILED" }, { status: "SKIPPED" }])).toBe("FAILED");
    expect(derivePriceChangeStatus([])).toBe("FAILED");
  });
});

describe("buildListingCopyPreview", () => {
  it("adds target-platform warnings when writes are off or copying to TikTok/Shopee", () => {
    const tt = buildListingCopyPreview(
      {
        title: "Ribbed Top",
        description: "Soft cotton",
        categoryId: "123",
        categoryName: "Tops",
        imageUrls: ["https://example.com/1.png"],
        variants: [{ label: "Black, M", pricePhp: 199, stock: 12 }],
      },
      "TIKTOK",
      false
    );
    expect(tt.categoryId).toBeNull();
    expect(tt.warnings.some((w) => w.includes("Writes are currently off"))).toBe(true);
    expect(tt.warnings.some((w) => w.includes("TikTok review"))).toBe(true);
  });

  it("formats a Telegram price approval card clearly", () => {
    const card = formatPriceChangeApprovalCard({
      garmentName: "Ribbed Top",
      oldPricePhp: 189,
      newPricePhp: 199,
      targetShops: [
        { shopName: "Kyna Shopee", platform: "SHOPEE", writesEnabled: false },
        { shopName: "Kyna TikTok", platform: "TIKTOK", writesEnabled: true },
      ],
      baseUrl: "https://kyna-ops.example.com",
    });
    expect(card).toContain("₱189.00 -> ₱199.00");
    expect(card).toContain("Kyna Shopee (writes off)");
    expect(card).toContain("https://kyna-ops.example.com/approvals");
  });
});

describe("ChannelProduct mappers", () => {
  it("extracts Shopee parent metadata and model prices", () => {
    const cp = mapShopeeChannelProduct(
      {
        item_id: 9001,
        item_name: "Ribbed Top",
        description: "Cotton blend",
        category_id: 100351,
        item_status: "NORMAL",
        has_model: true,
        image: { image_url_list: ["https://cf.shopee.ph/file/a"] },
      },
      {
        model: [
          { model_id: 77, price_info: [{ original_price: 199 }] },
          { model_id: 78, model_status: "MODEL_UNAVAILABLE", price_info: [{ original_price: 149 }] },
        ],
      }
    );
    expect(cp).toEqual({
      listingId: "9001",
      title: "Ribbed Top",
      description: "Cotton blend",
      categoryId: "100351",
      categoryName: null,
      status: "NORMAL",
      imageUrls: ["https://cf.shopee.ph/file/a"],
      currency: "PHP",
      priceByVariation: { "77": 199 },
    });
  });

  it("extracts TikTok parent metadata and SKU prices", () => {
    const cp = mapTikTokChannelProduct({
      id: "172958",
      title: "Pleated Skirt",
      description: "<p>Cute skirt</p>",
      status: "ACTIVATE",
      category_chains: [
        { id: "10", local_name: "Womenswear" },
        { id: "20", local_name: "Skirts" },
      ],
      main_images: [{ urls: ["https://p16.tiktokcdn.com/main"] }],
      skus: [
        { id: "sku1", price: { tax_exclusive_price: "249.00" } },
      ],
    });
    expect(cp).toEqual({
      listingId: "172958",
      title: "Pleated Skirt",
      description: "<p>Cute skirt</p>",
      categoryId: "20",
      categoryName: "Skirts",
      status: "ACTIVATE",
      imageUrls: ["https://p16.tiktokcdn.com/main"],
      currency: "PHP",
      priceByVariation: { sku1: 249 },
    });
  });
});
