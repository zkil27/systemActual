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
};
