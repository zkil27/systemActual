import { describe, expect, it } from "vitest";
import { compressImageFile } from "@/lib/ui/compress-image";
import { computeNextPollMs } from "@/lib/print/jobs";
import { config as middlewareConfig } from "@/middleware";

describe("compressImageFile fallback", () => {
  it("returns non-image files unchanged", async () => {
    const file = new File([new Uint8Array(250_000)], "notes.txt", { type: "text/plain" });
    expect(await compressImageFile(file)).toBe(file);
  });

  it("returns small images (<= 180 KB) unchanged", async () => {
    const file = new File([new Uint8Array(50_000)], "small.jpg", { type: "image/jpeg" });
    expect(await compressImageFile(file)).toBe(file);
  });

  it("gracefully falls back to original file when browser canvas/ImageBitmap is unavailable", async () => {
    const file = new File([new Uint8Array(250_000)], "big.jpg", { type: "image/jpeg" });
    expect(await compressImageFile(file)).toBe(file);
  });
});

describe("computeNextPollMs", () => {
  it("polls fast (3s) when jobs were claimed or a wave is running", () => {
    expect(computeNextPollMs(5, 0)).toBe(3_000);
    expect(computeNextPollMs(0, 1)).toBe(3_000);
    expect(computeNextPollMs(2, 1)).toBe(3_000);
  });

  it("backs off to 30s when completely idle", () => {
    expect(computeNextPollMs(0, 0)).toBe(30_000);
  });
});

describe("middleware matcher", () => {
  const pattern = new RegExp(`^${middlewareConfig.matcher[0]}$`);
  const runsMiddleware = (pathname: string) => pattern.test(pathname);

  it("skips public static, webhook, worker, agent, and staff paths", () => {
    for (const p of [
      "/favicon.ico",
      "/manifest.webmanifest",
      "/icon",
      "/apple-icon",
      "/icons/192.png",
      "/uploads/proof.webp",
      "/login",
      "/scan",
      "/stock-in",
      "/api/auth/staff-login",
      "/api/scan/lookup",
      "/api/stock-in",
      "/api/webhooks/shopee",
      "/api/telegram/webhook",
      "/api/oauth/shopee/callback",
      "/api/worker/tick",
      "/api/agent/poll",
    ]) {
      expect(runsMiddleware(p), p).toBe(false);
    }
  });

  it("still runs middleware on protected owner routes and lookalike paths", () => {
    for (const p of [
      "/",
      "/returns",
      "/items",
      "/waves",
      "/settings",
      "/imports",
      "/api/dashboard",
      "/api/printer",
      "/api/returns/abc",
      "/icon-admin",
      "/apple-icon/secret",
    ]) {
      expect(runsMiddleware(p), p).toBe(true);
    }
  });
});
