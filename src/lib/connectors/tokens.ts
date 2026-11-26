import crypto from "crypto";
import { Platform, type ShopConnection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { notifyOwnerTelegram } from "@/lib/telegram";
import { fetchWithRetry, readMarketplaceJson, throwMarketplaceError } from "./http";

/**
 * Access-token lifecycle for both platforms.
 *
 * Shopee access tokens last ~4 hours and refresh tokens ~30 days; each refresh
 * returns a NEW refresh token. TikTok access tokens last ~7 days. We refresh a
 * little before expiry so a tick never calls an API with a dead token. When the
 * warehouse PC sleeps overnight the access token may already be expired by
 * morning; that's fine because the refresh token is still valid.
 */
export const REFRESH_MARGIN_MS = 30 * 60_000;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

type FetchFn = typeof fetch;

export function isTokenDue(expiresAt: Date | null, now: Date): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS;
}

/**
 * TikTok's `*_expire_in` fields are absolute Unix timestamps (seconds), not
 * durations. Accept either so a format change can't silently disable refresh.
 */
export function tiktokExpiry(raw: unknown, nowMs: number): Date {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return new Date(nowMs + 24 * 3600_000);
  if (n > 1_000_000_000) return new Date(n * 1000);
  return new Date(nowMs + n * 1000);
}

function shopeeCfg() {
  return {
    partnerId: process.env.SHOPEE_PARTNER_ID?.trim() || "",
    partnerKey: process.env.SHOPEE_PARTNER_KEY?.trim() || "",
    baseUrl: (process.env.SHOPEE_BASE_URL || "https://partner.shopeemobile.com").replace(/\/$/, ""),
  };
}

function tiktokCfg() {
  return {
    appKey: process.env.TIKTOK_APP_KEY?.trim() || "",
    appSecret: process.env.TIKTOK_APP_SECRET?.trim() || "",
    authUrl: (process.env.TIKTOK_AUTH_URL || "https://auth.tiktok-shops.com").replace(/\/$/, ""),
  };
}

