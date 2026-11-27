import { Platform, type ShopConnection } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/crypto";

const { mockPrisma, mockReadListingPhoto } = vi.hoisted(() => ({
  mockPrisma: {
    listingVariant: { findFirst: vi.fn() },
  },
  mockReadListingPhoto: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/storage", () => ({
  isOwnListingBlobUrl: (u: string) => u.includes(".blob.vercel-storage.com/listing-photos/"),
  readListingPhoto: mockReadListingPhoto,
}));

import { shopeeConnector } from "../shopee";
import { tiktokConnector } from "../tiktok";

function makeShop(platform: Platform): ShopConnection {
  return {
    id: platform === Platform.SHOPEE ? "shop-sp" : "shop-tt",
    platform,
    shopId: platform === Platform.SHOPEE ? "12345" : "tt-shop-1",
    shopName: platform === Platform.SHOPEE ? "Kyna Shopee" : "Kyna TikTok",
    shopCipher: platform === Platform.TIKTOK ? encryptSecret("cipher-1") : null,
    accessToken: encryptSecret("token-1"),
    refreshToken: null,
    tokenExpiresAt: null,
    tokenErrorAt: null,
    tokenError: null,
    writesEnabled: true,
    ordersSyncedTo: null,
    returnsSyncedTo: null,
    walletSyncedTo: null,
    walletCheckedAt: null,
    stockImportStatus: null,
    stockImportCursor: null,
    stockImportedAt: null,
    lastSyncedAt: null,
    isDemo: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    chatAccessAt: null,
    chatsCheckedAt: null,
  };
}

