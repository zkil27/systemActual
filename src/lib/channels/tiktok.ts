import { Platform } from "@prisma/client";
import { isTikTokConfigured, tiktokRequest, tiktokUploadRequest } from "@/lib/connectors/tiktok";
import { refreshTikTokTokens } from "@/lib/connectors/tokens";
import { mapTikTokOrderStatements } from "@/lib/finance/map";
import { mapTikTokOrder } from "@/lib/ledger/normalize";
import {
  buildCategoryBreadcrumbs,
  DEFAULT_WEIGHT_KG,
  deterministicSellerSku,
  formatPlainTextToTikTokHtml,
  mapTikTokSkusToVariants,
} from "@/lib/listings/create-rules";
import { prisma } from "@/lib/prisma";
import { isOwnListingBlobUrl, readListingPhoto } from "@/lib/storage";
import type { ChannelConnector, CreateListingInput, CreateListingResult, StockPushResult } from "./types";

export const tiktokConnector: ChannelConnector = {
  platform: Platform.TIKTOK,
  label: "TikTok Shop",
  canResumeOrderWindow: true,

  isConfigured() {
    return isTikTokConfigured();
  },

  refreshTokens(refreshToken, _shopId, now) {
    return refreshTikTokTokens(refreshToken, fetch, now);
  },

  async fetchSingleOrder(shop, token, orderSn) {
    if (!shop.shopCipher) return null;
    const data = await tiktokRequest({
      method: "GET",
      path: "/order/202309/orders",
      accessToken: token,
      shopCipher: shop.shopCipher,
      query: { ids: orderSn },
    });
    const raw = data?.orders?.[0] as Record<string, unknown> | undefined;
    return raw ? mapTikTokOrder(raw) : null;
  },

  async *fetchOrdersWindow(shop, token, w, checkDeadline) {
    const sec = (d: Date) => Math.floor(d.getTime() / 1000);
    let pageToken = "";
    for (;;) {
      checkDeadline();
      const data = await tiktokRequest({
        method: "POST",
        path: "/order/202309/orders/search",
        accessToken: token,
        shopCipher: shop.shopCipher,
        query: {
          // A 100-order page can take ~17s to come back; smaller pages leave
          // time in the tick to save what was fetched.
          page_size: "50",
          sort_field: "update_time",
          sort_order: "ASC",
          ...(pageToken ? { page_token: pageToken } : {}),
        },
        body: { update_time_ge: sec(w.from), update_time_lt: sec(w.to) },
      });
      yield (Array.isArray(data?.orders) ? data.orders : []).map(mapTikTokOrder);
      if (!data?.next_page_token) return;
      pageToken = String(data.next_page_token);
    }
  },

  async fetchOrderFinance(shop, token, orderSn) {
    const data = await tiktokRequest({
      method: "GET",
      path: `/finance/202309/orders/${encodeURIComponent(orderSn)}/statement_transactions`,
      accessToken: token,
      shopCipher: shop.shopCipher,
    });
    return mapTikTokOrderStatements(data);
  },

  async pushListingStock(shop, token, rows) {
    const result: StockPushResult = { ok: [], failed: [] };
    if (!shop.shopCipher) {
      for (const r of rows) {
        result.failed.push({ id: r.listingVariantId, error: "Reconnect TikTok (missing shop cipher)." });
      }
      return result;
    }
    const ready = rows.filter((r) => r.warehouseId);
    for (const r of rows) {
      if (!r.warehouseId) {
        result.failed.push({
          id: r.listingVariantId,
          error: "Read stock from TikTok first (warehouse unknown).",
        });
      }
    }
    if (!ready.length) return result;
    try {
      await tiktokRequest({
        method: "POST",
        path: `/product/202309/products/${encodeURIComponent(ready[0].listingId)}/inventory/update`,
        accessToken: token,
        shopCipher: shop.shopCipher,
        body: {
          skus: ready.map((r) => ({
            id: r.variationId,
            inventory: [{ warehouse_id: r.warehouseId, quantity: r.target }],
          })),
        },
      });
      result.ok.push(...ready.map((r) => r.listingVariantId));
    } catch (err) {
      for (const r of ready) {
        result.failed.push({ id: r.listingVariantId, error: (err as Error).message });
      }
    }
    return result;
  },

  async pushListingPrices(shop, token, rows) {
    const result: StockPushResult = { ok: [], failed: [] };
    if (!shop.shopCipher) {
      for (const r of rows) {
        result.failed.push({ id: r.listingVariantId, error: "Reconnect TikTok (missing shop cipher)." });
      }
      return result;
    }
    try {
      await tiktokRequest({
        method: "POST",
        path: `/product/202309/products/${encodeURIComponent(rows[0].listingId)}/prices/update`,
        accessToken: token,
        shopCipher: shop.shopCipher,
        body: {
          skus: rows.map((r) => ({
            id: r.variationId,
            price: {
              amount: r.pricePhp.toFixed(2),
              currency: r.currency ?? "PHP",
            },
          })),
        },
      });
      result.ok.push(...rows.map((r) => r.listingVariantId));
    } catch (err) {
      for (const r of rows) {
        result.failed.push({ id: r.listingVariantId, error: (err as Error).message });
      }
    }
    return result;
  },

  async createDraftListing(shop, token, draft) {
    const res = await tiktokConnector.createListing(shop, token, {
      title: draft.title,
      description: draft.description,
      categoryId: draft.categoryId,
      publishMode: "DRAFT",
      weightKg: DEFAULT_WEIGHT_KG,
      pricePhp: draft.pricePhp,
      stock: draft.stock,
      imageUrls: draft.imageUrls,
      tiers: [],
      variants: draft.variants.map((v, idx) => ({
        garmentVariantId: `draft-${idx}`,
        label: v.label,
        tierValues: [],
        skuCode: v.label,
        pricePhp: v.pricePhp,
        stock: v.stock,
      })),
    });
    return {
      externalListingId: res.externalListingId,
      status: res.status,
    };
  },

  async fetchCategories(shop, token) {
    if (!shop.shopCipher) {
      throw new Error("Reconnect TikTok (missing shop cipher).");
    }
    const data = await tiktokRequest({
      method: "GET",
      path: "/product/202309/categories",
      accessToken: token,
      shopCipher: shop.shopCipher,
      query: { locale: "en-US", listing_platform: "TIKTOK_SHOP" },
    });
    const rawList = Array.isArray(data?.categories)
      ? (data.categories as Array<Record<string, unknown>>)
      : [];
    return buildCategoryBreadcrumbs(
      rawList.map((c) => ({
        id: String(c.id ?? ""),
        parentId:
          c.parent_id !== undefined && c.parent_id !== null && String(c.parent_id) !== "0"
            ? String(c.parent_id)
            : null,
        name: String(c.local_name ?? ""),
        isLeaf: Boolean(c.is_leaf),
      }))
    );
  },

  async createListing(shop, token, input: CreateListingInput): Promise<CreateListingResult> {
    if (!shop.shopCipher) {
      throw new Error("Reconnect TikTok (missing shop cipher).");
    }
    if (!input.categoryId.trim()) {
      throw new Error("Enter a TikTok category ID before creating this listing.");
    }

    // Step A: Resolve TikTok warehouse_id (reuse known warehouse on shop, else ask Logistics API).
    const knownVariant = await prisma.listingVariant.findFirst({
      where: { shopConnectionId: shop.id, warehouseId: { not: null } },
      select: { warehouseId: true },
    });
    let warehouseId = knownVariant?.warehouseId ?? null;
    if (!warehouseId) {
      const whData = await tiktokRequest({
        method: "GET",
        path: "/logistics/202309/warehouses",
        accessToken: token,
        shopCipher: shop.shopCipher,
      });
      const warehouses = Array.isArray(whData?.warehouses)
        ? (whData.warehouses as Array<Record<string, unknown>>)
        : [];
      const active =
        warehouses.find(
          (w) => w.type === "SALES_WAREHOUSE" && w.effect_status === "ENABLED"
        ) ?? warehouses[0];
      warehouseId = active?.id ? String(active.id) : null;
    }
    if (!warehouseId) {
      throw new Error("Set up an active warehouse in TikTok Seller Center first.");
    }

    // Step B: Upload stored photos to TikTok (skip non-own external URLs during draft copy).
    const mainImages: Array<{ uri: string }> = [];
    const remoteImageUrls: string[] = [];
    for (const url of input.imageUrls.slice(0, 9)) {
      if (!url.startsWith("/api/listings/photos/") && !isOwnListingBlobUrl(url)) continue;
      const photo = await readListingPhoto(url);
      const uploaded = await tiktokUploadRequest({
        path: "/product/202309/images/upload",
        accessToken: token,
        shopCipher: shop.shopCipher,
        field: "data",
        file: new Blob([new Uint8Array(photo.buffer)], { type: photo.format.contentType }),
        fileName: photo.fileName,
        extraFields: { use_case: "MAIN_IMAGE" },
      });
      if (uploaded?.uri) {
        mainImages.push({ uri: String(uploaded.uri) });
      }
      if (uploaded?.url) {
        remoteImageUrls.push(String(uploaded.url));
      }
    }

    // Step C: Create product.
    const body: Record<string, unknown> = {
      save_mode: input.publishMode === "LIVE" ? "LISTING" : "AS_DRAFT",
      title: input.title.slice(0, 255),
      description: formatPlainTextToTikTokHtml(input.description || input.title),
      category_id: input.categoryId.trim(),
      package_weight: {
        value: (input.weightKg || DEFAULT_WEIGHT_KG).toFixed(3),
        unit: "KILOGRAM",
      },
      skus: input.variants.map((v) => ({
        seller_sku: deterministicSellerSku(v.garmentVariantId, v.skuCode),
        price: { amount: v.pricePhp.toFixed(2), currency: "PHP" },
        inventory: [{ warehouse_id: warehouseId, quantity: Math.max(0, Math.round(v.stock)) }],
        ...(input.tiers.length > 0
          ? {
              sales_attributes: input.tiers.map((t, idx) => ({
                name: t.name,
                value_name: v.tierValues[idx] ?? v.label,
              })),
            }
          : {}),
      })),
    };
    if (mainImages.length) {
      body.main_images = mainImages;
    }
    if (input.dimensionsCm) {
      body.package_dimensions = {
        length: String(Math.round(input.dimensionsCm.length)),
        width: String(Math.round(input.dimensionsCm.width)),
        height: String(Math.round(input.dimensionsCm.height)),
        unit: "CENTIMETER",
      };
    }

    const data = await tiktokRequest({
      method: "POST",
      path: "/product/202309/products",
      accessToken: token,
      shopCipher: shop.shopCipher,
      body,
    });
    const externalListingId = String(data?.product_id ?? "");
    const returnedSkus = Array.isArray(data?.skus)
      ? (data.skus as Array<{ id?: unknown; sku_id?: unknown; seller_sku?: unknown }>)
      : [];
    const skus = mapTikTokSkusToVariants(input.variants, returnedSkus, warehouseId);

    return {
      externalListingId,
      status: input.publishMode === "LIVE" ? "PENDING" : "DRAFT",
      skus,
      remoteImageUrls,
    };
  },
};