export async function refreshShopeeTokens(
  refreshToken: string,
  shopId: string,
  fetchFn: FetchFn = fetch,
  now: Date = new Date()
): Promise<TokenSet> {
  const cfg = shopeeCfg();
  const path = "/api/v2/auth/access_token/get";
  const timestamp = Math.floor(now.getTime() / 1000);
  const sign = crypto
    .createHmac("sha256", cfg.partnerKey)
    .update(`${cfg.partnerId}${path}${timestamp}`)
    .digest("hex");
  const res = await fetchWithRetry(
    `${cfg.baseUrl}${path}?partner_id=${cfg.partnerId}&timestamp=${timestamp}&sign=${sign}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refresh_token: refreshToken,
        partner_id: Number(cfg.partnerId),
        shop_id: Number(shopId),
      }),
      signal: AbortSignal.timeout(15_000),
    },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "Shopee");
  if (!res.ok || data.error || !data.access_token) {
    throwMarketplaceError(res, String(data.message || data.error || "Shopee token refresh failed"));
  }
  return {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || refreshToken),
    expiresAt: new Date(now.getTime() + Number(data.expire_in || 14400) * 1000),
  };
}

export async function refreshTikTokTokens(
  refreshToken: string,
  fetchFn: FetchFn = fetch,
  now: Date = new Date()
): Promise<TokenSet> {
  const cfg = tiktokCfg();
  const qs = new URLSearchParams({
    app_key: cfg.appKey,
    app_secret: cfg.appSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetchWithRetry(
    `${cfg.authUrl}/api/v2/token/refresh?${qs.toString()}`,
    { method: "GET", signal: AbortSignal.timeout(15_000) },
    { fetchFn }
  );
  const data = await readMarketplaceJson(res, "TikTok");
  const payload = (data.data ?? {}) as Record<string, unknown>;
  if (!res.ok || data.code !== 0 || !payload.access_token) {
    throwMarketplaceError(res, String(data.message || "TikTok token refresh failed"));
  }
  return {
    accessToken: String(payload.access_token),
    refreshToken: String(payload.refresh_token || refreshToken),
    expiresAt: tiktokExpiry(payload.access_token_expire_in, now.getTime()),
  };
}

type TokenConn = Pick<
  ShopConnection,
  "id" | "platform" | "shopId" | "shopName" | "accessToken" | "refreshToken" | "tokenExpiresAt" | "tokenErrorAt"
>;

export interface TokenDeps {
  now: Date;
  refresh: (conn: TokenConn) => Promise<TokenSet>;
  /** Saves only if the stored refresh token is still `previousRefreshToken`. Returns false if another tick won. */
  save: (conn: TokenConn, previousRefreshToken: string, tokens: TokenSet) => Promise<boolean>;
  reload: (id: string) => Promise<TokenConn | null>;
  markError: (conn: TokenConn, message: string) => Promise<void>;
  alert: (text: string) => Promise<unknown>;
}

/**
 * Returns a usable access token, refreshing first if it's about to expire.
 * Throws if the shop must be reconnected. Alerts the owner once per outage.
 */
export async function ensureFreshTokenWith(conn: TokenConn, deps: TokenDeps): Promise<string> {
  if (!conn.accessToken || !conn.refreshToken) {
    throw new Error(`${conn.shopName} is not connected.`);
  }
  const plainAccess = decryptSecret(conn.accessToken);
  const plainRefresh = decryptSecret(conn.refreshToken);
  if (!isTokenDue(conn.tokenExpiresAt, deps.now)) return plainAccess;

  // Keep raw stored refreshToken for optimistic concurrency match in DB,
  // while passing plaintext refreshToken to the platform refresh endpoint.
  const previousStored = conn.refreshToken;
  const plainConn: TokenConn = { ...conn, accessToken: plainAccess, refreshToken: plainRefresh };
  let tokens: TokenSet;
  try {
    tokens = await deps.refresh(plainConn);
  } catch (err) {
    // A parallel tick may have refreshed (and rotated the refresh token) first.
    const latest = await deps.reload(conn.id);
    if (
      latest?.accessToken &&
      latest.refreshToken !== previousStored &&
      !isTokenDue(latest.tokenExpiresAt, deps.now)
    ) {
      return decryptSecret(latest.accessToken);
    }
    const message = err instanceof Error ? err.message : String(err);
    await deps.markError(conn, message);
    if (!conn.tokenErrorAt) {
      await deps.alert(
        `${conn.shopName}: the connection stopped working (${message}). Open Settings and tap the store to reconnect.`
      );
    }
    throw err;
  }

  const saved = await deps.save(conn, previousStored, tokens);
  if (!saved) {
    const latest = await deps.reload(conn.id);
    if (latest?.accessToken) return decryptSecret(latest.accessToken);
  }
  return tokens.accessToken;
}

const prismaTokenDeps = (now: Date): TokenDeps => ({
  now,
  refresh: (conn) =>
    conn.platform === Platform.SHOPEE
      ? refreshShopeeTokens(decryptSecret(conn.refreshToken!), conn.shopId, fetch, now)
      : refreshTikTokTokens(decryptSecret(conn.refreshToken!), fetch, now),
  save: async (conn, previousRefreshToken, tokens) => {
    const result = await prisma.shopConnection.updateMany({
      where: { id: conn.id, refreshToken: previousRefreshToken },
      data: {
        accessToken: encryptSecret(tokens.accessToken),
        refreshToken: encryptSecret(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        tokenErrorAt: null,
        tokenError: null,
      },
    });
    return result.count === 1;
  },
  reload: (id) => prisma.shopConnection.findUnique({ where: { id } }),
  markError: async (conn, message) => {
    await prisma.shopConnection.update({
      where: { id: conn.id },
      data: { tokenErrorAt: conn.tokenErrorAt ?? now, tokenError: message.slice(0, 300) },
    });
  },
  alert: (text) => notifyOwnerTelegram(text),
});

export async function ensureFreshToken(conn: TokenConn): Promise<string> {
  return ensureFreshTokenWith(conn, prismaTokenDeps(new Date()));
}
