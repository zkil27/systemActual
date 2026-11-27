import { Platform } from "@prisma/client";
import { isShopeeConfigured, shopeeGet, shopeePost, shopeeUploadImage } from "@/lib/connectors/shopee";
import { refreshShopeeTokens } from "@/lib/connectors/tokens";
import { mapShopeeEscrow } from "@/lib/finance/map";
import { mapShopeeOrder } from "@/lib/ledger/normalize";
import {
  buildCategoryBreadcrumbs,
  DEFAULT_WEIGHT_KG,
  deterministicSellerSku,
  mapShopeeModelsToVariants,
} from "@/lib/listings/create-rules";
import { isOwnListingBlobUrl, readListingPhoto } from "@/lib/storage";
import type { ChannelConnector, CreateListingInput, CreateListingResult, StockPushResult } from "./types";

/** Shopee update_stock takes up to 50 models of one item per call. */
const SHOPEE_MAX_MODELS = 50;

export const SHOPEE_DETAIL_FIELDS = [
  "item_list",
  "package_list",
  "total_amount",
  "payment_method",
  "shipping_carrier",
  "cancel_by",
  "cancel_reason",
  "buyer_cancel_reason",
  "pickup_done_time",
].join(",");

export const shopeeConnector: ChannelConnector = {
  platform: Platform.SHOPEE,
  label: "Shopee",
  canResumeOrderWindow: false,

  isConfigured() {
    return isShopeeConfigured();
  },

  refreshTokens(refreshToken, shopId, now) {
    return refreshShopeeTokens(refreshToken, shopId, fetch, now);
  },

  async fetchSingleOrder(shop, token, orderSn) {
    const resp = await shopeeGet("/api/v2/order/get_order_detail", shop.shopId, token, {
      order_sn_list: orderSn,
      response_optional_fields: SHOPEE_DETAIL_FIELDS,
    });
    const raw = resp?.order_list?.[0] as Record<string, unknown> | undefined;
    return raw ? mapShopeeOrder(raw) : null;
  },

  async *fetchOrdersWindow(shop, token, w, checkDeadline) {
    const sec = (d: Date) => Math.floor(d.getTime() / 1000);
    let cursor = "";
    for (;;) {
      checkDeadline();
      const list = await shopeeGet("/api/v2/order/get_order_list", shop.shopId, token, {
        time_range_field: "update_time",
        time_from: sec(w.from),
        time_to: sec(w.to),
        page_size: 100,
        ...(cursor ? { cursor } : {}),
      });
      const sns: string[] = (list?.order_list ?? []).map((o: { order_sn: string }) => String(o.order_sn));
      for (let i = 0; i < sns.length; i += 50) {
        checkDeadline();
        const detail = await shopeeGet("/api/v2/order/get_order_detail", shop.shopId, token, {
          order_sn_list: sns.slice(i, i + 50).join(","),
          response_optional_fields: SHOPEE_DETAIL_FIELDS,
        });
        yield (detail?.order_list ?? []).map(mapShopeeOrder);
      }
      if (!list?.more || !list?.next_cursor) return;
      cursor = String(list.next_cursor);
    }
  },

  async fetchOrderFinance(shop, token, orderSn) {
    const resp = await shopeeGet("/api/v2/payment/get_escrow_detail", shop.shopId, token, {
      order_sn: orderSn,
    });
    return mapShopeeEscrow(resp);
  },

  async pushListingStock(shop, token, rows) {
    const result: StockPushResult = { ok: [], failed: [] };
    for (let i = 0; i < rows.length; i += SHOPEE_MAX_MODELS) {
      const chunk = rows.slice(i, i + SHOPEE_MAX_MODELS);
      try {
        const resp = await shopeePost("/api/v2/product/update_stock", shop.shopId, token, {
          item_id: Number(chunk[0].listingId),
          stock_list: chunk.map((r) => ({
            model_id: Number(r.variationId),
            seller_stock: [{ stock: r.target }],
          })),
        });
        const failures = new Map<string, string>(
          ((resp?.failure_list ?? []) as Array<{ model_id?: number; failed_reason?: string }>).map((f) => [
            String(f.model_id ?? 0),
            String(f.failed_reason ?? "Rejected by Shopee"),
          ])
        );
        for (const r of chunk) {
          const reason = failures.get(r.variationId);
          if (reason) result.failed.push({ id: r.listingVariantId, error: reason });
          else result.ok.push(r.listingVariantId);
        }
      } catch (err) {
        for (const r of chunk) {
          result.failed.push({ id: r.listingVariantId, error: (err as Error).message });
        }
      }
    }
    return result;
  },

  async pushListingPrices(shop, token, rows) {
    const result: StockPushResult = { ok: [], failed: [] };
    for (let i = 0; i < rows.length; i += SHOPEE_MAX_MODELS) {
      const chunk = rows.slice(i, i + SHOPEE_MAX_MODELS);
      try {
        const resp = await shopeePost("/api/v2/product/update_price", shop.shopId, token, {
          item_id: Number(chunk[0].listingId),
          price_list: chunk.map((r) => ({
            model_id: Number(r.variationId),
            original_price: r.pricePhp,
          })),
        });
        const failures = new Map<string, string>(
          ((resp?.failure_list ?? []) as Array<{ model_id?: number; failed_reason?: string }>).map((f) => [
            String(f.model_id ?? 0),
            String(f.failed_reason ?? "Rejected by Shopee"),
          ])
        );
        for (const r of chunk) {
          const reason = failures.get(r.variationId);
          if (reason) result.failed.push({ id: r.listingVariantId, error: reason });
          else result.ok.push(r.listingVariantId);
        }
      } catch (err) {
        for (const r of chunk) {
          result.failed.push({ id: r.listingVariantId, error: (err as Error).message });
        }
      }
    }
    return result;
  },

  async createDraftListing(shop, token, draft) {
    const res = await shopeeConnector.createListing(shop, token, {
      title: draft.title,
      description: draft.description,
      categoryId: draft.categoryId,
      publishMode: "DRAFT",
      weightKg: DEFAULT_WEIGHT_KG,
      pricePhp: draft.pricePhp,
      stock: draft.stock,
      imageUrls: draft.imageUrls,
      tiers: [],
      variants: [
        {
          garmentVariantId: "draft",
          label: "One size",
          tierValues: [],
          pricePhp: draft.pricePhp,
          stock: draft.stock,
        },
      ],
    });
    return {
      externalListingId: res.externalListingId,
      status: res.status,
    };
  },

  async fetchCategories(shop, token) {
    const resp = await shopeeGet("/api/v2/product/get_category", shop.shopId, token, {
      language: "en",
    });
    const rawList = Array.isArray(resp?.category_list)
      ? (resp.category_list as Array<Record<string, unknown>>)
      : [];
    return buildCategoryBreadcrumbs(
      rawList.map((c) => ({
        id: String(c.category_id ?? ""),
        parentId:
          c.parent_category_id !== undefined &&
          c.parent_category_id !== null &&
          Number(c.parent_category_id) > 0
            ? String(c.parent_category_id)
            : null,
        name: String(c.display_category_name || c.original_category_name || ""),
        isLeaf: !c.has_children,
      }))
    );
  },

  async createListing(shop, token, input: CreateListingInput): Promise<CreateListingResult> {
    const catId = Number(input.categoryId);
    if (!input.categoryId || !Number.isFinite(catId) || catId <= 0) {
      throw new Error("Enter a numeric Shopee category ID before creating this listing.");
    }

    const itemStatus = input.publishMode === "LIVE" ? "NORMAL" : "UNLIST";
    const remoteImageUrls: string[] = [];
    const imageIdList: string[] = [];

    // Step A: Upload our stored listing photos to Shopee Media Space (skip non-own external URLs).
    for (const url of input.imageUrls.slice(0, 9)) {
      if (!url.startsWith("/api/listings/photos/") && !isOwnListingBlobUrl(url)) continue;
      const photo = await readListingPhoto(url);
      const uploaded = await shopeeUploadImage(
        shop.shopId,
        token,
        new Blob([new Uint8Array(photo.buffer)], { type: photo.format.contentType }),
        photo.fileName,
        "normal"
      );
      imageIdList.push(uploaded.imageId);
      if (uploaded.imageUrl) remoteImageUrls.push(uploaded.imageUrl);
    }

    let externalListingId = input.existingExternalListingId?.trim() || "";

    if (!externalListingId) {
      // Step B: Resolve enabled shipping channels.
      const logisticsResp = await shopeeGet(
        "/api/v2/logistics/get_channel_list",
        shop.shopId,
        token,
        {}
      );
      const allChannels = Array.isArray(logisticsResp?.logistics_channel_list)
        ? (logisticsResp.logistics_channel_list as Array<Record<string, unknown>>)
        : [];
      const primary = allChannels.filter(
        (c) =>
          c.enabled === true &&
          (c.mask_channel_id === undefined ||
            c.mask_channel_id === null ||
            Number(c.mask_channel_id) === 0)
      );
      const enabledChannels = primary.length
        ? primary
        : allChannels.filter((c) => c.enabled === true);
      if (!enabledChannels.length) {
        throw new Error("Turn on at least one shipping channel in Shopee Seller Center first.");
      }

      const logisticInfo = enabledChannels.map((c) => ({
        logistic_id: Number(c.logistics_channel_id),
        enabled: true,
      }));

      // Step C: Create base item.
      const baseStock =
        input.variants.length > 0
          ? input.variants.reduce((sum, v) => sum + Math.max(0, Math.round(v.stock)), 0)
          : Math.max(0, Math.round(input.stock));
      const basePrice = input.variants[0]?.pricePhp ?? input.pricePhp;

      const addBody: Record<string, unknown> = {
        item_name: input.title.slice(0, 120),
        description: (input.description || input.title).slice(0, 3000),
        category_id: catId,
        original_price: basePrice,
        seller_stock: [{ stock: baseStock }],
        item_status: itemStatus,
        weight: input.weightKg || DEFAULT_WEIGHT_KG,
        brand: { brand_id: 0, original_brand_name: "NoBrand" },
        logistic_info: logisticInfo,
      };
      if (imageIdList.length) {
        addBody.image = { image_id_list: imageIdList };
      }
      if (input.dimensionsCm) {
        addBody.dimension = {
          package_length: Math.round(input.dimensionsCm.length),
          package_width: Math.round(input.dimensionsCm.width),
          package_height: Math.round(input.dimensionsCm.height),
        };
      }

      const resp = await shopeePost("/api/v2/product/add_item", shop.shopId, token, addBody);
      externalListingId = String(resp?.item_id ?? "");
      if (!externalListingId) {
        throw new Error("Shopee didn't return an item ID.");
      }
    }

    // Step D: Single-SKU or 1-2 tier variations.
    if (input.tiers.length === 0) {
      const first = input.variants[0];
      return {
        externalListingId,
        status: itemStatus,
        remoteImageUrls,
        skus: first
          ? [
              {
                garmentVariantId: first.garmentVariantId,
                variationId: "0",
                variationName: null,
                pricePhp: first.pricePhp,
                stock: Math.max(0, Math.round(first.stock)),
              },
            ]
          : [],
      };
    }

    try {
      const optionIndexMaps = input.tiers.map(
        (t) => new Map(t.options.map((opt, idx) => [opt, idx]))
      );
      const tierVariation = input.tiers.map((t) => ({
        name: t.name,
        option_list: t.options.map((opt) => ({ option: opt })),
      }));
      const model = input.variants.map((v) => ({
        tier_index: v.tierValues.map((val, tIdx) => optionIndexMaps[tIdx]?.get(val) ?? 0),
        original_price: v.pricePhp,
        model_sku: deterministicSellerSku(v.garmentVariantId, v.skuCode),
        seller_stock: [{ stock: Math.max(0, Math.round(v.stock)) }],
      }));

      const tierResp = await shopeePost("/api/v2/product/init_tier_variation", shop.shopId, token, {
        item_id: Number(externalListingId),
        tier_variation: tierVariation,
        model,
      });
      const returnedModels = Array.isArray(tierResp?.model)
        ? (tierResp.model as Array<{ model_id?: unknown; tier_index?: unknown }>)
        : [];
      const skus = mapShopeeModelsToVariants(input.variants, input.tiers, returnedModels);
      return {
        externalListingId,
        status: itemStatus,
        remoteImageUrls,
        skus,
      };
    } catch (err) {
      return {
        externalListingId,
        status: itemStatus,
        remoteImageUrls,
        skus: [],
        partialError: err instanceof Error ? err.message : "Shopee variations couldn't be saved.",
      };
    }
  },
};
