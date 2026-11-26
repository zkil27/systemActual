import crypto from "crypto";
import { decryptSecret } from "@/lib/crypto";
import { fetchWithRetry, readMarketplaceJson, safeReadJson, throwMarketplaceError } from "./http";

export function getShopeeConfig() {
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID?.trim() || "",
    partnerKey: process.env.SHOPEE_PARTNER_KEY?.trim() || "",
    pushPartnerKey: process.env.SHOPEE_PUSH_PARTNER_KEY?.trim() || "",
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
 * Base string: `${webhookUrl}|${rawBody}` keyed with the Push Partner Key
 * (`SHOPEE_PUSH_PARTNER_KEY`, falling back to `SHOPEE_PARTNER_KEY`).
 */
export function verifyShopeeWebhookSignature(params: {
  webhookUrl: string;
  rawBody: string;
  signatureHeader: string | null | undefined;
  partnerKey?: string;
}): boolean {
  if (!params.signatureHeader) return false;
  const cfg = getShopeeConfig();
  const keys =
    params.partnerKey !== undefined
      ? [params.partnerKey].filter(Boolean)
      : [cfg.pushPartnerKey, cfg.partnerKey].filter(Boolean);
  if (keys.length === 0) return false;
  const actual = params.signatureHeader.trim().toLowerCase();
  const base = `${params.webhookUrl}|${params.rawBody}`;
  return keys.some((key) => {
    const expected = crypto.createHmac("sha256", key).update(base).digest("hex");
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
  });
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

export async function exchangeShopeeCode(code: string, shopId: string, fetchFn: typeof fetch = fetch) {
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
  const res = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        shop_id: Number(shopId),
        partner_id: Number(cfg.partnerId),
      }),
      signal: AbortSignal.timeout(15_000),
    },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "Shopee");
  if (!res.ok || data.error) {
    throwMarketplaceError(res, String(data.message || data.error || "Shopee token exchange failed"));
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
  query: Record<string, string | number>,
  fetchFn: typeof fetch = fetch
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const token = decryptSecret(accessToken);
  const cfg = getShopeeConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    path,
    timestamp,
    accessToken: token,
    shopId,
  });
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: token,
    shop_id: shopId,
    sign,
    ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])),
  });
  const res = await fetchWithRetry(
    `${cfg.baseUrl}${path}?${qs.toString()}`,
    { method: "GET", signal: AbortSignal.timeout(15_000) },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "Shopee");
  if (!res.ok || data.error) {
    throwMarketplaceError(res, String(data.message || data.error || `Shopee API error on ${path}`));
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const token = decryptSecret(accessToken);
  const cfg = getShopeeConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    path,
    timestamp,
    accessToken: token,
    shopId,
  });
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: token,
    shop_id: shopId,
    sign,
  });
  const res = await fetchWithRetry(
    `${cfg.baseUrl}${path}?${qs.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "Shopee");
  if (!res.ok || data.error) {
    throwMarketplaceError(res, String(data.message || data.error || `Shopee API error on ${path}`));
  }
  return data.response;
}

/**
 * Signed POST that returns a file (e.g. download_shipping_document). Shopee
 * answers with the PDF on success and with JSON on error.
 */
export async function shopeePostFile(
  path: string,
  shopId: string,
  accessToken: string,
  body: Record<string, unknown>,
  fetchFn: typeof fetch = fetch
): Promise<Buffer> {
  const token = decryptSecret(accessToken);
  const cfg = getShopeeConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signShopeeRequest({
    partnerId: cfg.partnerId,
    partnerKey: cfg.partnerKey,
    path,
    timestamp,
    accessToken: token,
    shopId,
  });
  const qs = new URLSearchParams({
    partner_id: cfg.partnerId,
    timestamp: String(timestamp),
    access_token: token,
    shop_id: shopId,
    sign,
  });
  const res = await fetchWithRetry(
    `${cfg.baseUrl}${path}?${qs.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    },
    { fetchFn }
  );
  const type = res.headers?.get?.("content-type") ?? "";
  if (!res.ok || type.includes("json")) {
    const { json } = await safeReadJson(res);
    throwMarketplaceError(
      res,
      String(json?.message || json?.error || `Shopee couldn't give the file (${res.status})`)
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
