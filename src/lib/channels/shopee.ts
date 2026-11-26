import { Platform } from "@prisma/client";
import { isShopeeConfigured, shopeeGet, shopeePost } from "@/lib/connectors/shopee";
import { refreshShopeeTokens } from "@/lib/connectors/tokens";
import { mapShopeeEscrow } from "@/lib/finance/map";
import { mapShopeeOrder } from "@/lib/ledger/normalize";
import type { ChannelConnector, StockPushResult } from "./types";

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
    const catId = Number(draft.categoryId);
    if (!draft.categoryId || !Number.isFinite(catId) || catId <= 0) {
      throw new Error("Enter a numeric Shopee category ID before creating a draft listing.");
    }
    const resp = await shopeePost("/api/v2/product/add_item", shop.shopId, token, {
      item_name: draft.title.slice(0, 120),
      description: (draft.description || draft.title).slice(0, 3000),
      category_id: catId,
      original_price: draft.pricePhp,
      normal_stock: Math.max(0, Math.round(draft.stock)),
      item_status: "UNLIST",
      weight: 0.3,
    });
    return {
      externalListingId: String(resp?.item_id ?? ""),
      status: "UNLIST",
    };
  },
};
