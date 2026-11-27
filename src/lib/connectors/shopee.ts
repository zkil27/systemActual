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

/**
 * Token exchange for Shopee Main Account OAuth callbacks, which return
 * `main_account_id` instead of `shop_id` and respond with `shop_id_list`.
 */
export async function exchangeShopeeMainAccountCode(
  code: string,
  mainAccountId: string,
  fetchFn: typeof fetch = fetch
) {
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
        main_account_id: Number(mainAccountId),
        partner_id: Number(cfg.partnerId),
      }),
      signal: AbortSignal.timeout(15_000),
    },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "Shopee");
  if (!res.ok || data.error || !data.access_token) {
    throwMarketplaceError(res, String(data.message || data.error || "Shopee token exchange failed"));
  }
  const rawList = Array.isArray(data.shop_id_list) ? data.shop_id_list : [];
  const shopIds = rawList
    .map((id) => String(id ?? "").trim())
    .filter((id) => id.length > 0);
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    expiresIn: Number(data.expire_in || 14400),
    shopIds,
  };
}

/**
 * Fetches basic shop profile (`shop_name`, `region`). Shopee returns these
 * fields at the root of the JSON payload (not nested inside `response`).
 */
export async function getShopeeShopInfo(
  shopId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch
): Promise<{ shopId: string; shopName: string; region: string }> {
  const token = decryptSecret(accessToken);
  const cfg = getShopeeConfig();
  const path = "/api/v2/shop/get_shop_info";
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
    { method: "GET", signal: AbortSignal.timeout(15_000) },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "Shopee");
  if (!res.ok || data.error) {
    throwMarketplaceError(res, String(data.message || data.error || `Shopee API error on ${path}`));
  }
  const body = (data.response && typeof data.response === "object" ? data.response : data) as Record<
    string,
    unknown
  >;
  return {
    shopId,
    shopName: String(body.shop_name || "").trim(),
    region: String(body.region || "").trim().toUpperCase(),
  };
}

/**
 * Picks the primary shop to connect from a Shopee Main Account's `shop_id_list`.
 * Prefers `preferredRegion` (PH by default, matching PHP currency in Kyna Ops)
 * and falls back to the first shop if region info is unavailable.
 */
export async function resolveShopeeMainAccountShop(
  shopIds: string[],
  accessToken: string,
  fetchFn: typeof fetch = fetch,
  preferredRegion = "PH"
): Promise<{ shopId: string; shopName: string; region: string } | null> {
  if (shopIds.length === 0) return null;
  const target = preferredRegion.toUpperCase();
  const infos = await Promise.all(
    shopIds.map(async (shopId) => {
      try {
        return await getShopeeShopInfo(shopId, accessToken, fetchFn);
      } catch {
        return { shopId, shopName: "", region: "" };
      }
    })
  );
  const match = infos.find((s) => s.region === target) ?? infos[0];
  return {
    shopId: match.shopId,
    shopName: match.shopName || `Shopee Store #${match.shopId}`,
    region: match.region,
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
 * Signed Shopee shop-level POST with a pre-serialized raw JSON body.
 * Required for Seller Chat endpoints that expect 64-bit integer IDs
 * (`conversation_id`, `to_id`) larger than JS `Number.MAX_SAFE_INTEGER`.
 */
export async function shopeePostRaw(
  path: string,
  shopId: string,
  accessToken: string,
  rawJsonBody: string,
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
      body: rawJsonBody,
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
 * Signed Shopee Seller Chat image upload (`POST /api/v2/sellerchat/upload_image`).
 */
export async function shopeeUploadChatImage(
  shopId: string,
  accessToken: string,
  file: Blob,
  fileName: string,
  fetchFn: typeof fetch = fetch
): Promise<{ url: string }> {
  const token = decryptSecret(accessToken);
  const cfg = getShopeeConfig();
  const path = "/api/v2/sellerchat/upload_image";
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
  const form = new FormData();
  form.append("file", file, fileName);

  const res = await fetchWithRetry(
    `${cfg.baseUrl}${path}?${qs.toString()}`,
    { method: "POST", body: form, signal: AbortSignal.timeout(30_000) },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "Shopee");
  if (!res.ok || data.error) {
    throwMarketplaceError(res, String(data.message || data.error || "Shopee chat image upload failed"));
  }
  const resp = data.response as Record<string, unknown> | undefined;
  const url = typeof resp?.url === "string" ? resp.url.trim() : "";
  if (!url) {
    throw new Error("Shopee didn't return the uploaded photo.");
  }
  return { url };
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

/**
 * Signed Shopee Media Space image upload (multipart/form-data).
 * Shop-level HMAC-SHA256 signs `${partnerId}${path}${timestamp}${accessToken}${shopId}`.
 */
export async function shopeeUploadImage(
  shopId: string,
  accessToken: string,
  file: Blob,
  fileName: string,
  scene: "normal" | "desc" = "normal",
  fetchFn: typeof fetch = fetch
): Promise<{ imageId: string; imageUrl: string }> {
  const token = decryptSecret(accessToken);
  const cfg = getShopeeConfig();
  const path = "/api/v2/media_space/upload_image";
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
  const form = new FormData();
  form.append("image", file, fileName);
  form.append("scene", scene);

  const res = await fetchWithRetry(
    `${cfg.baseUrl}${path}?${qs.toString()}`,
    { method: "POST", body: form, signal: AbortSignal.timeout(30_000) },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "Shopee");
  if (!res.ok || data.error) {
    throwMarketplaceError(res, String(data.message || data.error || "Shopee image upload failed"));
  }
  const info = (data.response as Record<string, unknown> | undefined)?.image_info as
    | Record<string, unknown>
    | undefined;
  const imageId = info?.image_id ? String(info.image_id) : "";
  if (!imageId) {
    throw new Error("Shopee didn't return an image ID.");
  }
  return {
    imageId,
    imageUrl: info?.image_url ? String(info.image_url) : "",
  };
}
