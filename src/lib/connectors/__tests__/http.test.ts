import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MarketplaceHttpError,
  fetchWithRetry,
  parseRetryAfterMs,
  readMarketplaceJson,
} from "@/lib/connectors/http";
import { isRateLimited } from "@/lib/finance/sync";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("parseRetryAfterMs", () => {
  it("parses numeric seconds and caps at maxMs", () => {
    expect(parseRetryAfterMs("2")).toBe(2_000);
    expect(parseRetryAfterMs("60", Date.now(), 5_000)).toBe(5_000);
  });

  it("parses HTTP date headers relative to nowMs", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(parseRetryAfterMs("Thu, 26 Nov 2026 12:00:03 GMT", now)).toBe(3_000);
    expect(parseRetryAfterMs("Thu, 26 Nov 2026 11:59:50 GMT", now)).toBe(0);
  });

  it("returns null on empty or invalid values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("not-a-date")).toBeNull();
  });
});

describe("fetchWithRetry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retries 429 and respects Retry-After", async () => {
    const sleep = vi.fn(async () => {});
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await fetchWithRetry("https://example.com/api", { method: "POST" }, { fetchFn, sleep });
    expect(res.status).toBe(200);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it("retries transient 502 on GET but never retries 502 on POST", async () => {
    const sleep = vi.fn(async () => {});
    const getFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("<html>502</html>", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const getRes = await fetchWithRetry("https://example.com/api", { method: "GET" }, { fetchFn: getFetch, sleep, baseDelayMs: 100 });
    expect(getRes.status).toBe(200);
    expect(getFetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);

    const postSleep = vi.fn(async () => {});
    const postFetch = vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    const postRes = await fetchWithRetry("https://example.com/api", { method: "POST" }, { fetchFn: postFetch, sleep: postSleep });
    expect(postRes.status).toBe(502);
    expect(postFetch).toHaveBeenCalledTimes(1);
    expect(postSleep).not.toHaveBeenCalled();
  });
});

describe("readMarketplaceJson + isRateLimited", () => {
  it("throws MarketplaceHttpError instead of SyntaxError on non-JSON HTML error bodies", async () => {
    const res = new Response("<html><body>429 Too Many Requests</body></html>", {
      status: 429,
      headers: { "Retry-After": "3" },
    });
    let caught: unknown;
    try {
      await readMarketplaceJson(res, "Shopee");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MarketplaceHttpError);
    expect(caught).toMatchObject({ status: 429, retryAfterMs: 3_000, retryable: true });
    expect(isRateLimited(caught)).toBe(true);
  });
});
