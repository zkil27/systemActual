import { Platform } from "@prisma/client";
import { isTikTokConfigured, tiktokRequest } from "@/lib/connectors/tiktok";
import { refreshTikTokTokens } from "@/lib/connectors/tokens";
import { mapTikTokOrderStatements } from "@/lib/finance/map";
import { mapTikTokOrder } from "@/lib/ledger/normalize";
import type { ChannelConnector, StockPushResult } from "./types";

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
    if (!shop.shopCipher) {
      throw new Error("Reconnect TikTok (missing shop cipher).");
    }
    if (!draft.categoryId.trim()) {
      throw new Error("Enter a TikTok category ID before creating a draft listing.");
    }
    const data = await tiktokRequest({
      method: "POST",
      path: "/product/202309/products",
      accessToken: token,
      shopCipher: shop.shopCipher,
      body: {
        save_mode: "AS_DRAFT",
        title: draft.title.slice(0, 255),
        description: draft.description || draft.title,
        category_id: draft.categoryId.trim(),
        skus: draft.variants.map((v) => ({
          seller_sku: v.label.slice(0, 50),
          price: { amount: v.pricePhp.toFixed(2), currency: "PHP" },
          inventory: [{ quantity: Math.max(0, Math.round(v.stock)) }],
        })),
      },
    });
    return {
      externalListingId: String(data?.product_id ?? ""),
      status: "DRAFT",
    };
  },
};
