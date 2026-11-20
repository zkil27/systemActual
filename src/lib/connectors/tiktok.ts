import crypto from "crypto";
import { DigitalStatus, Platform, ReturnCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { classifyReturnCategory, upsertNormalizedReturn } from "./normalizer";

export function getTikTokConfig() {
  return {
    appKey: process.env.TIKTOK_APP_KEY?.trim() || "",
    appSecret: process.env.TIKTOK_APP_SECRET?.trim() || "",
    authUrl: (process.env.TIKTOK_AUTH_URL || "https://auth.tiktok-shops.com").replace(/\/$/, ""),
    apiBaseUrl: (process.env.TIKTOK_API_BASE_URL || "https://open-api.tiktokglobalshop.com").replace(/\/$/, ""),
  };
}

export function isTikTokConfigured(): boolean {
  const cfg = getTikTokConfig();
  return Boolean(cfg.appKey && cfg.appSecret);
}

/**
 * TikTok Shop Open API v202309+ request signature.
 * Sorts query params (excluding sign & access_token), wraps `${path}${sortedParams}${rawBody}` with appSecret.
 */
export function signTikTokRequest(params: {
  appSecret: string;
  path: string;
  query: Record<string, string>;
  rawBody?: string;
}): string {
  const sortedKeys = Object.keys(params.query)
    .filter((k) => k !== "sign" && k !== "access_token")
    .sort();
  const joinedParams = sortedKeys.map((k) => `${k}${params.query[k]}`).join("");
  const input = `${params.appSecret}${params.path}${joinedParams}${params.rawBody ?? ""}${params.appSecret}`;
  return crypto
    .createHmac("sha256", params.appSecret)
    .update(input)
    .digest("hex");
}

/**
 * TikTok Shop Webhook verification.
 * Authorization header carries lowercase hex HMAC-SHA256 of `${appKey}${rawBody}` keyed with appSecret.
 */
export function verifyTikTokWebhookSignature(params: {
  rawBody: string;
  authorizationHeader: string | null | undefined;
  appKey?: string;
  appSecret?: string;
}): boolean {
  const cfg = getTikTokConfig();
  const appKey = params.appKey ?? cfg.appKey;
  const appSecret = params.appSecret ?? cfg.appSecret;
  if (!appKey || !appSecret || !params.authorizationHeader) return false;

  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(`${appKey}${params.rawBody}`)
    .digest("hex");
  const actual = params.authorizationHeader.replace(/^Bearer\s+/i, "").trim().toLowerCase();
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export function buildTikTokAuthUrl(): string {
  const cfg = getTikTokConfig();
  return `${cfg.authUrl}/oauth/authorize?app_key=${encodeURIComponent(cfg.appKey)}&state=kyna_ops_ph`;
}

export async function exchangeTikTokCode(code: string) {
  const cfg = getTikTokConfig();
  const url = `${cfg.authUrl}/api/v2/token/get?app_key=${encodeURIComponent(cfg.appKey)}&app_secret=${encodeURIComponent(cfg.appSecret)}&auth_code=${encodeURIComponent(code)}&grant_type=authorized_code`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.code !== 0) {
    throw new Error(data.message || "TikTok token exchange failed");
  }
  return {
    accessToken: String(data.data.access_token),
    refreshToken: String(data.data.refresh_token),
    expiresIn: Number(data.data.access_token_expire_in || 604800),
    sellerName: String(data.data.seller_name || "TikTok Shop PH"),
  };
}

async function tiktokPost(
  path: string,
  accessToken: string,
  shopCipher: string,
  bodyObj: Record<string, unknown>,
  extraQuery?: Record<string, string>
) {
  const cfg = getTikTokConfig();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify(bodyObj);
  const query: Record<string, string> = {
    app_key: cfg.appKey,
    timestamp,
    shop_cipher: shopCipher,
    ...(extraQuery ?? {}),
  };
  const sign = signTikTokRequest({
    appSecret: cfg.appSecret,
    path,
    query,
    rawBody,
  });
  const qs = new URLSearchParams({ ...query, sign });
  const res = await fetch(`${cfg.apiBaseUrl}${path}?${qs.toString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-tts-access-token": accessToken,
    },
    body: rawBody,
  });
  const data = await res.json();
  if (!res.ok || data.code !== 0) {
    throw new Error(data.message || `TikTok API error on ${path}`);
  }
  return data.data;
}

export async function syncTikTokConnection(connectionId: string): Promise<{ synced: number }> {
  const conn = await prisma.shopConnection.findUnique({ where: { id: connectionId } });
  if (
    !conn ||
    conn.platform !== Platform.TIKTOK ||
    !conn.accessToken ||
    !conn.shopCipher ||
    conn.isDemo
  ) {
    return { synced: 0 };
  }

  let synced = 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const sevenDaysAgoSec = nowSec - 7 * 24 * 60 * 60;

  // 1. Returns / Reverse orders — paginated for 400-2,000+/day volume
  try {
    let nextPageToken = "";
    for (let page = 0; page < 15; page++) {
      const returnsData = await tiktokPost(
        "/return_refund/202309/returns/search",
        conn.accessToken,
        conn.shopCipher,
        {
          update_time_ge: sevenDaysAgoSec,
          update_time_lt: nowSec,
        },
        {
          page_size: "50",
          ...(nextPageToken ? { page_token: nextPageToken } : {}),
        }
      );
      const list = Array.isArray(returnsData?.return_orders) ? returnsData.return_orders : [];
      for (const r of list) {
        const item = Array.isArray(r.return_line_items) ? r.return_line_items[0] : null;
        const rawStatus = String(r.return_status || "RETURN_REQUESTED");
        const created = r.create_time ? new Date(Number(r.create_time) * 1000) : new Date();
        const updated = r.update_time ? new Date(Number(r.update_time) * 1000) : created;
        const isReturned = rawStatus.includes("RETURNED") || rawStatus.includes("COMPLETE");

        await upsertNormalizedReturn({
          shopConnectionId: conn.id,
          platform: Platform.TIKTOK,
          orderSn: String(r.order_id),
          returnSn: String(r.return_id),
          rtsTrackingNumber: r.return_tracking_number ? String(r.return_tracking_number) : null,
          courier: String(r.return_provider_name || "J&T Express"),
          category: classifyReturnCategory({
            platform: Platform.TIKTOK,
            hasBuyerReturnSn: true,
            rawStatus,
            reason: r.return_reason_text ? String(r.return_reason_text) : null,
          }),
          digitalStatus: isReturned
            ? DigitalStatus.COURIER_RETURNED
            : DigitalStatus.RETURN_REQUESTED,
          returnReason: r.return_reason_text ? String(r.return_reason_text) : "Buyer Return",
          itemSummary: item?.product_name ? String(item.product_name) : "TikTok Fashion Item",
          variationName: item?.sku_name ? String(item.sku_name) : null,
          quantity: Number(item?.quantity || 1),
          itemImageUrl: item?.product_image?.url ? String(item.product_image.url) : null,
          orderTotalPhp: Number(r.refund_amount?.refund_total || 199),
          digitalReturnTaggedAt: created,
          courierReturnedToSellerAt: isReturned ? updated : null,
          source: "TIKTOK_POLL",
          rawStatus,
          eventDescription: r.return_reason_text ? String(r.return_reason_text) : rawStatus,
          eventTimestamp: updated,
          rawPayloadJson: r,
        });
        synced++;
      }
      if (!returnsData?.next_page_token || list.length === 0) break;
      nextPageToken = String(returnsData.next_page_token);
    }
  } catch (err) {
    console.error("[TikTok sync returns error]", err);
  }

  // 2. Failed delivery / cancelled-in-transit orders — paginated
  try {
    let nextPageToken = "";
    for (let page = 0; page < 15; page++) {
      const ordersData = await tiktokPost(
        "/order/202309/orders/search",
        conn.accessToken,
        conn.shopCipher,
        {
          update_time_ge: sevenDaysAgoSec,
          update_time_lt: nowSec,
        },
        {
          page_size: "100",
          ...(nextPageToken ? { page_token: nextPageToken } : {}),
        }
      );
      const orders = Array.isArray(ordersData?.orders) ? ordersData.orders : [];
      for (const o of orders) {
        const status = String(o.status || "");
        const cancelReason = String(o.cancel_reason || "");
        if (
          !status.includes("FAILED") &&
          !cancelReason.toLowerCase().includes("delivery failed") &&
          !cancelReason.toLowerCase().includes("return")
        ) {
          continue;
        }
        const line = Array.isArray(o.line_items) ? o.line_items[0] : null;
        const updated = o.update_time ? new Date(Number(o.update_time) * 1000) : new Date();
        await upsertNormalizedReturn({
          shopConnectionId: conn.id,
          platform: Platform.TIKTOK,
          orderSn: String(o.id),
          forwardTrackingNumber: o.tracking_number ? String(o.tracking_number) : null,
          courier: String(o.shipping_provider || "J&T Express"),
          category: ReturnCategory.FAILED_DELIVERY,
          digitalStatus: status.includes("RETURNED")
            ? DigitalStatus.COURIER_RETURNED
            : DigitalStatus.RETURNING_TO_SELLER,
          returnReason: cancelReason || "Failed Delivery (COD / Undelivered)",
          itemSummary: line?.product_name ? String(line.product_name) : "TikTok Fashion Item",
          variationName: line?.sku_name ? String(line.sku_name) : null,
          quantity: 1,
          itemImageUrl: line?.sku_image ? String(line.sku_image) : null,
          orderTotalPhp: Number(o.payment?.total_amount || 199),
          orderCreatedAt: o.create_time ? new Date(Number(o.create_time) * 1000) : null,
          digitalReturnTaggedAt: updated,
          courierReturnedToSellerAt: status.includes("RETURNED") ? updated : null,
          source: "TIKTOK_POLL",
          rawStatus: status,
          eventDescription: cancelReason || status,
          eventTimestamp: updated,
          rawPayloadJson: o,
        });
        synced++;
      }
      if (!ordersData?.next_page_token || orders.length === 0) break;
      nextPageToken = String(ordersData.next_page_token);
    }
  } catch (err) {
    console.error("[TikTok sync failed deliveries error]", err);
  }

  await prisma.shopConnection.update({
    where: { id: conn.id },
    data: { lastSyncedAt: new Date() },
  });

  return { synced };
}