describe("ChannelConnector createListing & fetchCategories", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SHOPEE_PARTNER_ID = "999";
    process.env.SHOPEE_PARTNER_KEY = "sp-secret";
    process.env.TIKTOK_APP_KEY = "tt-key";
    process.env.TIKTOK_APP_SECRET = "tt-secret";
    process.env.TIKTOK_SERVICE_ID = "svc";

    mockReadListingPhoto.mockResolvedValue({
      buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]),
      format: { ext: ".jpg", contentType: "image/jpeg" },
      fileName: "listing-photo-1-abc.jpg",
    });
  });

  it("uploads photos, resolves Shopee logistics, creates item with seller_stock, and initializes tiers", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      let parsedBody: unknown;
      if (typeof init?.body === "string") parsedBody = JSON.parse(init.body);
      calls.push({ url, body: parsedBody });

      if (url.includes("/api/v2/media_space/upload_image")) {
        return new Response(
          JSON.stringify({
            response: { image_info: { image_id: "img-sp-1", image_url: "https://cf.shopee.ph/img1" } },
          })
        );
      }
      if (url.includes("/api/v2/logistics/get_channel_list")) {
        return new Response(
          JSON.stringify({
            response: {
              logistics_channel_list: [
                { logistics_channel_id: 2001, enabled: true, mask_channel_id: 0 },
                { logistics_channel_id: 2002, enabled: false, mask_channel_id: 0 },
              ],
            },
          })
        );
      }
      if (url.includes("/api/v2/product/add_item")) {
        return new Response(JSON.stringify({ response: { item_id: 778899 } }));
      }
      if (url.includes("/api/v2/product/init_tier_variation")) {
        return new Response(
          JSON.stringify({
            response: {
              item_id: 778899,
              model: [
                { model_id: 101, tier_index: [0] },
                { model_id: 102, tier_index: [1] },
              ],
            },
          })
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const shop = makeShop(Platform.SHOPEE);
    const res = await shopeeConnector.createListing(shop, shop.accessToken!, {
      title: "Ribbed Top",
      description: "Cotton",
      categoryId: "100351",
      publishMode: "DRAFT",
      weightKg: 0.3,
      pricePhp: 199,
      stock: 10,
      imageUrls: ["/api/listings/photos/listing-photo-1-abc.jpg"],
      tiers: [{ name: "Size", options: ["S", "M"] }],
      variants: [
        { garmentVariantId: "gv-s", label: "S", tierValues: ["S"], pricePhp: 199, stock: 4 },
        { garmentVariantId: "gv-m", label: "M", tierValues: ["M"], pricePhp: 219, stock: 6 },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(res.externalListingId).toBe("778899");
    expect(res.status).toBe("UNLIST");
    expect(res.remoteImageUrls).toEqual(["https://cf.shopee.ph/img1"]);
    expect(res.skus).toEqual([
      { garmentVariantId: "gv-s", variationId: "101", variationName: "S", pricePhp: 199, stock: 4 },
      { garmentVariantId: "gv-m", variationId: "102", variationName: "M", pricePhp: 219, stock: 6 },
    ]);

    const addCall = calls.find((c) => c.url.includes("add_item"))!.body as Record<string, unknown>;
    expect(addCall.item_status).toBe("UNLIST");
    expect(addCall.seller_stock).toEqual([{ stock: 10 }]);
    expect(addCall.logistic_info).toEqual([{ logistic_id: 2001, enabled: true }]);
    expect(addCall.image).toEqual({ image_id_list: ["img-sp-1"] });
  });

  it("preserves Shopee externalListingId on partial init_tier_variation failure so retry resumes cleanly", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("get_channel_list")) {
        return new Response(
          JSON.stringify({ response: { logistics_channel_list: [{ logistics_channel_id: 2001, enabled: true }] } })
        );
      }
      if (url.includes("add_item")) {
        return new Response(JSON.stringify({ response: { item_id: 5555 } }));
      }
      if (url.includes("init_tier_variation")) {
        return new Response(JSON.stringify({ error: "error_param", message: "Duplicate option" }), { status: 400 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const shop = makeShop(Platform.SHOPEE);
    const res = await shopeeConnector.createListing(shop, shop.accessToken!, {
      title: "Ribbed Top",
      description: "Cotton",
      categoryId: "100351",
      publishMode: "LIVE",
      weightKg: 0.3,
      pricePhp: 199,
      stock: 5,
      imageUrls: [],
      tiers: [{ name: "Size", options: ["S"] }],
      variants: [{ garmentVariantId: "gv-s", label: "S", tierValues: ["S"], pricePhp: 199, stock: 5 }],
    });

    expect(res.externalListingId).toBe("5555");
    expect(res.partialError).toContain("Duplicate option");
    expect(res.skus).toEqual([]);
  });

  it("uploads photos to TikTok, resolves warehouse, and creates AS_DRAFT product with sales_attributes", async () => {
    mockPrisma.listingVariant.findFirst.mockResolvedValueOnce(null);
    let createBody: Record<string, unknown> | undefined;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/logistics/202309/warehouses")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { warehouses: [{ id: "wh-99", type: "SALES_WAREHOUSE", effect_status: "ENABLED" }] },
          })
        );
      }
      if (url.includes("/product/202309/images/upload")) {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { uri: "tos-alisg-i/photo1", url: "https://p16.tiktokcdn.com/photo1" },
          })
        );
      }
      if (url.includes("/product/202309/products")) {
        createBody = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              product_id: "172999",
              skus: [{ id: "sku-9001", seller_sku: "kyna-gv-black" }],
            },
          })
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const shop = makeShop(Platform.TIKTOK);
    const res = await tiktokConnector.createListing(shop, shop.accessToken!, {
      title: "Ribbed Top",
      description: "Line 1\nLine 2",
      categoryId: "601226",
      publishMode: "DRAFT",
      weightKg: 0.3,
      pricePhp: 199,
      stock: 8,
      imageUrls: ["/api/listings/photos/listing-photo-1-abc.jpg"],
      tiers: [{ name: "Color", options: ["Black"] }],
      variants: [
        { garmentVariantId: "clx-gv-black", label: "Black", tierValues: ["Black"], pricePhp: 199, stock: 8 },
      ],
    });

    expect(res.externalListingId).toBe("172999");
    expect(res.status).toBe("DRAFT");
    expect(res.skus[0]).toMatchObject({
      garmentVariantId: "clx-gv-black",
      variationId: "sku-9001",
      warehouseId: "wh-99",
      stock: 8,
    });
    expect(createBody?.save_mode).toBe("AS_DRAFT");
    expect(createBody?.package_weight).toEqual({ value: "0.300", unit: "KILOGRAM" });
    expect(createBody?.description).toBe("<p>Line 1<br/>Line 2</p>");
    expect(createBody?.main_images).toEqual([{ uri: "tos-alisg-i/photo1" }]);
  });
});
