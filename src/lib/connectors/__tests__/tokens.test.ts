import { Platform } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REFRESH_MARGIN_MS,
  ensureFreshTokenWith,
  isTokenDue,
  refreshShopeeTokens,
  refreshTikTokTokens,
  tiktokExpiry,
  type TokenDeps,
  type TokenSet,
} from "@/lib/connectors/tokens";
import { getAuthorizedShops } from "@/lib/connectors/tiktok";

const now = new Date("2026-11-21T02:00:00.000Z");

function jsonFetch(body: unknown, ok = true) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => ({ ok, json: async () => body }) as Response);
}

function baseConn(overrides: Partial<Parameters<typeof ensureFreshTokenWith>[0]> = {}) {
  return {
    id: "c1",
    platform: Platform.SHOPEE,
    shopId: "123",
    shopName: "Shopee PH",
    accessToken: "old-access",
    refreshToken: "old-refresh",
    tokenExpiresAt: new Date(now.getTime() + 10 * 60_000), // due: inside the 30-min margin
    tokenErrorAt: null,
    ...overrides,
  };
}

function deps(overrides: Partial<TokenDeps> = {}): TokenDeps {
  const fresh: TokenSet = {
    accessToken: "new-access",
    refreshToken: "new-refresh",
    expiresAt: new Date(now.getTime() + 4 * 3600_000),
  };
  return {
    now,
    refresh: vi.fn(async () => fresh),
    save: vi.fn(async () => true),
    reload: vi.fn(async () => null),
    markError: vi.fn(async () => {}),
    alert: vi.fn(async () => true),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("SHOPEE_PARTNER_ID", "1001");
  vi.stubEnv("SHOPEE_PARTNER_KEY", "pkey");
  vi.stubEnv("SHOPEE_BASE_URL", "https://partner.test-stable.shopeemobile.com");
  vi.stubEnv("TIKTOK_APP_KEY", "tkey");
  vi.stubEnv("TIKTOK_APP_SECRET", "tsecret");
  vi.stubEnv("TIKTOK_API_BASE_URL", "https://open-api.test");
});
afterEach(() => vi.unstubAllEnvs());

describe("isTokenDue", () => {
  it("refreshes inside the margin and when expiry is unknown", () => {
    expect(isTokenDue(null, now)).toBe(true);
    expect(isTokenDue(new Date(now.getTime() + REFRESH_MARGIN_MS), now)).toBe(true);
    expect(isTokenDue(new Date(now.getTime() + REFRESH_MARGIN_MS + 1), now)).toBe(false);
  });

  it("treats an already-expired token (PC asleep overnight) as due", () => {
    expect(isTokenDue(new Date(now.getTime() - 8 * 3600_000), now)).toBe(true);
  });
});

describe("tiktokExpiry", () => {
  it("reads TikTok's absolute Unix timestamp", () => {
    expect(tiktokExpiry(1795000000, now.getTime()).toISOString()).toBe(new Date(1795000000 * 1000).toISOString());
  });
  it("still handles a duration in seconds", () => {
    expect(tiktokExpiry(3600, now.getTime()).getTime()).toBe(now.getTime() + 3600_000);
  });
});

describe("refreshShopeeTokens", () => {
  it("posts the refresh token to the sandbox URL and maps the response", async () => {
    const fetchFn = jsonFetch({ access_token: "a2", refresh_token: "r2", expire_in: 14400 });
    const tokens = await refreshShopeeTokens("r1", "123", fetchFn, now);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/partner\.test-stable\.shopeemobile\.com\/api\/v2\/auth\/access_token\/get\?partner_id=1001&timestamp=\d+&sign=[0-9a-f]{64}$/);
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "r1", partner_id: 1001, shop_id: 123 });
    expect(tokens).toEqual({ accessToken: "a2", refreshToken: "r2", expiresAt: new Date(now.getTime() + 14400_000) });
  });

  it("throws on a Shopee error body", async () => {
    await expect(refreshShopeeTokens("r1", "123", jsonFetch({ error: "error_auth", message: "invalid refresh_token" }), now)).rejects.toThrow(
      "invalid refresh_token"
    );
  });
});

