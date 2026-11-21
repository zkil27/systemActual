import crypto from "crypto";

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

/** Shopee has no state parameter, but it keeps our query string on the redirect. */
export function buildShopeeAuthUrl(state: string): string {
  const cfg = getShopeeConfig();
  const path = "/api/v2/shop/auth_partner";
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    path,
    timestamp,
  });
  const redirect = encodeURIComponent(
    `${cfg.appBaseUrl}/api/oauth/shopee/callback?state=${encodeURIComponent(state)}`
  );
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

export async function shopeeGet(
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
  const res = await fetch(`${cfg.baseUrl}${path}?${qs.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.message || data.error || `Shopee API error on ${path}`);
  }
  return data.response;
}

/** Signed Shopee shop-level POST (JSON body, common params in the query). */
export async function shopeePost(
  path: string,
  shopId: string,
  accessToken: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch = fetch
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
  });
  const res = await fetchFn(`${cfg.baseUrl}${path}?${qs.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.message || data.error || `Shopee API error on ${path}`);
  }
  return data.response;
}
