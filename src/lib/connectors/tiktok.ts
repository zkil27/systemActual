import crypto from "crypto";
import { decryptSecret } from "@/lib/crypto";
import { fetchWithRetry, readMarketplaceJson, throwMarketplaceError } from "./http";
import { tiktokExpiry } from "./tokens";

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
  return Boolean(cfg.appKey && cfg.appSecret && process.env.TIKTOK_SERVICE_ID?.trim());
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

/** Rest-of-world seller authorization link (PH). service_id is on the app page in Partner Center. */
export function buildTikTokAuthUrl(state: string): string {
  const serviceId = process.env.TIKTOK_SERVICE_ID?.trim() || "";
  const base = (process.env.TIKTOK_SELLER_AUTH_URL || "https://services.tiktokshop.com/open/authorize").replace(/\/$/, "");
  return `${base}?service_id=${encodeURIComponent(serviceId)}&state=${encodeURIComponent(state)}`;
}

export async function exchangeTikTokCode(code: string, fetchFn: typeof fetch = fetch) {
  const cfg = getTikTokConfig();
  const url = `${cfg.authUrl}/api/v2/token/get?app_key=${encodeURIComponent(cfg.appKey)}&app_secret=${encodeURIComponent(cfg.appSecret)}&auth_code=${encodeURIComponent(code)}&grant_type=authorized_code`;
  const res = await fetchWithRetry(url, { method: "GET", signal: AbortSignal.timeout(15_000) }, { fetchFn });
  const data = await readMarketplaceJson(res, "TikTok");
  const payload = (data.data ?? {}) as Record<string, unknown>;
  if (!res.ok || data.code !== 0) {
    throwMarketplaceError(res, String(data.message || "TikTok token exchange failed"));
  }
  return {
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token),
    // access_token_expire_in is an absolute Unix timestamp, not a duration.
    expiresAt: tiktokExpiry(payload.access_token_expire_in, Date.now()),
    sellerName: String(payload.seller_name || "TikTok Shop PH"),
  };
}

/**
 * Signed TikTok Shop API request. `shopCipher` is required for shop-scoped
 * endpoints and must be omitted for the authorization endpoints.
 */
export async function tiktokRequest(opts: {
  method: "GET" | "POST" | "PUT";
  path: string;
  accessToken: string;
  shopCipher?: string | null;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  fetchFn?: typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any> {
  const cfg = getTikTokConfig();
  const accessToken = decryptSecret(opts.accessToken);
  const shopCipher = opts.shopCipher ? decryptSecret(opts.shopCipher) : null;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = opts.body ? JSON.stringify(opts.body) : undefined;
  const query: Record<string, string> = {
    app_key: cfg.appKey,
    timestamp,
    ...(shopCipher ? { shop_cipher: shopCipher } : {}),
    ...(opts.query ?? {}),
  };
  const sign = signTikTokRequest({ appSecret: cfg.appSecret, path: opts.path, query, rawBody });
  const qs = new URLSearchParams({ ...query, sign });
  const res = await fetchWithRetry(
    `${cfg.apiBaseUrl}${opts.path}?${qs.toString()}`,
    {
      method: opts.method,
      headers: {
        ...(rawBody ? { "Content-Type": "application/json" } : {}),
        "x-tts-access-token": accessToken,
      },
      body: rawBody,
      signal: AbortSignal.timeout(15_000),
    },
    { fetchFn: opts.fetchFn }
  );
  const data = await readMarketplaceJson(res, "TikTok");
  if (!res.ok || data.code !== 0) {
    throwMarketplaceError(res, String(data.message || `TikTok API error on ${opts.path}`));
  }
  return data.data;
}

/**
 * Signed TikTok Shop file upload (multipart/form-data). For uploads TikTok
 * signs the path and query only, not the file body.
 */
export async function tiktokUploadRequest(opts: {
  path: string;
  accessToken: string;
  shopCipher?: string | null;
  field: string;
  file: Blob;
  fileName: string;
  query?: Record<string, string>;
  fetchFn?: typeof fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): Promise<any> {
  const cfg = getTikTokConfig();
  const accessToken = decryptSecret(opts.accessToken);
  const shopCipher = opts.shopCipher ? decryptSecret(opts.shopCipher) : null;
  const query: Record<string, string> = {
    app_key: cfg.appKey,
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(shopCipher ? { shop_cipher: shopCipher } : {}),
    ...(opts.query ?? {}),
  };
  const sign = signTikTokRequest({ appSecret: cfg.appSecret, path: opts.path, query });
  const form = new FormData();
  form.append(opts.field, opts.file, opts.fileName);
  const res = await fetchWithRetry(
    `${cfg.apiBaseUrl}${opts.path}?${new URLSearchParams({ ...query, sign }).toString()}`,
    { method: "POST", headers: { "x-tts-access-token": accessToken }, body: form, signal: AbortSignal.timeout(30_000) },
    { fetchFn: opts.fetchFn }
  );
  const data = await readMarketplaceJson(res, "TikTok");
  if (!res.ok || data.code !== 0) {
    throwMarketplaceError(res, String(data.message || `TikTok API error on ${opts.path}`));
  }
  return data.data;
}

export interface AuthorizedShop {
  id: string;
  name: string;
  region: string;
  cipher: string;
}

/** Real shop_id and shop_cipher for every shop the seller authorized. */
export async function getAuthorizedShops(
  accessToken: string,
  fetchFn?: typeof fetch
): Promise<AuthorizedShop[]> {
  const data = await tiktokRequest({
    method: "GET",
    path: "/authorization/202309/shops",
    accessToken,
    fetchFn,
  });
  const shops: unknown[] = Array.isArray(data?.shops) ? data.shops : [];
  return shops
    .map((s) => s as Record<string, unknown>)
    .filter((s) => s.id && s.cipher)
    .map((s) => ({
      id: String(s.id),
      name: String(s.name || "TikTok Shop"),
      region: String(s.region || ""),
      cipher: String(s.cipher),
    }));
}