describe("refreshTikTokTokens", () => {
  it("maps the new tokens and absolute expiry", async () => {
    const fetchFn = jsonFetch({
      code: 0,
      data: { access_token: "ta2", refresh_token: "tr2", access_token_expire_in: 1795000000 },
    });
    const tokens = await refreshTikTokTokens("tr1", fetchFn, now);
    expect(String(fetchFn.mock.calls[0][0])).toContain("grant_type=refresh_token");
    expect(tokens.accessToken).toBe("ta2");
    expect(tokens.refreshToken).toBe("tr2");
    expect(tokens.expiresAt.getTime()).toBe(1795000000 * 1000);
  });
});

describe("ensureFreshTokenWith", () => {
  it("returns the current token without refreshing when not due", async () => {
    const d = deps();
    const token = await ensureFreshTokenWith(baseConn({ tokenExpiresAt: new Date(now.getTime() + 3 * 3600_000) }), d);
    expect(token).toBe("old-access");
    expect(d.refresh).not.toHaveBeenCalled();
  });

  it("refreshes before expiry and saves against the old refresh token", async () => {
    const d = deps();
    const token = await ensureFreshTokenWith(baseConn(), d);
    expect(token).toBe("new-access");
    expect(d.save).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), "old-refresh", expect.objectContaining({ refreshToken: "new-refresh" }));
  });

  it("uses the winner's token when a parallel tick saved first", async () => {
    const d = deps({
      save: vi.fn(async () => false),
      reload: vi.fn(async () => ({ ...baseConn(), accessToken: "winner-access", refreshToken: "winner-refresh" })),
    });
    expect(await ensureFreshTokenWith(baseConn(), d)).toBe("winner-access");
  });

  it("alerts the owner once when refresh fails, and marks the error", async () => {
    const d = deps({ refresh: vi.fn(async () => { throw new Error("refresh_token expired"); }) });
    await expect(ensureFreshTokenWith(baseConn(), d)).rejects.toThrow("refresh_token expired");
    expect(d.markError).toHaveBeenCalledOnce();
    expect(d.alert).toHaveBeenCalledOnce();
    expect(String(vi.mocked(d.alert).mock.calls[0][0])).toContain("reconnect");
  });

  it("does not alert again while the outage continues", async () => {
    const d = deps({ refresh: vi.fn(async () => { throw new Error("still broken"); }) });
    await expect(ensureFreshTokenWith(baseConn({ tokenErrorAt: new Date(now.getTime() - 3600_000) }), d)).rejects.toThrow();
    expect(d.alert).not.toHaveBeenCalled();
  });

  it("does not treat a failure as an outage if another tick already refreshed", async () => {
    const d = deps({
      refresh: vi.fn(async () => { throw new Error("refresh token already used"); }),
      reload: vi.fn(async () => ({
        ...baseConn(),
        accessToken: "winner-access",
        refreshToken: "winner-refresh",
        tokenExpiresAt: new Date(now.getTime() + 4 * 3600_000),
      })),
    });
    expect(await ensureFreshTokenWith(baseConn(), d)).toBe("winner-access");
    expect(d.alert).not.toHaveBeenCalled();
  });

  it("refuses a shop that was never connected", async () => {
    await expect(ensureFreshTokenWith(baseConn({ accessToken: null }), deps())).rejects.toThrow(/not connected/);
  });
});

describe("getAuthorizedShops", () => {
  it("returns the real shop id and cipher, without sending a shop_cipher", async () => {
    const fetchFn = jsonFetch({
      code: 0,
      data: { shops: [{ id: "7494049642642441621", name: "Kyna Clothing PH", region: "PH", cipher: "ROW_abc", code: "PHX" }] },
    });
    const shops = await getAuthorizedShops("access", fetchFn);
    const url = String(fetchFn.mock.calls[0][0]);
    expect(url).toContain("/authorization/202309/shops?");
    expect(url).not.toContain("shop_cipher");
    expect(shops).toEqual([{ id: "7494049642642441621", name: "Kyna Clothing PH", region: "PH", cipher: "ROW_abc" }]);
  });
});
