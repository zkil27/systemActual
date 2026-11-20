import crypto from "crypto";
import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyReturnCategory, upsertNormalizedReturn } from "./normalizer";

export function getShopeeConfig() {
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID?.trim() || "",
    partnerKey: process.env.SHOPEE_PARTNER_KEY?.trim() || "",
    baseUrl: (process.env.SHOPEE_BASE_URL || "https://partner.shopeemobile.com").replace(/\/$/, ""),
    appBaseUrl: (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, ""),
  };
}

export function isShopeeConfigured(): boolean {
  const cfg = getShopeeConfig();
  return Boolean(cfg.partnerId && cfg.partnerKey);
}

/**
 * Shopee Open Platform v2 HMAC-SHA256 signature.
 * Base string: `${partnerId}${path}${timestamp}${accessToken}${shopId}`
 */
export function signShopeeRequest(params: {
  partnerId: string;
  partnerKey: string;
  path: string;
  timestamp: number;
  accessToken?: string;
  shopId?: string;
}): string {
  const baseString = `${params.partnerId}${params.path}${params.timestamp}${params.accessToken ?? ""}${params.shopId ?? ""}`;
  return crypto
    .createHmac("sha256", params.partnerKey)
    .update(baseString)
    .digest("hex");
}

/**
 * Shopee Push Mechanism (Webhook) signature verification.
 * Base string: `${webhookUrl}|${rawBody}` keyed with partnerKey.
 */
export function verifyShopeeWebhookSignature(params: {
  webhookUrl: string;
  rawBody: string;
  signatureHeader: string | null | undefined;
  partnerKey?: string;
}): boolean {
  const key = params.partnerKey ?? getShopeeConfig().partnerKey;
  if (!key || !params.signatureHeader) return false;
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${params.webhookUrl}|${params.rawBody}`)
    .digest("hex");
  const actual = params.signatureHeader.trim().toLowerCase();
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

/**
 * The URL Shopee signs is the push URL registered in the Open Platform console,
 * which may differ from req.url behind Vercel's proxy. Prefer APP_BASE_URL.
 */
export function shopeeWebhookUrl(requestUrl: string): string {
  const base = process.env.APP_BASE_URL?.trim().replace(/\/$/, "");
  if (!base) return requestUrl;
  return `${base}/api/webhooks/shopee`;
}

export function buildShopeeAuthUrl(): string {
  const cfg = getShopeeConfig();
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    path,
    timestamp,
  });
  const redirect = encodeURIComponent(`${cfg.appBaseUrl}/api/oauth/shopee/callback`);
  return `${cfg.baseUrl}${path}?partner_id=${cfg.partnerId}&timestamp=${timestamp}&sign=${sign}&redirect=${redirect}`;
}

export async function exchangeShopeeCode(code: string, shopId: string) {
  const cfg = getShopeeConfig();
  const path = "/api/v2/auth/token/get";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    path,
    timestamp,
  });

  const url = `${cfg.baseUrl}${path}?partner_id=${cfg.partnerId}&timestamp=${timestamp}&sign=${sign}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      shop_id: Number(shopId),
      partner_id: Number(cfg.partnerId),
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.message || data.error || "Shopee token exchange failed");
  }
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    expiresIn: Number(data.expire_in || 14400),
  };
}

async function shopeeGet(
  path: string,
  shopId: string,
  accessToken: string,
  query: Record<string, string | number>
) {
  const cfg = getShopeeConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    path,
    timestamp,
    accessToken,
    shopId,
  });
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: accessToken,
    shop_id: shopId,
    sign,
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  });
  const res = await fetch(`${cfg.baseUrl}${path}?${qs.toString()}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.message || data.error || `Shopee API error on ${path}`);
  }
  return data.response;
}

/**
 * Syncs recent buyer return/refund requests and TO_RETURN failed deliveries
 * from a live Shopee Open Platform connection.
 */
export async function syncShopeeConnection(connectionId: string): Promise<{ synced: number }> {
  const conn = await prisma.shopConnection.findUnique({ where: { id: connectionId } });
  if (!conn || conn.platform !== Platform.SHOPEE || !conn.accessToken || conn.isDemo) {
    return { synced: 0 };
  }

  let synced = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const sevenDaysAgoSec = nowSec - 7 * 24 * 60 * 60;

  // 1. Buyer Return / Refund list (v2.returns.get_return_list) — paginated for 400-2,000+/day shops
  try {
    for (let pageNo = 0; pageNo < 10; pageNo++) {
      const returnResp = await shopeeGet(
        "/api/v2/returns/get_return_list",
        conn.shopId,
        conn.accessToken,
        {
          page_no: pageNo,
          page_size: 100,
          update_time_from: sevenDaysAgoSec,
          update_time_to: nowSec,
        }
      );
      const items = Array.isArray(returnResp?.return) ? returnResp.return : [];
      for (const r of items) {
        const firstItem = Array.isArray(r.item) ? r.item[0] : null;
        const status = String(r.status || "REQUESTED");
        const taggedAt = r.create_time ? new Date(Number(r.create_time) * 1000) : new Date();
        const isCourierReturned =
          status === "REFUND_PAID" || status === "ACCEPTED" || status === "COMPLETED";

        await upsertNormalizedReturn({
          shopConnectionId: conn.id,
          platform: Platform.SHOPEE,
          orderSn: String(r.order_sn),
          returnSn: String(r.return_sn),
          forwardTrackingNumber: r.tracking_number ? String(r.tracking_number) : null,
          rtsTrackingNumber: r.return_tracking_number ? String(r.return_tracking_number) : null,
          courier: String(r.logistics_channel || "SPX Express"),
          category: classifyReturnCategory({
            platform: Platform.SHOPEE,
            hasBuyerReturnSn: true,
            rawStatus: status,
            reason: r.reason ? String(r.reason) : null,
          }),
          digitalStatus: isCourierReturned
            ? DigitalStatus.COURIER_RETURNED
            : DigitalStatus.RETURN_REQUESTED,
          returnReason: r.reason ? String(r.reason) : "Buyer return request",
          disputeDeadlineAt: r.due_date ? new Date(Number(r.due_date) * 1000) : null,
          itemSummary: firstItem?.name ? String(firstItem.name) : "Shopee Fashion Item",
          variationName: firstItem?.model_name ? String(firstItem.model_name) : null,
          quantity: Number(firstItem?.amount || 1),
          itemImageUrl: Array.isArray(firstItem?.images) ? String(firstItem.images[0] || "") : null,
          orderTotalPhp: Number(r.refund_amount || 199),
          digitalReturnTaggedAt: taggedAt,
          courierReturnedToSellerAt: isCourierReturned ? new Date(Number(r.update_time || nowSec) * 1000) : null,
          source: "SHOPEE_POLL",
          rawStatus: status,
          eventDescription: r.text_reason ? String(r.text_reason) : status,
          eventTimestamp: r.update_time ? new Date(Number(r.update_time) * 1000) : taggedAt,
          rawPayloadJson: r,
        });
        synced++;
      }
      if (!returnResp?.more || items.length < 100) break;
    }
  } catch (err) {
    console.error("[Shopee sync returns error]", err);
  }

  // 2. Failed delivery / TO_RETURN orders — cursor paginated (up to 1,000 orders per sync)
  try {
    let cursor = "";
    const allOrderSns: string[] = [];
    for (let page = 0; page < 10; page++) {
      const orderListResp = await shopeeGet(
        "/api/v2/order/get_order_list",
        conn.shopId,
        conn.accessToken,
        {
          time_range_field: "update_time",
          time_from: sevenDaysAgoSec,
          time_to: nowSec,
          page_size: 100,
          order_status: "TO_RETURN",
          ...(cursor ? { cursor } : {}),
        }
      );
      const batchSns: string[] = (orderListResp?.order_list ?? []).map((o: { order_sn: string }) =>
        String(o.order_sn)
      );
      allOrderSns.push(...batchSns);
      if (!orderListResp?.more || !orderListResp?.next_cursor || batchSns.length === 0) break;
      cursor = String(orderListResp.next_cursor);
    }

    for (let offset = 0; offset < allOrderSns.length; offset += 50) {
      const chunk = allOrderSns.slice(offset, offset + 50);
      const detailResp = await shopeeGet(
        "/api/v2/order/get_order_detail",
        conn.shopId,
        conn.accessToken,
        {
          order_sn_list: chunk.join(","),
          response_optional_fields: "item_list,package_list,total_amount,shipping_carrier",
        }
      );
      for (const order of detailResp?.order_list ?? []) {
        const firstItem = Array.isArray(order.item_list) ? order.item_list[0] : null;
        const pkg = Array.isArray(order.package_list) ? order.package_list[0] : null;
        const updateTime = order.update_time
          ? new Date(Number(order.update_time) * 1000)
          : new Date();
        let taggedAt = updateTime;
        let courierReturnedAt: Date | null = null;
        let digitalStatus: DigitalStatus = DigitalStatus.FAILED_DELIVERY_TAGGED;

        try {
          const track = await shopeeGet(
            "/api/v2/logistics/get_tracking_info",
            conn.shopId,
            conn.accessToken,
            {
              order_sn: String(order.order_sn),
              ...(pkg?.package_number ? { package_number: String(pkg.package_number) } : {}),
            }
          );
          const checkpoints = Array.isArray(track?.tracking_info) ? track.tracking_info : [];
          for (const cp of checkpoints) {
            const desc = String(cp.description || "").toLowerCase();
            const cpTime = cp.update_time ? new Date(Number(cp.update_time) * 1000) : updateTime;
            if (desc.includes("delivery failed") || desc.includes("returning to seller")) {
              taggedAt = cpTime;
              digitalStatus = DigitalStatus.RETURNING_TO_SELLER;
            }
            if (desc.includes("returned to seller") || desc.includes("delivered back")) {
              courierReturnedAt = cpTime;
              digitalStatus = DigitalStatus.COURIER_RETURNED;
            }
          }
        } catch {
          // Tracking info may not be initialized yet for newly tagged parcels
        }

        await upsertNormalizedReturn({
          shopConnectionId: conn.id,
          platform: Platform.SHOPEE,
          orderSn: String(order.order_sn),
          forwardTrackingNumber: pkg?.tracking_number ? String(pkg.tracking_number) : null,
          courier: String(order.shipping_carrier || pkg?.shipping_carrier || "SPX Express"),
          category: ReturnCategory.FAILED_DELIVERY,
          digitalStatus,
          returnReason: "Failed Delivery (COD / Undelivered)",
          itemSummary: firstItem?.item_name ? String(firstItem.item_name) : "Shopee Fashion Item",
          variationName: firstItem?.model_name ? String(firstItem.model_name) : null,
          quantity: Number(firstItem?.model_quantity_purchased || 1),
          itemImageUrl: firstItem?.image_info?.image_url
            ? String(firstItem.image_info.image_url)
            : null,
          orderTotalPhp: Number(order.total_amount || 199),
          orderCreatedAt: order.create_time ? new Date(Number(order.create_time) * 1000) : null,
          digitalReturnTaggedAt: taggedAt,
          courierReturnedToSellerAt: courierReturnedAt,
          source: "SHOPEE_POLL",
          rawStatus: String(order.order_status || "TO_RETURN"),
          eventDescription: "Synced via Shopee Open Platform",
          eventTimestamp: courierReturnedAt ?? taggedAt,
          rawPayloadJson: order,
        });
        synced++;
      }
    }
  } catch (err) {
    console.error("[Shopee sync failed deliveries error]", err);
  }

  await prisma.shopConnection.update({
    where: { id: conn.id },
    data: { lastSyncedAt: new Date() },
  });

  return { synced };
}
